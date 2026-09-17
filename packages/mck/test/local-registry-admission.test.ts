// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as publicApi from "../src/index.ts";
import { contentHash } from "../src/kit/hash.ts";
import { admitExactCaseForTesting, admitLocalRegistryFromFiles, admitLocalRegistryRepository } from "../src/package/local-registry/admission.ts";
import { fileMapSource } from "../src/package/local-registry/corpus.ts";
import { inspectLocalRegistryFromFiles } from "../src/package/local-registry/definition.ts";

const prefix = "spec/package/";
const indexPath = `${prefix}mck/local-registry-cases.json`;
const casePath = `${prefix}mck/fixtures/local-registry/cases/test.json`;
const schemaPath = `${prefix}schemas/local-registry-case.schema.json`;
const schemaId = "https://morphir.finos.org/spec/package/0.1.0-draft.3/local-registry-case.schema.json";
const failure = {
	ok: false,
	diagnostic: {
		category: "invalid-input",
		code: "invalid-input",
		phase: "decode",
		witnesses: [{ kind: "violation", subject: { kind: "lock" }, pointer: "", rule: "malformed-json" }],
	},
};
const parseCase = {
	kind: "parse",
	id: "local-registry.wire.raw",
	family: "wire",
	description: "Exact malformed bytes",
	required: true,
	target: "lock",
	at: "2027-01-01T00:00:00Z",
	input: { kind: "hex", value: "efbbbf7b7d" },
	expected: { kind: "inline", result: failure },
};
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed fixture mutations.
function mutate(source: Map<string, Uint8Array>, name: string, change: (value: any) => void): void {
	const value = JSON.parse(Buffer.from(source.get(name) as Uint8Array).toString());
	change(value);
	source.set(name, encode(value));
}
function bind(source: Map<string, Uint8Array>, id: string, type: string, bytes: Uint8Array): string {
	const path = `fixtures/local-registry/assets/${id}.json`;
	mutate(source, indexPath, (index) => {
		index.assets = index.assets.filter((asset: { id: string }) => asset.id !== id);
		index.assets.push({
			id,
			type,
			kind: "bound",
			purpose: "Fixed test bytes",
			path,
			length: String(bytes.byteLength),
			sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
		});
	});
	source.set(`${prefix}mck/${path}`, bytes);
	return `${prefix}mck/${path}`;
}
function scenarioFiles() {
	const source = files();
	const digest = `sha256:${"0".repeat(64)}`;
	bind(source, "future", "tree", encode({ entries: [] }));
	bind(
		source,
		"configuration",
		"configuration",
		encode({
			bindings: [{ alias: "finance", registryRoot: "finance", identity: digest }],
			bootstrapRoots: [{ identity: digest, version: "1", bytes: { kind: "hex", value: "00" } }],
		}),
	);
	const policy = { kind: "hex", value: "00" };
	const at = "2027-01-01T00:00:00Z";
	bind(
		source,
		"observations",
		"observations",
		encode({
			security: [
				{
					actor: "client",
					condition: "readable",
					repositories: [
						{ registry: "finance", currentRoot: "1", floors: { timestamp: "0", snapshot: "0", targets: "0" }, lastFreshAuthorization: { kind: "none" } },
					],
					grants: [],
					revocations: [],
					marker: "none",
					observedAt: at,
					policy,
				},
			],
			filesystems: [
				{ root: { owner: "client", kind: "cache" }, entries: [] },
				{ root: { owner: "client", kind: "destination" }, entries: [] },
				{ root: { owner: "finance", kind: "registry" }, entries: [] },
			],
			registries: [{ registry: "finance", timestamp: { kind: "absent" }, reserved: { targets: "0", snapshot: "0", timestamp: "0" } }],
			lockBytes: [],
			readyGraphs: [],
		}),
	);
	mutate(source, casePath, (doc) => {
		doc.cases = [
			{
				kind: "scenario",
				id: "local-registry.wire.scenario",
				family: "wire",
				description: "Fixed scenario",
				required: true,
				setup: {
					registries: [{ id: "finance", tree: { asset: "future" }, publisher: "explicitly-initialize" }],
					actors: [
						{
							id: "client",
							configuration: { asset: "configuration" },
							policy,
							security: "explicitly-initialize",
							cache: { asset: "future" },
							staging: "empty",
							destination: "empty",
						},
					],
				},
				operations: [
					{
						id: "refresh",
						actor: "client",
						at,
						policy,
						limits: [],
						name: "refresh-library-registry",
						input: { registry: "finance" },
						expected: { kind: "inline", result: failure },
					},
				],
				actions: [
					{ kind: "start", operation: "refresh", barriers: [] },
					{ kind: "join", operation: "refresh" },
				],
				observe: { at, policies: [{ actor: "client", policy }] },
				expectedObservations: { asset: "observations", assertions: [{ pointer: "/readyGraphs", equals: [] }] },
			},
		];
	});
	return source;
}
// Small local schemas isolate loader behavior. The opt-in parent integration compiles the canonical schemas.
function files(): Map<string, Uint8Array> {
	return new Map([
		[
			indexPath,
			encode({
				formatVersion: "0.1.0-draft.3",
				status: "candidate-definitions",
				schema: "../schemas/local-registry-case.schema.json",
				fixtures: ["fixtures/local-registry/cases/test.json"],
				assets: [{ id: "future", kind: "pending", type: "bytes", purpose: "Not bound yet" }],
			}),
		],
		[casePath, encode({ formatVersion: "0.1.0-draft.3", cases: [parseCase] })],
		[`${prefix}mck/README.md`, Buffer.from("Definition contract\n")],
		[
			schemaPath,
			encode({
				$schema: "https://json-schema.org/draft/2020-12/schema",
				$id: schemaId,
				$defs: {
					Index: { type: "object", required: ["fixtures", "assets"] },
					CaseFile: { type: "object", required: ["cases"] },
					Result: {
						type: "object",
						required: ["ok"],
						oneOf: [
							{
								required: ["diagnostic"],
								properties: { ok: { const: false }, diagnostic: { type: "object", required: ["category", "code", "phase", "witnesses"] } },
							},
							{ required: ["kind"], properties: { ok: { const: true } } },
						],
					},
					Tree: { type: "object", required: ["entries"] },
					Configuration: { type: "object", required: ["bindings", "bootstrapRoots"] },
					Observations: { type: "object", required: ["security", "filesystems", "registries", "lockBytes", "readyGraphs"] },
				},
			}),
		],
	]);
}

test("pending definitions have their own summary and cannot be admitted for execution", () => {
	const source = files();
	expect(inspectLocalRegistryFromFiles(source)).toEqual({ kind: "definition-summary", caseCount: 1, boundAssetCount: 0, pendingAssetCount: 1, errors: [] });
	const admission = admitLocalRegistryFromFiles(source);
	expect(admission.kind).toBe("kit-error");
	expect(admission).not.toHaveProperty("contentHash");
	expect(admission).not.toHaveProperty("value");
});

test("malformed complete expectations are kit errors before an execution value exists", () => {
	const source = files();
	mutate(source, indexPath, (index) => {
		index.assets = [];
	});
	mutate(source, casePath, (document) => {
		delete document.cases[0].expected.result.diagnostic.witnesses;
	});
	expect(admitLocalRegistryFromFiles(source)).toMatchObject({ kind: "kit-error" });
	expect(inspectLocalRegistryFromFiles(source).errors.join(" ")).toContain("Result");
});

test("asset digests bind exact raw bytes including trailing whitespace", () => {
	const source = files();
	const asset = bind(source, "future", "bytes", Buffer.from("{}\n"));
	expect(admitLocalRegistryFromFiles(source).kind).toBe("admitted");
	source.set(asset, Buffer.from("{} "));
	expect(admitLocalRegistryFromFiles(source)).toMatchObject({ kind: "kit-error" });
	expect(inspectLocalRegistryFromFiles(source).errors.join(" ")).toContain("digest");
});

test.each([
	"duplicate case",
	"duplicate asset",
	"unknown reference",
	"wrong reference type",
	"invalid calendar",
	"missing parent",
	"hardlink target",
	"contradictory assertions",
	"pointer mismatch",
])("definition semantics reject %s", (fault) => {
	const source = files();
	if (fault === "duplicate case") mutate(source, casePath, (doc) => doc.cases.push(doc.cases[0]));
	if (fault === "duplicate asset") mutate(source, indexPath, (doc) => doc.assets.push(doc.assets[0]));
	if (fault === "unknown reference")
		mutate(source, casePath, (doc) => {
			doc.cases[0].input = { kind: "asset", asset: "missing" };
		});
	if (fault === "wrong reference type") {
		bind(source, "future", "tree", encode({ entries: [] }));
		mutate(source, casePath, (doc) => {
			doc.cases[0].input = { kind: "asset", asset: "future" };
		});
	}
	if (fault === "invalid calendar")
		mutate(source, casePath, (doc) => {
			doc.cases[0].at = "2027-02-30T00:00:00Z";
		});
	if (fault === "missing parent")
		bind(source, "future", "tree", encode({ entries: [{ kind: "file", path: "absent/file", bytes: { kind: "hex", value: "00" } }] }));
	if (fault === "hardlink target") bind(source, "future", "tree", encode({ entries: [{ kind: "hardlink", path: "file", target: "absent" }] }));
	if (fault === "contradictory assertions" || fault === "pointer mismatch") {
		bind(source, "future", "result", encode(failure));
		mutate(source, casePath, (doc) => {
			doc.cases[0].expected = {
				kind: "asset",
				asset: "future",
				assertions:
					fault === "pointer mismatch"
						? [{ pointer: "/ok", equals: true }]
						: [
								{ pointer: "/diagnostic", equals: failure.diagnostic },
								{ pointer: "/diagnostic/code", equals: "release-revoked" },
							],
			};
		});
	}
	expect(inspectLocalRegistryFromFiles(source).errors.length).toBeGreaterThan(0);
	expect(admitLocalRegistryFromFiles(source).kind).toBe("kit-error");
});

test.each([
	{
		category: "domain-rejection",
		code: "release-revoked",
		phase: "authorization",
		witnesses: [{ kind: "authority", registry: "finance", release: { packagePath: "example.com/library", version: "1.0.0" }, rule: "namespace-denied" }],
	},
	{
		category: "domain-rejection",
		code: "resource-limit",
		phase: "bundle",
		witnesses: [{ kind: "resource", subject: { kind: "lock" }, resource: "lock-bytes", scope: "profile", maximum: "16777216", observed: "16777218" }],
	},
	{
		category: "domain-rejection",
		code: "resource-limit",
		phase: "bundle",
		witnesses: [{ kind: "resource", subject: { kind: "lock" }, resource: "lock-bytes", scope: "profile", maximum: "1", observed: "2" }],
	},
	{
		category: "invalid-input",
		code: "resolution-invalid",
		phase: "graph",
		witnesses: [{ kind: "resolver", diagnostic: { code: "incomplete-input", missing: [] } }],
	},
	{
		category: "domain-rejection",
		code: "metadata-expired",
		phase: "repository",
		witnesses: [{ kind: "time", registry: "finance", role: "root", at: "2027-01-01T00:00:00Z", boundary: "2028-01-01T00:00:00Z" }],
	},
	{
		category: "domain-rejection",
		code: "metadata-rollback",
		phase: "repository",
		witnesses: [{ kind: "rollback", registry: "finance", role: "targets", trusted: "1", received: "1" }],
	},
	{
		category: "domain-rejection",
		code: "historical-continuity-missing",
		phase: "repository",
		witnesses: [{ kind: "continuity", registry: "finance", fromVersion: "1", throughVersion: "4", missingVersions: ["3", "2"] }],
	},
	{
		category: "domain-rejection",
		code: "publication-conflict",
		phase: "publication",
		witnesses: [{ kind: "revision", expected: { kind: "absent" }, actual: { kind: "absent" } }],
	},
	{ ...failure.diagnostic, witnesses: [failure.diagnostic.witnesses[0], failure.diagnostic.witnesses[0]] },
	{ ...failure.diagnostic, category: "domain-rejection" },
])("diagnostic relationships reject $code", (diagnostic) => {
	const source = files();
	mutate(source, casePath, (doc) => {
		doc.cases[0].expected.result = { ok: false, diagnostic };
	});
	expect(inspectLocalRegistryFromFiles(source).errors.length).toBeGreaterThan(0);
});

test("a fully bound scenario is admitted with complete fixed observations", () => {
	expect(inspectLocalRegistryFromFiles(scenarioFiles()).errors).toEqual([]);
	expect(admitLocalRegistryFromFiles(scenarioFiles()).kind).toBe("admitted");
});

test.each([
	"unknown actor",
	"duplicate operation",
	"missing observation policy",
	"join before start",
	"unreleased barrier",
	"after fault",
	"terminated join",
	"missing tree inventory",
	"wrong result kind",
	"inconsistent graph",
])("scenario semantic checks reject %s", (fault) => {
	const source = scenarioFiles();
	const checkpoint = { operation: "refresh", boundary: "after", step: "security-state-commit", subject: { kind: "repository", registry: "finance" } };
	mutate(source, casePath, (doc) => {
		const scenario = doc.cases[0];
		if (fault === "unknown actor") scenario.operations[0].actor = "missing";
		if (fault === "duplicate operation") scenario.operations.push(scenario.operations[0]);
		if (fault === "missing observation policy") scenario.observe.policies = [];
		if (fault === "join before start") scenario.actions.reverse();
		if (fault === "unreleased barrier") {
			scenario.actions[0].barriers = [checkpoint];
			scenario.actions.splice(1, 0, { kind: "await", checkpoint });
		}
		if (fault === "after fault") {
			scenario.actions[0].barriers = [checkpoint];
			scenario.actions.splice(
				1,
				0,
				{ kind: "await", checkpoint },
				{ kind: "inject-fault", checkpoint, action: "state-write", reason: "no-space" },
				{ kind: "release", checkpoint },
			);
		}
		if (fault === "terminated join") {
			scenario.operations[0].expected = { kind: "terminated", checkpoint };
			scenario.actions[0].barriers = [checkpoint];
			scenario.actions.splice(1, 0, { kind: "await", checkpoint }, { kind: "terminate", checkpoint });
		}
		if (fault === "wrong result kind")
			scenario.operations[0].expected.result = { ok: true, kind: "publication", outcome: "committed", timestampDigest: `sha256:${"0".repeat(64)}` };
		if (fault === "inconsistent graph") {
			scenario.operations[0].name = "resolve-library";
			scenario.operations[0].input = { root: { packagePath: "example.com/root", version: "1.0.0" }, registries: ["finance"] };
			scenario.operations[0].expected.result = { ok: true, kind: "graph-ready", graph: { root: scenario.operations[0].input.root, nodes: [] }, verified: [] };
		}
	});
	if (fault === "missing tree inventory") {
		const observations = JSON.parse(Buffer.from(source.get(`${prefix}mck/fixtures/local-registry/assets/observations.json`) as Uint8Array).toString());
		observations.filesystems.pop();
		bind(source, "observations", "observations", encode(observations));
	}
	expect(inspectLocalRegistryFromFiles(source).errors.length).toBeGreaterThan(0);
});

test("executable identity hashes every consumed raw file with the shared repository-relative framing", () => {
	const source = scenarioFiles();
	const admission = admitLocalRegistryFromFiles(source);
	if (admission.kind !== "admitted") throw new Error(admission.errors.join(" "));
	expect(admission.value.contentHash).toBe(contentHash(source));
	for (const name of [indexPath, casePath, schemaPath, `${prefix}mck/README.md`]) {
		const changed = new Map(source);
		changed.set(name, Buffer.concat([Buffer.from(changed.get(name) as Uint8Array), Buffer.from("\n")]));
		const next = admitLocalRegistryFromFiles(changed);
		if (next.kind !== "admitted") throw new Error(next.errors.join(" "));
		expect(next.value.contentHash).not.toBe(admission.value.contentHash);
	}
});

test("unknown local schema identifiers and references never resolve over the network", () => {
	for (const property of ["$id", "$ref"]) {
		const source = files();
		mutate(source, schemaPath, (schema) => {
			schema[property] = "https://unregistered.invalid/schema";
		});
		expect(inspectLocalRegistryFromFiles(source).errors.join(" ")).toContain("unknown local schema ID");
	}
});

test("transitive registered local schema bytes participate in executable corpus identity", () => {
	const source = scenarioFiles();
	const id = "https://morphir.finos.org/spec/package/0.1.0-draft.1/library-manifest.schema.json";
	const name = `${prefix}schemas/library-manifest.schema.json`;
	mutate(source, schemaPath, (schema) => {
		schema.$defs.Index.allOf = [{ $ref: `${id}#/$defs/IndexExtension` }];
	});
	source.set(name, encode({ $id: id, $defs: { IndexExtension: { type: "object" } } }));
	const first = admitLocalRegistryFromFiles(source);
	if (first.kind !== "admitted") throw new Error(first.errors.join(" "));
	expect(first.value.contentHash).toBe(contentHash(source));
	source.set(name, Buffer.concat([Buffer.from(source.get(name) as Uint8Array), Buffer.from("\n")]));
	const second = admitLocalRegistryFromFiles(source);
	if (second.kind !== "admitted") throw new Error(second.errors.join(" "));
	expect(second.value.contentHash).not.toBe(first.value.contentHash);
	source.delete(name);
	expect(admitLocalRegistryFromFiles(source).kind).toBe("kit-error");
});

test("asset closure visits transitive tree bytes and rejects pending transitive inputs", () => {
	const source = files();
	bind(source, "expected", "result", encode(failure));
	mutate(source, casePath, (doc) => {
		doc.cases[0].expected = { kind: "asset", asset: "expected", assertions: [{ pointer: "/ok", equals: false }] };
	});
	expect(admitExactCaseForTesting(fileMapSource(source), parseCase.id).kind).toBe("admitted");
	expect(admitLocalRegistryFromFiles(source).kind).toBe("kit-error");
	const scenario = scenarioFiles();
	bind(scenario, "future", "tree", encode({ entries: [{ kind: "file", path: "negative.json", bytes: { kind: "asset", asset: "missing-bytes" } }] }));
	mutate(scenario, indexPath, (index) => index.assets.push({ id: "missing-bytes", kind: "pending", type: "bytes", purpose: "Awaiting exact bytes" }));
	expect(inspectLocalRegistryFromFiles(scenario).errors).toEqual([]);
	expect(admitExactCaseForTesting(fileMapSource(scenario), "local-registry.wire.scenario").kind).toBe("kit-error");
});

test("admitted case values retain exact input bytes and defend their invariants against mutation", () => {
	const source = files();
	bind(source, "future", "bytes", Buffer.from([0xef, 0xbb, 0xbf, 0xff, 0x0a]));
	mutate(source, casePath, (doc) => {
		doc.cases[0].input = { kind: "asset", asset: "future" };
	});
	const admission = admitLocalRegistryFromFiles(source);
	if (admission.kind !== "admitted") throw new Error(admission.errors.join(" "));
	const entry = admission.value.cases[0];
	if (!entry) throw new Error("missing admitted case");
	entry.assetBytes("future").fill(0);
	const expectations = entry.expectations();
	const result = expectations.get(parseCase.id) as { ok: boolean };
	result.ok = true;
	expect(entry.assetBytes("future")).toEqual(new Uint8Array([0xef, 0xbb, 0xbf, 0xff, 0x0a]));
	expect(entry.expectations().get(parseCase.id)).toEqual(failure);
});

test("operation named observations retains its result separately from the final snapshot", () => {
	const source = scenarioFiles();
	mutate(source, casePath, (doc) => {
		doc.cases[0].operations[0].id = "observations";
		for (const action of doc.cases[0].actions) action.operation = "observations";
	});
	const admission = admitLocalRegistryFromFiles(source);
	if (admission.kind !== "admitted") throw new Error(admission.errors.join(" "));
	const entry = admission.value.cases[0];
	if (!entry) throw new Error("missing admitted case");
	expect(entry.expectations().get("observations")).toEqual(failure);
	expect(entry.observations()).toMatchObject({ readyGraphs: [], lockBytes: [], security: [{ actor: "client" }] });
});

test("repository loading rejects asset symlink escapes and missing fixture bytes", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "mck-local-registry-"));
	const outside = mkdtempSync(path.join(os.tmpdir(), "mck-local-registry-outside-"));
	try {
		const source = scenarioFiles();
		for (const [name, bytes] of source) {
			const target = path.join(root, name);
			mkdirSync(path.dirname(target), { recursive: true });
			writeFileSync(target, bytes);
		}
		const asset = path.join(root, `${prefix}mck/fixtures/local-registry/assets/future.json`);
		rmSync(asset);
		expect(admitLocalRegistryRepository(root).kind).toBe("kit-error");
		const external = path.join(outside, "tree.json");
		writeFileSync(external, encode({ entries: [] }));
		symlinkSync(external, asset);
		const admission = admitLocalRegistryRepository(root);
		expect(admission.kind).toBe("kit-error");
		if (admission.kind === "kit-error") expect(admission.errors.join(" ")).toContain("confined");
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("library exports distinguish inspection and full admission without exposing subset claims", () => {
	expect(publicApi.inspectLocalRegistryFromFiles(files()).kind).toBe("definition-summary");
	expect(publicApi.admitLocalRegistryFromFiles(files()).kind).toBe("kit-error");
	expect(publicApi).not.toHaveProperty("admitExactCaseForTesting");
});

test("invalid input quoted in a diagnostic is data, not a calendar field", () => {
	const source = files();
	mutate(source, casePath, (doc) => {
		doc.cases[0].expected.result.diagnostic = {
			category: "unsupported-capability",
			code: "unsupported-profile",
			phase: "support",
			witnesses: [{ kind: "unsupported", subject: { kind: "lock" }, pointer: "/kind", value: "2027-02-30T00:00:00Z" }],
		};
	});
	expect(inspectLocalRegistryFromFiles(source).errors).toEqual([]);
});

test("bound publication rollback may report equality with a reserved role floor", () => {
	const source = scenarioFiles();
	const diagnostic = {
		category: "domain-rejection",
		code: "metadata-rollback",
		phase: "publication",
		witnesses: [{ kind: "rollback", registry: "finance", role: "targets", trusted: "2", received: "2" }],
	};
	bind(source, "rollback", "result", encode({ ok: false, diagnostic }));
	mutate(source, casePath, (doc) => {
		const operation = doc.cases[0].operations[0];
		operation.name = "publish-library";
		operation.input = {
			registry: "finance",
			bundle: { asset: "future" },
			record: { kind: "hex", value: "00" },
			envelope: { kind: "hex", value: "00" },
			predecessor: { kind: "hex", value: "00" },
			proposal: { asset: "future" },
		};
		operation.expected = { kind: "asset", asset: "rollback", assertions: [{ pointer: "/ok", equals: false }] };
	});
	expect(inspectLocalRegistryFromFiles(source).errors).toEqual([]);
	expect(admitLocalRegistryFromFiles(source).kind).toBe("admitted");
});

test("clock rollback observations may retain a later successful authorization time", () => {
	const source = scenarioFiles();
	const name = `${prefix}mck/fixtures/local-registry/assets/observations.json`;
	const observations = JSON.parse(Buffer.from(source.get(name) as Uint8Array).toString());
	observations.security[0].repositories[0].lastFreshAuthorization = { kind: "at", time: "2027-01-02T00:00:00Z" };
	bind(source, "observations", "observations", encode(observations));
	expect(inspectLocalRegistryFromFiles(source).errors).toEqual([]);
});

test.each(["resource-limit", "io-failure", "unsafe-path"])("fatal %s diagnostics report exactly one witness", (code) => {
	const source = scenarioFiles();
	const witnesses =
		code === "resource-limit"
			? [
					{ kind: "resource", subject: { kind: "policy" }, resource: "policy-bytes", scope: "profile", maximum: "1048576", observed: "1048577" },
					{ kind: "resource", subject: { kind: "lock" }, resource: "lock-bytes", scope: "profile", maximum: "16777216", observed: "16777217" },
				]
			: code === "io-failure"
				? [
						{ kind: "io", subject: { kind: "lock" }, action: "open", reason: "permission" },
						{ kind: "io", subject: { kind: "policy" }, action: "open", reason: "permission" },
					]
				: [
						{ kind: "path", subject: { kind: "lock" }, rule: "escape" },
						{ kind: "path", subject: { kind: "policy" }, rule: "escape" },
					];
	mutate(source, casePath, (doc) => {
		doc.cases[0].operations[0].expected.result = {
			ok: false,
			diagnostic: { category: code === "io-failure" ? "operational-failure" : "domain-rejection", code, phase: "repository", witnesses },
		};
	});
	expect(inspectLocalRegistryFromFiles(source).errors.join(" ")).toContain("one witness");
});

test("logical actor aliases remain distinct from physical registry root owners", () => {
	const source = scenarioFiles();
	const config = JSON.parse(Buffer.from(source.get(`${prefix}mck/fixtures/local-registry/assets/configuration.json`) as Uint8Array).toString());
	config.bindings[0].registryRoot = "finance-root";
	bind(source, "configuration", "configuration", encode(config));
	const observations = JSON.parse(Buffer.from(source.get(`${prefix}mck/fixtures/local-registry/assets/observations.json`) as Uint8Array).toString());
	observations.registries[0].registry = "finance-root";
	observations.filesystems[2].root.owner = "finance-root";
	bind(source, "observations", "observations", encode(observations));
	mutate(source, casePath, (doc) => {
		const scenario = doc.cases[0];
		scenario.setup.registries[0].id = "finance-root";
		const checkpoint = { operation: "refresh", boundary: "before", step: "security-state-commit", subject: { kind: "repository", registry: "finance" } };
		scenario.actions[0].barriers = [checkpoint];
		scenario.actions.splice(1, 0, { kind: "await", checkpoint }, { kind: "release", checkpoint });
	});
	expect(inspectLocalRegistryFromFiles(source).errors).toEqual([]);
	expect(admitLocalRegistryFromFiles(source).kind).toBe("admitted");
	mutate(source, casePath, (doc) => {
		doc.cases[0].operations[0].input.registry = "finance-root";
	});
	expect(inspectLocalRegistryFromFiles(source).errors.join(" ")).toContain("alias");
});

test.each(["private-index.json", "metadata", `bundles/${"0".repeat(64)}`])(
	"cache observations exclude private or incomplete cache projection %s",
	(entryPath) => {
		const source = scenarioFiles();
		const observations = JSON.parse(Buffer.from(source.get(`${prefix}mck/fixtures/local-registry/assets/observations.json`) as Uint8Array).toString());
		observations.filesystems[0].entries = entryPath.startsWith("bundles/")
			? [
					{ kind: "directory", path: "bundles" },
					{ kind: "directory", path: entryPath },
				]
			: [{ kind: "file", path: entryPath, length: "0", sha256: `sha256:${createHash("sha256").update("").digest("hex")}` }];
		bind(source, "observations", "observations", encode(observations));
		expect(inspectLocalRegistryFromFiles(source).errors.join(" ")).toContain("cache");
	},
);
