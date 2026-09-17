// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

// Explicit opt-in integration: the canonical corpus belongs to the parent repository.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalize } from "@tufjs/canonical-json";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalizePackageDocument, normalizedPackageDigests, packageFileDigest } from "../../src/package/metadata.ts";
import {
	FIXTURE_CLOCK,
	FIXTURE_INPUT_DIGESTS,
	FIXTURE_VERSION,
	type FixtureManifest,
	type FixtureOldLock,
	type FixturePayload,
	type FixtureRelease,
	generateSignedFixture,
} from "./package-signed-fixture.ts";
import { checkFixtureFiles, readFixtureInputs } from "./package-signed-fixture-io.ts";
import { verifyFixtureTuf } from "./package-signed-fixture-tuf.ts";
import type { DsseEnvelope } from "./package-signing.ts";
import { verifyFixtureDsse } from "./package-signing-verifier.ts";

interface Reference {
	path: string;
	digest: string;
}
interface RecordDocument extends FixturePayload {
	source: { kind: string; path: string };
	statement: Reference;
}
interface Evidence extends Reference {
	id: string;
	registry: string;
	kind: string;
}
interface Lock {
	graph: {
		root: FixtureRelease;
		nodes: {
			release: FixtureRelease;
			irPackageName: string;
			manifestDigest: string;
			contentDigest: string;
			bindings: { irPackageName: string; target: FixtureRelease }[];
		}[];
	};
	resolution: object;
	registries: object[];
	acquisitions: { release: FixtureRelease; registry: string; record: Reference; source: RecordDocument["source"]; statement: string }[];
	evidence: Evidence[];
}
interface Policy {
	repositories: { identity: string; bootstrapRoot: { version: number; digest: string }; namespaces: string[] }[];
	publisherRules: { namespace: string; publicKeys: string[]; threshold: number }[];
	continuedUse: string;
}
interface Target {
	length: number;
	hashes: { sha256: string };
	custom: { morphir: object };
}
interface Role {
	signed: {
		_type: string;
		spec_version: string;
		version: number;
		expires: string;
		targets?: Record<string, Target>;
		keys?: Record<string, { keyval: { public: string } }>;
	};
}

const options = new Map<string, string>();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
	const key = args[index];
	const value = args[index + 1];
	assert(
		key && ["--source", "--fixture"].includes(key) && value && !value.startsWith("--") && !options.has(key),
		"Expected explicit --source <parent-root> --fixture <signed-directory>",
	);
	options.set(key, value);
}
const source = options.get("--source");
const fixture = options.get("--fixture");
assert(source && fixture && options.size === 2, "Expected explicit --source <parent-root> --fixture <signed-directory>");
const inputs = await readFixtureInputs(source);
const files = generateSignedFixture(inputs);
assert.equal(files.size, 19, "complete generated file set");
await checkFixtureFiles(fixture, files);
assert.deepEqual([...files.keys()], [...files.keys()].sort(), "output map order");
const bytes = (path: string): Uint8Array => {
	const value = files.get(path);
	assert(value, `missing generated file: ${path}`);
	return value;
};
const text = (path: string): string => Buffer.from(bytes(path)).toString("utf8");
const document = <T>(path: string): T => JSON.parse(text(path)) as T;
const input = (path: string): Uint8Array => {
	const value = inputs.get(`spec/package/mck/fixtures/${path}`);
	assert(value);
	return value;
};
const parseInput = <T>(path: string): T => JSON.parse(Buffer.from(input(path)).toString("utf8")) as T;
const physical = (reference: Reference): string => {
	const slash = reference.path.lastIndexOf("/");
	return `registry/targets/${reference.path.slice(0, slash + 1)}${reference.digest.slice(7)}.${reference.path.slice(slash + 1)}`;
};

// Register all referenced schemas locally; no network resolver is installed.
const ajv = new Ajv2020({ allErrors: true, strict: false });
for (const name of [
	"library-manifest",
	"lock-core",
	"resolution-input",
	"resolution-result",
	"resolution-case",
	"library-lock",
	"registry-record",
	"release-statement",
	"package-trust-policy",
	"local-registry-case",
])
	ajv.addSchema(JSON.parse(await readFile(resolve(source, `spec/package/schemas/${name}.schema.json`), "utf8")));
const validate = (name: string, value: unknown, version = FIXTURE_VERSION, fragment = "") => {
	const schema = ajv.getSchema(`https://morphir.finos.org/spec/package/${version}/${name}.schema.json${fragment}`);
	assert(schema, `missing schema: ${name}${fragment}`);
	assert(schema(value), `${name}${fragment}: ${ajv.errorsText(schema.errors)}`);
};
const lock = document<Lock>("morphir.lock");
const policy = document<Policy>("trust-policy.json");
validate("library-lock", lock);
validate("package-trust-policy", policy);
validate("local-registry-case", document("view-one.json"), FIXTURE_VERSION, "#/$defs/Tree");
validate("local-registry-case", document("empty-cache.json"), FIXTURE_VERSION, "#/$defs/Tree");
validate("local-registry-case", document("configuration-one.json"), FIXTURE_VERSION, "#/$defs/Configuration");
assert.deepEqual(lock.resolution, {
	policy: "flat-library:0.1.0-draft.2",
	profile: "local-library",
	requiredCapabilities: ["dsse-ed25519", "local-directory", "tuf-1.0.36"],
});
assert.deepEqual(lock.registries, [{ id: "finance", snapshot: "finance-snapshot" }]);
const old = parseInput<FixtureOldLock>("two-libraries/lock-core.json");
const oldRoot = old.nodes[old.root];
assert(oldRoot);
assert.deepEqual(lock.graph.root, oldRoot.release);
assert.deepEqual(
	lock.graph.nodes.map((node) => node.release),
	[
		oldRoot.release,
		...Object.entries(old.nodes)
			.filter(([id]) => id !== old.root)
			.map(([, node]) => node.release),
	],
);
for (const node of lock.graph.nodes) {
	const prior = Object.values(old.nodes).find((item) => item.release.packagePath === node.release.packagePath);
	assert(prior);
	assert.deepEqual({ ...node, bindings: undefined }, { ...prior, bindings: undefined });
	assert.deepEqual(
		node.bindings,
		Object.entries(prior.bindings)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([irPackageName, id]) => ({ irPackageName, target: old.nodes[id]?.release })),
	);
}
assert.deepEqual(
	lock.acquisitions.map((item) => item.release.packagePath),
	["example.com/finance/eligibility", "example.com/finance/loan-rules"],
);
assert.deepEqual(
	lock.evidence.map((item) => item.id),
	["eligibility-statement", "finance-root", "finance-snapshot", "finance-targets", "finance-timestamp", "loan-rules-statement"],
);
const rule = policy.publisherRules[0];
const repository = policy.repositories[0];
assert(rule && repository);
assert.equal(rule.namespace, "example.com/finance");
assert.equal(rule.threshold, 1);
assert.equal(rule.publicKeys.length, 2);
assert.deepEqual(rule.publicKeys, [...rule.publicKeys].sort());
assert.equal(policy.continuedUse, "previous-authorization");
assert.deepEqual(repository.namespaces, ["example.com/finance"]);
assert.deepEqual(repository.bootstrapRoot, { version: 1, digest: packageFileDigest(bytes("registry/metadata/1.root.json")) });
const root = document<Role>("registry/metadata/1.root.json");
assert.equal(repository.identity, packageFileDigest(Buffer.from(canonicalize(root.signed))));
const roleKeys = Object.values(root.signed.keys ?? {}).map((key) => key.keyval.public);
assert.equal(roleKeys.length, 4);
assert.equal(new Set([...roleKeys, ...rule.publicKeys]).size, 6);
const targets = document<Role>("registry/metadata/1.targets.json").signed.targets;
assert(targets);
assert.deepEqual(Object.keys(targets), [
	"records/eligibility-1.2.0.json",
	"records/loan-rules-1.0.0.json",
	"statements/eligibility-1.2.0.json",
	"statements/loan-rules-1.0.0.json",
]);
for (const acquisition of lock.acquisitions) {
	const recordPath = physical(acquisition.record);
	const record = document<RecordDocument>(recordPath);
	validate("registry-record", record);
	assert.equal(text(recordPath), `${canonicalizePackageDocument(text(recordPath))}\n`);
	assert.equal(packageFileDigest(bytes(recordPath)), acquisition.record.digest);
	assert.deepEqual(record.release, acquisition.release);
	assert.deepEqual(record.source, acquisition.source);
	assert.equal(acquisition.registry, "finance");
	const evidence = lock.evidence.find((item) => item.id === acquisition.statement);
	assert(evidence);
	assert.equal(evidence.kind, "release-statement");
	assert.equal(evidence.registry, "finance");
	assert.deepEqual(record.statement, { path: evidence.path, digest: evidence.digest });
	const envelope = document<DsseEnvelope>(physical(record.statement));
	assert(verifyFixtureDsse(envelope, rule.publicKeys, 2), "both authorized publishers verify independently");
	const payloadBytes = Buffer.from(envelope.payload, "base64");
	const payload = JSON.parse(payloadBytes.toString("utf8")) as FixturePayload;
	validate("release-statement", payload);
	assert.equal(payloadBytes.toString("utf8"), canonicalizePackageDocument(payloadBytes.toString("utf8")));
	const { source: _source, statement: _statement, ...recordPayload } = record;
	assert.deepEqual(payload, { ...recordPayload, kind: "LibraryReleaseStatement" });
	const bundle = `registry/${record.source.path}`;
	const manifest = document<FixtureManifest>(`${bundle}/manifest.json`);
	validate("library-manifest", manifest, "0.1.0-draft.1");
	const digests = normalizedPackageDigests(text(`${bundle}/manifest.json`));
	assert.equal(record.manifestDigest, digests.manifestDigest);
	assert.equal(record.contentDigest, digests.packageContentDigest);
	assert.deepEqual(record.release, { packagePath: manifest.packagePath, version: manifest.version });
	assert.equal(record.irPackageName, manifest.ir.packageName);
	assert.deepEqual(
		record.dependencies,
		Object.entries(manifest.dependencies)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([irPackageName, requirement]) => ({ irPackageName, ...requirement })),
	);
	const name = record.release.packagePath.split("/").at(-1);
	assert(name);
	assert.deepEqual(bytes(`${bundle}/manifest.json`), input(`two-libraries/${name}/manifest.json`));
	for (const [path, digest] of Object.entries(manifest.content)) {
		assert.equal(packageFileDigest(bytes(`${bundle}/${path}`)), digest);
		assert.deepEqual(bytes(`${bundle}/${path}`), input(`two-libraries/${name}/${path}`));
	}
	const ir = document<{ distribution: { Library: { packageName: string; dependencies: object } } }>(`${bundle}/ir.json`);
	assert.equal(ir.distribution.Library.packageName, manifest.ir.packageName);
	assert.deepEqual(
		Object.keys(ir.distribution.Library.dependencies),
		record.dependencies.map((item) => item.irPackageName),
	);
	if (name === "loan-rules") assert(text(`${bundle}/ir.json`).includes('"Reference": "example/eligibility:decision#default-decision"'));
	const graphNode = lock.graph.nodes.find((node) => node.release.packagePath === record.release.packagePath);
	assert(graphNode);
	assert.equal(graphNode.manifestDigest, record.manifestDigest);
	assert.equal(graphNode.contentDigest, record.contentDigest);
	assert.equal(graphNode.irPackageName, record.irPackageName);
	for (const [reference, kind] of [
		[acquisition.record, "LibraryRelease"],
		[record.statement, "LibraryReleaseStatement"],
	] as const) {
		const target: Target | undefined = targets[reference.path];
		assert(target);
		const stored = bytes(physical(reference));
		assert.equal(stored.byteLength, target.length);
		assert.equal(packageFileDigest(stored), reference.digest);
		assert.equal(target.hashes.sha256, reference.digest.slice(7));
		assert.deepEqual(target.custom.morphir, {
			formatVersion: FIXTURE_VERSION,
			kind,
			release: record.release,
			...(kind === "LibraryRelease" ? { status: "active" } : {}),
		});
	}
}
for (const item of lock.evidence) {
	assert.equal(item.registry, "finance");
	const path = item.kind === "release-statement" ? physical(item) : `registry/${item.path}`;
	assert.equal(packageFileDigest(bytes(path)), item.digest);
	if (item.kind !== "release-statement") {
		const role = document<Role>(path).signed;
		assert.equal(role._type, item.kind.slice(4));
		assert.equal(role.version, 1);
		assert.equal(role.spec_version, "1.0.36");
		assert(Date.parse(role.expires) > Date.parse(FIXTURE_CLOCK));
	}
}
assert.deepEqual(bytes("registry/metadata/timestamp.json"), bytes("registry/metadata/1.timestamp.json"));
const registryFiles = [...files].filter(([path]) => path.startsWith("registry/"));
const tree = document<{ entries: ({ kind: "directory"; path: string } | { kind: "file"; path: string; bytes: { kind: string; value: string } })[] }>(
	"view-one.json",
);
assert.deepEqual(
	tree.entries.map((entry) => entry.path),
	tree.entries.map((entry) => entry.path).sort(),
);
assert.deepEqual(
	tree.entries.filter((entry) => entry.kind === "file").map((entry) => [entry.path, entry.bytes]),
	registryFiles.map(([path, data]) => [path.slice(9), { kind: "hex", value: Buffer.from(data).toString("hex") }]),
);
for (const entry of tree.entries) {
	const parts = entry.path.split("/");
	for (let index = 1; index < parts.length; index++)
		assert(tree.entries.some((item) => item.kind === "directory" && item.path === parts.slice(0, index).join("/")));
}
assert.deepEqual(document("empty-cache.json"), { entries: [] });
assert.deepEqual(document("configuration-one.json"), {
	bindings: [{ alias: "finance", registryRoot: "finance", identity: repository.identity }],
	bootstrapRoots: [
		{ identity: repository.identity, version: "1", bytes: { kind: "hex", value: Buffer.from(bytes("registry/metadata/1.root.json")).toString("hex") } },
	],
});
const description = document<{ fixedClock: string; inputDigests: Record<string, string>; publicKeys: { label: string; publicKey: string }[] }>(
	"fixture-description.json",
);
assert.equal(description.fixedClock, FIXTURE_CLOCK);
assert.deepEqual(description.inputDigests, Object.fromEntries(Object.entries(FIXTURE_INPUT_DIGESTS).map(([path, digest]) => [path, `sha256:${digest}`])));
for (const [path, data] of inputs) assert.equal(packageFileDigest(data), description.inputDigests[path]);
assert.deepEqual(
	description.publicKeys.map((key) => key.label),
	["root", "timestamp", "snapshot", "targets", "publisher-a", "publisher-b"],
);
assert.equal(new Set(description.publicKeys.map((key) => key.publicKey)).size, 6);
await verifyFixtureTuf(files, FIXTURE_CLOCK);
// Validate fixed parent expectations; authoring never creates expected results or security state.
const parentJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(resolve(source, "spec/package/mck", path), "utf8")) as T;
const index = await parentJson<{ assets: ({ kind: "pending"; id: string } | { kind: "bound"; id: string; path: string; length: string; sha256: string })[] }>(
	"local-registry-cases.json",
);
validate("local-registry-case", index, FIXTURE_VERSION, "#/$defs/Index");
const bound = index.assets.filter((asset) => asset.kind === "bound");
assert.deepEqual(
	bound.map((asset) => asset.id),
	["view-one", "empty-cache", "configuration-one", "policy-one", "lock-two", "observations-wire-valid-two-node"],
);
for (const asset of bound) {
	const stored: Uint8Array = await readFile(resolve(source, "spec/package/mck", asset.path));
	assert.equal(String(stored.byteLength), asset.length, `bound length: ${asset.id}`);
	assert.equal(packageFileDigest(stored), asset.sha256, `bound digest: ${asset.id}`);
}
const observations = await parentJson<unknown>("fixtures/local-registry/expected/observations-wire-valid-two-node.json");
validate("local-registry-case", observations, FIXTURE_VERSION, "#/$defs/Observations");
const wire = await parentJson<{
	cases: {
		id: string;
		expectedObservations?: { asset: string; assertions: { pointer: string; equals: unknown }[] };
		operations?: { expected: { result: { graph: unknown } } }[];
	}[];
}>("fixtures/local-registry/cases/wire.json");
validate("local-registry-case", wire);
const scenario = wire.cases.find((item) => item.id === "local-registry.wire.valid-two-node");
assert(scenario?.expectedObservations && scenario.operations?.[0]);
assert.equal(scenario.expectedObservations.asset, "observations-wire-valid-two-node");
assert.deepEqual(scenario.operations[0].expected.result.graph, lock.graph);
for (const assertion of scenario.expectedObservations.assertions) {
	let value: unknown = observations;
	for (const component of assertion.pointer.slice(1).split("/")) {
		assert(value && typeof value === "object");
		value = (value as Record<string, unknown>)[component.replace(/~1/g, "/").replace(/~0/g, "~")];
	}
	assert.deepEqual(value, assertion.equals, `fixed observation pointer: ${assertion.pointer}`);
}
const bytesSchema = ajv.getSchema(`https://morphir.finos.org/spec/package/${FIXTURE_VERSION}/local-registry-case.schema.json#/$defs/Bytes`);
assert(bytesSchema);
const rootHex = Buffer.from(bytes("registry/metadata/1.root.json")).toString("hex");
assert(rootHex.length > 4000 && bytesSchema({ kind: "hex", value: rootHex }), "long exact root hex remains valid");
assert(!bytesSchema({ kind: "hex", value: rootHex.slice(1) }), "odd-length hex is invalid");
assert(!bytesSchema({ kind: "hex", value: `${rootHex.slice(0, -1)}z` }), "nonhex is invalid");
console.log(`Signed fixture integration passed: ${files.size} exact files, two Libraries, four independently verified TUF targets`);
