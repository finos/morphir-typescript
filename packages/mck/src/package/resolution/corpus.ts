// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import { contentHash } from "../../kit/hash.ts";
import { array, fields, nonempty, object, strictJson, string } from "../json.ts";
import { RESOLUTION_CONTRACT, type ResolutionKit } from "./contract.ts";
import { parseResolutionResponse } from "./protocol.ts";

const INDEX = "mck/resolution-cases.json";
const SCHEMAS = [
	"schemas/library-manifest.schema.json",
	"schemas/lock-core.schema.json",
	"schemas/resolution-input.schema.json",
	"schemas/resolution-result.schema.json",
	"schemas/resolution-case.schema.json",
] as const;

function empty(used: ReadonlyMap<string, Uint8Array>, error: unknown): ResolutionKit {
	return { formatVersion: RESOLUTION_CONTRACT, contentHash: contentHash(used), cases: [], errors: [String(error)] };
}

function decode(bytes: Uint8Array): string {
	return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

function validators(schemas: readonly object[]): { readonly caseDocument: ValidateFunction; readonly result: ValidateFunction } {
	const ajv = new Ajv2020({ strict: false, allErrors: true });
	for (const schema of schemas) ajv.addSchema(schema);
	const caseDocument = ajv.getSchema("https://morphir.finos.org/spec/package/0.1.0-draft.2/resolution-case.schema.json");
	const result = ajv.getSchema("https://morphir.finos.org/spec/package/0.1.0-draft.2/resolution-result.schema.json");
	if (!caseDocument || !result) throw new Error("resolution schemas did not compile");
	return { caseDocument, result };
}

function assertValid(validate: ValidateFunction, value: unknown, name: string): void {
	if (!validate(value)) throw new Error(`${name} does not match its schema: ${JSON.stringify(validate.errors)}`);
}

/** Expectations are loaded only from fixed bytes and validated independently of the resolver. */
export function loadResolutionKitFromFiles(files: ReadonlyMap<string, Uint8Array>): ResolutionKit {
	const used = new Map<string, Uint8Array>();
	const read = (name: string): string => {
		const bytes = files.get(name);
		if (!bytes) throw new Error(`missing corpus file ${name}`);
		used.set(name, bytes);
		return decode(bytes);
	};
	try {
		const parsedSchemas = SCHEMAS.map((name) => object(strictJson(read(name))));
		const compiled = validators(parsedSchemas);
		const index = strictJson(read(INDEX));
		assertValid(compiled.caseDocument, index, INDEX);
		const indexFields = fields(index, ["formatVersion", "fixtures"]);
		const parsed = [];
		const ids = new Set<string>();
		for (const relative of array(indexFields.fixtures).map(string)) {
			if (!/^fixtures\/resolution\/[a-z-]+\.json$/.test(relative)) throw new Error(`fixture path is not confined: ${relative}`);
			const name = `mck/${relative}`;
			const fixture = strictJson(read(name));
			assertValid(compiled.caseDocument, fixture, name);
			const fixtureFields = fields(fixture, ["formatVersion", "cases"]);
			for (const value of array(fixtureFields.cases)) {
				const entry = fields(value, ["id", "family", "description", "input", "expected"]);
				const id = nonempty(entry.id);
				if (ids.has(id)) throw new Error(`duplicate case id ${id}`);
				ids.add(id);
				assertValid(compiled.result, entry.expected, `${name} case ${id} expected`);
				const expected = parseResolutionResponse(entry.expected, "resolve-library");
				parsed.push({ id, request: { op: "resolve-library" as const, input: string(entry.input) }, expected });
			}
		}
		if (parsed.length === 0) throw new Error("empty resolution corpus");
		return { formatVersion: RESOLUTION_CONTRACT, contentHash: contentHash(used), cases: parsed, errors: [] };
	} catch (error) {
		return empty(used, error);
	}
}

function confinedFile(root: string, relative: string): string {
	if (path.isAbsolute(relative)) throw new Error(`fixture path is not confined: ${relative}`);
	const candidate = realpathSync(path.resolve(root, relative));
	const prefix = `${root}${path.sep}`;
	if (!candidate.startsWith(prefix)) throw new Error(`fixture path is not confined: ${relative}`);
	return candidate;
}

/** `directory` is the parent repository's spec/package/mck directory. */
export function loadResolutionKit(directory: string): ResolutionKit {
	const files = new Map<string, Uint8Array>();
	try {
		const root = realpathSync(directory);
		const packageRoot = realpathSync(path.resolve(root, ".."));
		for (const name of SCHEMAS) files.set(name, readFileSync(confinedFile(packageRoot, name.slice("schemas/".length).replace(/^/, "schemas/"))));
		files.set(INDEX, readFileSync(confinedFile(root, "resolution-cases.json")));
		const index = fields(strictJson(decode(files.get(INDEX) as Uint8Array)), ["formatVersion", "fixtures"]);
		for (const relative of array(index.fixtures).map(string)) {
			if (!/^fixtures\/resolution\/[a-z-]+\.json$/.test(relative)) throw new Error(`fixture path is not confined: ${relative}`);
			files.set(`mck/${relative}`, readFileSync(confinedFile(root, relative)));
		}
	} catch (error) {
		return empty(files, error);
	}
	return loadResolutionKitFromFiles(files);
}
