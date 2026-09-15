// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The YAML profile's reader (spec S4). The `yaml` package parses the text; this
// module walks its document and admits only what the profile allows, producing
// the same JsonValue tree the JSON reader produces. Scalars are resolved from
// their source text with the profile's own rules rather than the package's,
// so an octal integer or a date-looking word cannot slip through as a number
// or a timestamp.
import {
	type Document,
	isAlias,
	isMap,
	isPair,
	isScalar,
	isSeq,
	LineCounter,
	type Node,
	type Pair,
	parseDocument,
	Scalar,
	type YAMLMap,
	type YAMLSeq,
} from "yaml";
import { type Diagnostic, type DiagnosticCode, diagnostic } from "../../model/diagnostic.ts";
import { err, ok, type Result } from "../../model/result.ts";
import { type JsonValue, jsonNumber, jsonObject } from "../json/value.ts";

const INT = /^[-+]?[0-9]+$/;
const FLOAT = /^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/;
const NON_FINITE = /^[-+]?\.(inf|Inf|INF|nan|NaN|NAN)$/;
const OCTAL_OR_HEX = /^0[ox][0-9a-fA-F]+$/;
const NULLS = new Set(["null", "Null", "NULL", "~", ""]);
const TRUES = new Set(["true", "True", "TRUE"]);
const FALSES = new Set(["false", "False", "FALSE"]);

class Rejection extends Error {
	constructor(
		readonly code: DiagnosticCode,
		readonly cursor: string,
		readonly offset: number | null,
		message: string,
	) {
		super(message);
	}
}

function pointer(path: readonly string[]): string {
	return path.length === 0 ? "/" : `/${path.map((p) => p.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

// A YAML float that JSON cannot spell (".5", "5.", "+1") is rewritten to the
// shortest JSON lexeme with the same value; the IR literal readers only ever see
// JSON lexemes, and the rewrite changes no value.
function jsonLexeme(text: string): string {
	let t = text.startsWith("+") ? text.slice(1) : text;
	const sign = t.startsWith("-") ? "-" : "";
	if (sign) t = t.slice(1);
	const [mantissa, exponent] = t.split(/[eE]/);
	let m = mantissa ?? "";
	if (m.startsWith(".")) m = `0${m}`;
	if (m.endsWith(".")) m = `${m}0`;
	return `${sign}${m}${exponent === undefined ? "" : `e${exponent}`}`;
}

function resolvePlain(text: string, path: readonly string[], offset: number | null): JsonValue {
	if (NULLS.has(text)) return null;
	if (TRUES.has(text)) return true;
	if (FALSES.has(text)) return false;
	if (NON_FINITE.test(text)) throw new Rejection("invalid_literal", pointer(path), offset, "non-finite numbers are not part of the profile");
	if (OCTAL_OR_HEX.test(text)) throw new Rejection("invalid_literal", pointer(path), offset, `"${text}" is octal or hexadecimal; write decimal`);
	if (INT.test(text)) return jsonNumber(text.startsWith("+") ? text.slice(1) : text);
	if (FLOAT.test(text)) return jsonNumber(jsonLexeme(text));
	return text;
}

function rejectProps(node: Node, path: readonly string[]): void {
	const offset = node.range?.[0] ?? null;
	if (node.anchor !== undefined) throw new Rejection("unsupported_yaml_feature", pointer(path), offset, "anchors and aliases are not part of the profile");
	if (node.tag !== undefined) throw new Rejection("unsupported_yaml_feature", pointer(path), offset, "tags are not part of the profile");
}

function convert(node: Node | null, path: readonly string[]): JsonValue {
	if (node === null) return null;
	if (isAlias(node)) throw new Rejection("unsupported_yaml_feature", pointer(path), node.range?.[0] ?? null, "anchors and aliases are not part of the profile");
	rejectProps(node, path);
	if (isScalar(node)) return convertScalar(node, path);
	if (isSeq(node)) return (node as YAMLSeq<Node>).items.map((item, i) => convert(item as Node | null, [...path, String(i)]));
	if (isMap(node)) return convertMap(node as YAMLMap<Node, Node>, path);
	throw new Rejection("invalid_yaml", pointer(path), (node as Node).range?.[0] ?? null, "unsupported node");
}

function convertScalar(node: Scalar, path: readonly string[]): JsonValue {
	const offset = node.range?.[0] ?? null;
	const source = node.source ?? String(node.value ?? "");
	if (node.type === Scalar.PLAIN) return resolvePlain(source, path, offset);
	return typeof node.value === "string" ? node.value : String(node.value);
}

function keyText(pair: Pair<Node, Node>, path: readonly string[]): { text: string; offset: number | null } {
	const k = pair.key;
	if (!isScalar(k) || k.type === undefined)
		throw new Rejection("invalid_type", pointer(path), (k as Node | null)?.range?.[0] ?? null, "mapping keys must be strings");
	rejectProps(k, path);
	const offset = k.range?.[0] ?? null;
	if (k.type === Scalar.PLAIN) {
		const resolved = resolvePlain(k.source ?? String(k.value), path, offset);
		if (typeof resolved !== "string") throw new Rejection("invalid_type", pointer(path), offset, "mapping keys must be strings");
		return { text: resolved, offset };
	}
	return { text: typeof k.value === "string" ? k.value : String(k.value), offset };
}

function convertMap(map: YAMLMap<Node, Node>, path: readonly string[]): JsonValue {
	const entries: (readonly [string, JsonValue])[] = [];
	const seen = new Set<string>();
	for (const item of map.items) {
		if (!isPair(item)) throw new Rejection("invalid_yaml", pointer(path), null, "unsupported mapping item");
		const { text, offset } = keyText(item as Pair<Node, Node>, path);
		if (text === "<<") throw new Rejection("unsupported_yaml_feature", pointer([...path, text]), offset, "merge keys are not part of the profile");
		if (seen.has(text)) throw new Rejection("duplicate_member", pointer([...path, text]), offset, `duplicate member "${text}"`);
		seen.add(text);
		entries.push([text, convert((item as Pair<Node, Node>).value as Node | null, [...path, text])] as const);
	}
	return jsonObject(entries);
}

export function parseYaml(text: string): Result<JsonValue, Diagnostic> {
	const lineCounter = new LineCounter();
	const at = (offset: number | null) => (offset === null ? undefined : { line: lineCounter.linePos(offset).line, column: lineCounter.linePos(offset).col });
	let doc: Document.Parsed;
	try {
		doc = parseDocument(text, { version: "1.2", schema: "core", uniqueKeys: false, keepSourceTokens: true, lineCounter, merge: false, logLevel: "error" });
	} catch (error) {
		return err(diagnostic("invalid_yaml", "syntax", "/", error instanceof Error ? error.message : String(error)));
	}
	const first = doc.errors[0];
	if (first !== undefined) {
		const message = first.code === "MULTIPLE_DOCS" ? "expected exactly one document" : first.message;
		return err(diagnostic("invalid_yaml", "syntax", "/", message, at(first.pos[0])));
	}
	if (doc.directives.yaml.explicit || Object.keys(doc.directives.tags).some((h) => h !== "!" && h !== "!!")) {
		return err(diagnostic("unsupported_yaml_feature", "syntax", "/", "directives are not part of the profile"));
	}
	if (doc.contents === null && text.trim() === "") return err(diagnostic("invalid_yaml", "syntax", "/", "expected exactly one document"));
	try {
		return ok(convert(doc.contents as Node | null, []));
	} catch (error) {
		if (error instanceof Rejection) return err(diagnostic(error.code, "syntax", error.cursor, error.message, at(error.offset)));
		throw error;
	}
}
