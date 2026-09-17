// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { array, object, strictJson, string } from "../json.ts";

export const INDEX = "spec/package/mck/local-registry-cases.json";
export const CASE_SCHEMA = "https://morphir.finos.org/spec/package/0.1.0-draft.3/local-registry-case.schema.json";
const registered = new Map([
	[CASE_SCHEMA, "local-registry-case"],
	["https://morphir.finos.org/spec/package/0.1.0-draft.1/library-manifest.schema.json", "library-manifest"],
	["https://morphir.finos.org/spec/package/0.1.0-draft.1/lock-core.schema.json", "lock-core"],
	["https://morphir.finos.org/spec/package/0.1.0-draft.2/resolution-input.schema.json", "resolution-input"],
	["https://morphir.finos.org/spec/package/0.1.0-draft.2/resolution-result.schema.json", "resolution-result"],
]);
export type CorpusSource = (logicalPath: string) => Uint8Array;
export const decode = (bytes: Uint8Array): unknown => strictJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
export function logicalPath(name: string): string {
	if (/[\\\0\r\n]/.test(name) || name.startsWith("/") || name.split("/").some((part) => !part || part === "." || part === ".."))
		throw new Error(`path is not confined: ${name}`);
	return name;
}
export function fixturePath(value: unknown, area?: "cases"): string {
	const name = logicalPath(string(value));
	if (!/^fixtures\/local-registry\/(assets|cases|expected)\/[a-z0-9][a-z0-9./-]*$/.test(name) || (area && !name.startsWith(`fixtures/local-registry/${area}/`)))
		throw new Error(`fixture path is not confined: ${name}`);
	return `spec/package/mck/${name}`;
}
export function fileMapSource(files: ReadonlyMap<string, Uint8Array>): CorpusSource {
	return (name) => {
		const bytes = files.get(logicalPath(name));
		if (!bytes) throw new Error(`missing corpus file ${name}`);
		return new Uint8Array(bytes);
	};
}
/** Trusted, static repository fixture loading, not a hostile runtime filesystem provider. */
export function repositorySource(sourceRoot: string): CorpusSource {
	const root = realpathSync(sourceRoot);
	return (name) => {
		const target = realpathSync(path.resolve(root, logicalPath(name)));
		const scope = name.startsWith("spec/package/schemas/")
			? "spec/package/schemas"
			: name.startsWith("spec/package/mck/fixtures/")
				? "spec/package/mck/fixtures/local-registry"
				: "spec/package/mck";
		const confined = path.resolve(root, scope);
		if (!target.startsWith(`${confined}${path.sep}`)) throw new Error(`path is not confined: ${name}`);
		return readFileSync(target);
	};
}
export function corpus(source: CorpusSource) {
	const consumed = new Map<string, Uint8Array>();
	const read = (name: string): Uint8Array => {
		const bytes = consumed.get(name) ?? new Uint8Array(source(logicalPath(name)));
		consumed.set(name, bytes);
		return bytes;
	};
	const json = (name: string) => decode(read(name));
	const ajv = new Ajv2020({ strict: false, allErrors: true });
	const loaded = new Set<string>();
	const loadSchema = (id: string): void => {
		if (loaded.has(id)) return;
		const name = registered.get(id);
		if (!name) throw new Error(`unknown local schema ID ${id}`);
		const schema = object(json(`spec/package/schemas/${name}.schema.json`));
		if (schema.$id !== id) throw new Error(`unknown local schema ID ${String(schema.$id)}`);
		loaded.add(id);
		ajv.addSchema(schema);
		const visit = (value: unknown): void => {
			if (value === null || typeof value !== "object") return;
			if (Array.isArray(value)) {
				value.forEach(visit);
				return;
			}
			const record = object(value);
			if (typeof record.$ref === "string") loadSchema(new URL(record.$ref, id).href.split("#")[0] as string);
			Object.values(record).forEach(visit);
		};
		visit(schema);
	};
	loadSchema(CASE_SCHEMA);
	const validate = (definition: string, value: unknown): void => {
		const check = ajv.getSchema(`${CASE_SCHEMA}#/$defs/${definition}`);
		if (!check?.(value)) throw new Error(`${definition} schema validation failed: ${ajv.errorsText(check?.errors)}`);
	};
	read("spec/package/mck/README.md");
	const index = object(json(INDEX));
	validate("Index", index);
	const cases: Record<string, unknown>[] = [];
	const paths = new Set<string>();
	for (const fixture of array(index.fixtures)) {
		const name = fixturePath(fixture, "cases");
		if (paths.has(name)) throw new Error(`duplicate fixture path ${name}`);
		paths.add(name);
		const document = object(json(name));
		validate("CaseFile", document);
		cases.push(...array(document.cases).map(object));
	}
	return { consumed, read, json, validate, index, cases, paths };
}
export type Corpus = ReturnType<typeof corpus>;
