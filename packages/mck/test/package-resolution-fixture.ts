// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import protocolSchema from "../package-resolution-protocol.schema.json";

export const resolutionVersion = "0.1.0-draft.2";
const digest = `sha256:${"0".repeat(64)}`;
const root = {
	release: { packagePath: "example.com/app/root", version: "1.0.0" },
	irPackageName: "example/app",
	manifestDigest: digest,
	contentDigest: digest,
	dependencies: [],
};
const validInput = JSON.stringify({ formatVersion: resolutionVersion, capability: "flat-library", root, mode: "initial", catalogs: [] });
const validResult = {
	ok: true,
	graph: {
		root: root.release,
		nodes: [{ release: root.release, irPackageName: root.irPackageName, manifestDigest: digest, contentDigest: digest, bindings: [] }],
	},
};
const invalidResult = { ok: false, diagnostic: { code: "invalid-input", violations: [{ pointer: "", rule: "malformed-json" }] } };

const resultSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "https://morphir.finos.org/spec/package/0.1.0-draft.2/resolution-result.schema.json",
	oneOf: [
		{
			type: "object",
			required: ["ok", "graph"],
			additionalProperties: false,
			properties: { ok: { const: true }, graph: { $ref: "#/$defs/LockedGraph" } },
		},
		{
			type: "object",
			required: ["ok", "diagnostic"],
			additionalProperties: false,
			properties: { ok: { const: false }, diagnostic: { $ref: "#/$defs/Diagnostic" } },
		},
	],
	$defs: protocolSchema.$defs,
};
const caseSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "https://morphir.finos.org/spec/package/0.1.0-draft.2/resolution-case.schema.json",
	oneOf: [
		{
			type: "object",
			required: ["formatVersion", "fixtures"],
			additionalProperties: false,
			properties: {
				formatVersion: { const: resolutionVersion },
				fixtures: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", pattern: "^fixtures/resolution/[a-z-]+\\.json$" } },
			},
		},
		{
			type: "object",
			required: ["formatVersion", "cases"],
			additionalProperties: false,
			properties: {
				formatVersion: { const: resolutionVersion },
				cases: {
					type: "array",
					minItems: 1,
					items: {
						type: "object",
						required: ["id", "family", "description", "input", "expected"],
						additionalProperties: false,
						properties: {
							id: { type: "string", pattern: "^resolution\\." },
							family: { type: "string" },
							description: { type: "string", minLength: 1 },
							input: { type: "string" },
							expected: { $ref: "resolution-result.schema.json" },
						},
					},
				},
			},
		},
	],
};

export function resolutionFiles(): Map<string, Uint8Array> {
	const files = new Map<string, Uint8Array>();
	const put = (name: string, value: unknown) => files.set(name, new TextEncoder().encode(JSON.stringify(value)));
	put("mck/resolution-cases.json", { formatVersion: resolutionVersion, fixtures: ["fixtures/resolution/basic.json"] });
	put("mck/fixtures/resolution/basic.json", {
		formatVersion: resolutionVersion,
		cases: [
			{ id: "resolution.invalid.raw", family: "profile-boundaries", description: "Raw syntax failure", input: "{", expected: invalidResult },
			{ id: "resolution.initial.root", family: "initial-selection", description: "Root-only graph", input: validInput, expected: validResult },
		],
	});
	put("schemas/library-manifest.schema.json", {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: "https://morphir.finos.org/spec/package/0.1.0-draft.1/library-manifest.schema.json",
		type: "object",
	});
	put("schemas/lock-core.schema.json", {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: "https://morphir.finos.org/spec/package/0.1.0-draft.1/lock-core.schema.json",
		type: "object",
	});
	put("schemas/resolution-input.schema.json", {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: "https://morphir.finos.org/spec/package/0.1.0-draft.2/resolution-input.schema.json",
		type: "object",
	});
	put("schemas/resolution-result.schema.json", resultSchema);
	put("schemas/resolution-case.schema.json", caseSchema);
	return files;
}

export function writeResolutionPackage(directory: string, files = resolutionFiles()): string {
	for (const [name, bytes] of files) {
		const file = path.join(directory, name);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, bytes);
	}
	return path.join(directory, "mck");
}
