// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import path from "node:path";
import { contentHash } from "../kit/hash.ts";
import { PACKAGE_CONTRACT, type PackageRequest, type PackageResponse, type PackageSchemas } from "./contract.ts";
import { array, digest, fields, hex, nonempty, object, strictJson, string } from "./json.ts";
import { compilePackageSchemas } from "./schemas.ts";

export interface PackageCase {
	readonly id: string;
	readonly request: PackageRequest;
	readonly expected: PackageResponse;
}
export interface PackageKit {
	readonly formatVersion: typeof PACKAGE_CONTRACT;
	readonly contentHash: string;
	readonly cases: readonly PackageCase[];
	readonly errors: readonly string[];
}
const FIXTURES = {
	eligibility: "mck/fixtures/two-libraries/eligibility/manifest.json",
	consumer: "mck/fixtures/two-libraries/loan-rules/manifest.json",
	lock: "mck/fixtures/two-libraries/lock-core.json",
} as const;
const FILES = [
	"mck/digest-vectors.json",
	"mck/schema-cases.json",
	"mck/library-cases.json",
	"schemas/library-manifest.schema.json",
	"schemas/lock-core.schema.json",
	...Object.values(FIXTURES),
	"mck/fixtures/two-libraries/eligibility/ir.json",
	"mck/fixtures/two-libraries/loan-rules/ir.json",
];

function document(text: string, names: readonly string[]): Record<string, unknown> {
	const doc = fields(strictJson(text), ["formatVersion", ...names]);
	if (doc.formatVersion !== PACKAGE_CONTRACT) throw new Error("unsupported package corpus formatVersion");
	return doc;
}
function cases(value: unknown): unknown[] {
	const values = array(value);
	if (values.length === 0) throw new Error("empty case collection");
	return values;
}
function mutatedFixture(source: unknown, mutation: Record<string, unknown>): unknown {
	const copy = structuredClone(source);
	if (mutation.replace !== undefined && mutation.remove !== undefined) throw new Error("replace and remove are mutually exclusive");
	if (mutation.replace === undefined && mutation.remove === undefined) return copy;
	const replacement = mutation.replace === undefined ? undefined : fields(mutation.replace, ["path", "value"]);
	const keys = array(replacement?.path ?? mutation.remove).map(nonempty);
	if (keys.length === 0) throw new Error("empty mutation path");
	let target = object(copy);
	for (const key of keys.slice(0, -1)) {
		if (!Object.hasOwn(target, key)) throw new Error(`missing mutation target ${key}`);
		target = object(target[key]);
	}
	const last = keys[keys.length - 1] as string;
	if (replacement) Object.defineProperty(target, last, { value: replacement.value, enumerable: true, writable: true, configurable: true });
	else {
		if (!Object.hasOwn(target, last)) throw new Error(`missing removal target ${last}`);
		delete target[last];
	}
	return copy;
}

/** Pure loader: expectations come only from the corpus, never the reference testee. */
export function loadPackageKitFromFiles(files: ReadonlyMap<string, Uint8Array>): PackageKit {
	const parsed: PackageCase[] = [];
	const used = new Map<string, Uint8Array>();
	const read = (name: string): string => {
		const bytes = files.get(name);
		if (!bytes) throw new Error(`missing corpus file ${name}`);
		used.set(name, bytes);
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	};
	try {
		const docs = document(read("mck/digest-vectors.json"), ["cases", "byteCases"]);
		for (const value of cases(docs.cases)) {
			const entry = object(value);
			const rejected = Object.hasOwn(entry, "error");
			fields(entry, rejected ? ["id", "input", "error"] : ["id", "input", "canonical", "manifestDigest", "packageContentDigest"]);
			if (rejected && entry.error !== "invalid-document") throw new Error("unknown normalization error");
			parsed.push({
				id: nonempty(entry.id),
				request: { op: "normalize", input: string(entry.input) },
				expected: rejected
					? { ok: false, error: "invalid-document" }
					: {
							ok: true,
							canonical: string(entry.canonical),
							manifestDigest: digest(entry.manifestDigest),
							packageContentDigest: digest(entry.packageContentDigest),
						},
			});
		}
		for (const value of cases(docs.byteCases)) {
			const entry = fields(value, ["id", "hex", "digest"]);
			parsed.push({ id: nonempty(entry.id), request: { op: "hash-bytes", hex: hex(entry.hex) }, expected: { ok: true, digest: digest(entry.digest) } });
		}
		const schemas: PackageSchemas = {
			manifest: object(strictJson(read("schemas/library-manifest.schema.json"))),
			lock: object(strictJson(read("schemas/lock-core.schema.json"))),
		};
		compilePackageSchemas(schemas);
		const fixtures = Object.fromEntries(Object.entries(FIXTURES).map(([name, file]) => [name, strictJson(read(file))]));
		const schemaCases = document(read("mck/schema-cases.json"), ["cases"]);
		for (const value of cases(schemaCases.cases)) {
			const entry = fields(value, ["id", "schema", "fixture", "expected"], ["replace", "remove"]);
			if (entry.schema !== "manifest" && entry.schema !== "lock") throw new Error("unknown schema");
			const fixture = nonempty(entry.fixture);
			if (!Object.hasOwn(FIXTURES, fixture)) throw new Error("unknown fixture");
			if ((fixture === "lock") !== (entry.schema === "lock")) throw new Error("fixture/schema mismatch");
			if (entry.expected !== "accept" && entry.expected !== "reject") throw new Error("unknown schema expectation");
			parsed.push({
				id: nonempty(entry.id),
				request: { op: "validate", artifact: entry.schema, input: JSON.stringify(mutatedFixture(fixtures[fixture], entry)), schemas },
				expected: { ok: true, valid: entry.expected === "accept" },
			});
		}
		const libraryCases = document(read("mck/library-cases.json"), ["cases"]);
		const payloads = Object.fromEntries(
			["eligibility", "consumer"].map((name) => {
				const file = `mck/fixtures/two-libraries/${name === "consumer" ? "loan-rules" : name}/ir.json`;
				const bytes = files.get(file);
				if (!bytes) throw new Error(`missing corpus file ${file}`);
				used.set(file, bytes);
				return [name, Buffer.from(bytes).toString("hex")];
			}),
		);
		for (const value of cases(libraryCases.cases)) {
			const entry = fields(value, ["id", "expected"], ["replace", "remove", "payloadSuffix", "lockText"]);
			if (entry.expected !== "accept" && entry.expected !== "reject") throw new Error("unknown Library expectation");
			if (entry.lockText !== undefined && (entry.replace !== undefined || entry.remove !== undefined))
				throw new Error("lockText and mutation are mutually exclusive");
			const modified = object(mutatedFixture(fixtures, entry));
			const suffix = entry.payloadSuffix === undefined ? undefined : fields(entry.payloadSuffix, ["library", "hex"]);
			if (suffix && suffix.library !== "eligibility" && suffix.library !== "consumer") throw new Error("unknown payload fixture");
			const libraries = ["eligibility", "consumer"].map((name) => ({
				manifest: JSON.stringify(modified[name]),
				files: [{ path: "ir.json", hex: string(payloads[name]) + (suffix?.library === name ? hex(suffix.hex) : "") }],
			}));
			parsed.push({
				id: nonempty(entry.id),
				request: { op: "verify-library-set", lock: entry.lockText === undefined ? JSON.stringify(modified.lock) : string(entry.lockText), libraries, schemas },
				expected: { ok: true, valid: entry.expected === "accept" },
			});
		}
		if (new Set(parsed.map((entry) => entry.id)).size !== parsed.length) throw new Error("duplicate case id");
		return { formatVersion: PACKAGE_CONTRACT, contentHash: contentHash(used), cases: parsed, errors: [] };
	} catch (error) {
		return { formatVersion: PACKAGE_CONTRACT, contentHash: contentHash(used), cases: [], errors: [String(error)] };
	}
}

/** `directory` is spec/package/mck. All input paths are fixed, not corpus-controlled. */
export function loadPackageKit(directory: string): PackageKit {
	const files = new Map<string, Uint8Array>();
	try {
		for (const name of FILES) files.set(name, readFileSync(path.resolve(directory, "..", name)));
	} catch (error) {
		return { formatVersion: PACKAGE_CONTRACT, contentHash: contentHash(files), cases: [], errors: [String(error)] };
	}
	return loadPackageKitFromFiles(files);
}
