// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The YAML profile's canonical writer (spec S5). The kit's YAML canonical
// fences pin these bytes; the `yaml` package's stringifier is not used, because
// canonical output has to be specified rather than inherited. The rules:
//
//  - block mappings, two-space indentation, member order preserved, an empty
//    mapping inline as `{}`;
//  - a sequence is written in flow style when it contains no mapping at any
//    depth, so `[a]`, `["morphir/SDK:list#list", a]` and `[[value, a]]` are all
//    one line (kit definitions-0003 pins the nested case); a sequence holding a
//    mapping is a block sequence, and an empty one is `[]`;
//  - scalars are plain unless plain resolution would change their meaning or an
//    indicator would appear. Outside flow a `:` is an indicator only before a
//    space and a `#` only after one, so `morphir/SDK:basics#int` and `math:abs`
//    stay plain (kit types-0002, definitions-0008); inside a flow collection
//    `[]{},:#` force double quotes, which is why the same FQName is quoted in
//    `Reference: ["morphir/SDK:list#list", a]` (kit types-0003);
//  - numbers keep the lexeme they were read with.
//
// A block scalar is never written: a string carrying a newline is double-quoted
// with the break escaped.
import { isNumber, isObject, type JsonValue } from "../json/value.ts";

const INDENT = "  ";
const PLAIN_UNSAFE_START = new Set(["-", "?", ":", ",", "[", "]", "{", "}", "#", "&", "*", "!", "|", ">", "'", '"', "%", "@", "`", " "]);
const RESOLVES_NON_STRING =
	/^(true|True|TRUE|false|False|FALSE|null|Null|NULL|~|[-+]?[0-9]+|[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?|0[ox][0-9a-fA-F]+|[-+]?\.(inf|Inf|INF|nan|NaN|NAN))$/;

// A value that needs no block: every scalar, and every sequence whose items are
// themselves flowable. A mapping is never flowable — an empty one is written
// `{}` by the callers below, which is a spelling rather than a flow collection.
function isFlowable(v: JsonValue): boolean {
	if (isNumber(v)) return true;
	if (Array.isArray(v)) return v.every(isFlowable);
	return v === null || typeof v !== "object";
}

// A code point YAML would have to escape rather than print. Written as a
// comparison rather than a character class because a control character in a
// regular expression is a lint error, and writing it as one hides what the
// bound means.
function isControl(codePoint: number): boolean {
	return codePoint < 0x20 || codePoint === 0x7f;
}

function needsQuotes(s: string, inFlow: boolean): boolean {
	if (s.length === 0) return true;
	if (RESOLVES_NON_STRING.test(s)) return true;
	if (PLAIN_UNSAFE_START.has(s[0] as string)) return true;
	if (s.endsWith(" ") || s.endsWith(":")) return true;
	if (s.includes(": ") || s.includes(" #")) return true;
	for (const ch of s) if (isControl(ch.codePointAt(0) ?? 0)) return true;
	if (inFlow && /[[\]{},:#]/.test(s)) return true;
	return false;
}

function quote(s: string): string {
	let out = "";
	for (const ch of s) {
		if (ch === "\\") out += "\\\\";
		else if (ch === '"') out += '\\"';
		else if (ch === "\n") out += "\\n";
		else if (ch === "\r") out += "\\r";
		else if (ch === "\t") out += "\\t";
		else {
			const codePoint = ch.codePointAt(0) ?? 0;
			out += isControl(codePoint) ? `\\u${codePoint.toString(16).padStart(4, "0")}` : ch;
		}
	}
	return `"${out}"`;
}

function scalar(v: JsonValue, inFlow: boolean): string {
	if (v === null) return "null";
	if (typeof v === "boolean") return v ? "true" : "false";
	if (typeof v === "string") return needsQuotes(v, inFlow) ? quote(v) : v;
	if (isNumber(v)) return v.text;
	throw new Error("not a scalar");
}

// A flowable value on one line. Nested sequences stay nested, and every scalar
// inside is quoted by the flow rules, because the whole line is flow context.
function flow(v: JsonValue): string {
	if (Array.isArray(v)) return v.length === 0 ? "[]" : `[${v.map(flow).join(", ")}]`;
	return scalar(v, true);
}

// The inline spelling of a value, or null when it needs a block.
function inlineOf(v: JsonValue): string | null {
	if (isObject(v)) return v.members.size === 0 ? "{}" : null;
	if (Array.isArray(v)) return isFlowable(v) ? flow(v) : null;
	return scalar(v, false);
}

// The lines of `value` as a collection at `indent`. Each line already carries
// its indent; a block-sequence item places its first line after `- ` and keeps
// the rest, which is exactly the one-level-deeper indent `- ` occupies.
function block(value: JsonValue, indent: string): string[] {
	if (isObject(value)) {
		const lines: string[] = [];
		for (const [k, v] of value.members) {
			const key = scalar(k, false);
			const inline = inlineOf(v);
			if (inline !== null) lines.push(`${indent}${key}: ${inline}`);
			else lines.push(`${indent}${key}:`, ...block(v, `${indent}${INDENT}`));
		}
		return lines;
	}
	if (Array.isArray(value)) {
		const lines: string[] = [];
		for (const item of value) {
			const inline = inlineOf(item);
			if (inline !== null) lines.push(`${indent}- ${inline}`);
			else {
				const inner = block(item, `${indent}${INDENT}`);
				lines.push(`${indent}- ${(inner[0] ?? "").trimStart()}`, ...inner.slice(1));
			}
		}
		return lines;
	}
	return [scalar(value, false)];
}

export function writeYaml(value: JsonValue): string {
	const inline = inlineOf(value);
	const lines = inline !== null ? [inline] : block(value, "");
	return `${lines.join("\n")}\n`;
}
