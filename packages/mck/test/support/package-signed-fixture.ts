// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

// Authoring-only: deterministic public seeds are not production credentials.
import assert from "node:assert/strict";
import { canonicalize } from "@tufjs/canonical-json";
import { canonicalizePackageDocument, normalizedPackageDigests, packageFileDigest } from "../../src/package/metadata.ts";
import { fixtureKey, signFixtureDsse, signFixtureTuf, tufKeyId, tufPublicKey } from "./package-signing.ts";

export const FIXTURE_CLOCK = "2027-01-01T00:00:00Z";
export const FIXTURE_VERSION = "0.1.0-draft.3";
const base = "spec/package/mck/fixtures/";
export const FIXTURE_INPUT_DIGESTS: Readonly<Record<string, string>> = {
	[`${base}two-libraries/eligibility/manifest.json`]: "0a91b5e3a5e377fa4557212fc5b561a66067d67292123136575e46ce5a3fd0b7",
	[`${base}two-libraries/eligibility/ir.json`]: "243e640848e5ee728224c0bc9090c67cf434d9814cec77745daad918119ceb43",
	[`${base}two-libraries/loan-rules/manifest.json`]: "e98ea924e66b96a5050e2c3a690f9534db32f5971401d2965791546872ecb7a3",
	[`${base}two-libraries/loan-rules/ir.json`]: "b1884eeb8364f96c6405cc45f2fe07a006c22f066a4136656ad05dda9c9a94cc",
	[`${base}two-libraries/lock-core.json`]: "6470c10d02092c9bf6c2ba9d945c88d2d0310cad2fffc25226acd87f85e3129b",
	[`${base}local-registry/unsigned/eligibility-statement-payload.json`]: "98b42b54516d679247a649a95c554dd310f71be357046ad3ecd81f4e3b0d7d31",
	[`${base}local-registry/unsigned/loan-rules-statement-payload.json`]: "b6c9301e78a523f8037dd6bf1fbd2b7ca89aa836b293e13d72f776db26a6d683",
};

export interface FixtureRelease {
	readonly packagePath: string;
	readonly version: string;
}
export interface FixtureRequirement {
	readonly irPackageName: string;
	readonly packagePath: string;
	readonly versionRange: { readonly minimumInclusive: string; readonly maximumExclusive: string };
}
export interface FixturePayload {
	readonly formatVersion: string;
	readonly kind: string;
	readonly release: FixtureRelease;
	readonly irPackageName: string;
	readonly dependencies: readonly FixtureRequirement[];
	readonly manifestDigest: string;
	readonly contentDigest: string;
}
export interface FixtureManifest {
	readonly packagePath: string;
	readonly version: string;
	readonly ir: { readonly packageName: string };
	readonly dependencies: Readonly<Record<string, Omit<FixtureRequirement, "irPackageName">>>;
	readonly content: Readonly<Record<string, string>>;
}
export interface FixtureOldNode {
	readonly release: FixtureRelease;
	readonly irPackageName: string;
	readonly manifestDigest: string;
	readonly contentDigest: string;
	readonly bindings: Readonly<Record<string, string>>;
}
export interface FixtureOldLock {
	readonly root: string;
	readonly nodes: Readonly<Record<string, FixtureOldNode>>;
}

const ascii = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const pretty = (value: unknown): Uint8Array => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const canonical = (value: unknown): string => canonicalizePackageDocument(JSON.stringify(value));
const hex = (bytes: Uint8Array): string => packageFileDigest(bytes).slice(7);
const link = (bytes: Uint8Array) => ({ length: bytes.byteLength, hashes: { sha256: hex(bytes) } });
const bytesValue = (bytes: Uint8Array) => ({ kind: "hex", value: Buffer.from(bytes).toString("hex") });

export function generateSignedFixture(inputs: ReadonlyMap<string, Uint8Array>): ReadonlyMap<string, Uint8Array> {
	for (const [path, digest] of Object.entries(FIXTURE_INPUT_DIGESTS)) {
		const bytes = inputs.get(path);
		assert(bytes, `missing input: ${path}`);
		assert.equal(hex(bytes), digest, `input digest: ${path}`);
	}
	assert.equal(inputs.size, Object.keys(FIXTURE_INPUT_DIGESTS).length, "unexpected fixture input");
	const input = (path: string): Uint8Array => {
		const value = inputs.get(base + path);
		assert(value);
		return value;
	};
	const parse = <T>(path: string): T => JSON.parse(Buffer.from(input(path)).toString("utf8")) as T;
	const publishers = [fixtureKey("publisher-a"), fixtureKey("publisher-b")];
	const roles = ["root", "timestamp", "snapshot", "targets"] as const;
	const keys = Object.fromEntries(roles.map((role) => [role, fixtureKey(role)]));
	const files = new Map<string, Uint8Array>();
	const targets: Record<string, object> = {};
	const acquisitions: object[] = [];
	const evidence: { id: string; registry: string; kind: string; path: string; digest: string }[] = [];
	for (const name of ["eligibility", "loan-rules"]) {
		const manifestBytes = input(`two-libraries/${name}/manifest.json`);
		const manifest = parse<FixtureManifest>(`two-libraries/${name}/manifest.json`);
		const payload = parse<FixturePayload>(`local-registry/unsigned/${name}-statement-payload.json`);
		const digests = normalizedPackageDigests(Buffer.from(manifestBytes).toString("utf8"));
		const dependencies = Object.entries(manifest.dependencies)
			.sort(([a], [b]) => ascii(a, b))
			.map(([irPackageName, requirement]) => ({ irPackageName, ...requirement }));
		assert.deepEqual(payload, {
			formatVersion: FIXTURE_VERSION,
			kind: "LibraryReleaseStatement",
			release: { packagePath: manifest.packagePath, version: manifest.version },
			irPackageName: manifest.ir.packageName,
			dependencies,
			manifestDigest: digests.manifestDigest,
			contentDigest: digests.packageContentDigest,
		});
		const source = { kind: "registry-directory", path: `bundles/${payload.contentDigest.slice(7)}` };
		files.set(`registry/${source.path}/manifest.json`, manifestBytes.slice());
		for (const [path, digest] of Object.entries(manifest.content)) {
			const bytes = input(`two-libraries/${name}/${path}`);
			assert.equal(packageFileDigest(bytes), digest, `declared content: ${name}/${path}`);
			files.set(`registry/${source.path}/${path}`, bytes.slice());
		}
		const statementPath = `statements/${name}-${manifest.version}.json`;
		const recordPath = `records/${name}-${manifest.version}.json`;
		const envelope = pretty(signFixtureDsse(Buffer.from(canonical(payload)), publishers));
		const statement = { path: statementPath, digest: packageFileDigest(envelope) };
		const record = { ...payload, kind: "LibraryRegistryRecord", source, statement };
		const recordBytes = Buffer.from(`${canonical(record)}\n`);
		for (const [path, bytes, morphir] of [
			[statementPath, envelope, { formatVersion: FIXTURE_VERSION, kind: "LibraryReleaseStatement", release: payload.release }],
			[recordPath, recordBytes, { formatVersion: FIXTURE_VERSION, kind: "LibraryRelease", release: payload.release, status: "active" }],
		] as const) {
			const slash = path.lastIndexOf("/");
			files.set(`registry/targets/${path.slice(0, slash + 1)}${hex(bytes)}.${path.slice(slash + 1)}`, bytes);
			targets[path] = { ...link(bytes), custom: { morphir } };
		}
		acquisitions.push({
			release: payload.release,
			registry: "finance",
			record: { path: recordPath, digest: packageFileDigest(recordBytes) },
			source,
			statement: `${name}-statement`,
		});
		evidence.push({ id: `${name}-statement`, registry: "finance", kind: "release-statement", ...statement });
	}
	const roleKey = (role: (typeof roles)[number]) => {
		const key = keys[role];
		assert(key);
		return key;
	};
	const body = (role: (typeof roles)[number], expires: string) => ({ _type: role, spec_version: "1.0.36", version: 1, expires });
	const rootBody = {
		...body("root", "2030-01-01T00:00:00Z"),
		consistent_snapshot: true,
		keys: Object.fromEntries(roles.map((role) => [tufKeyId(roleKey(role)), tufPublicKey(roleKey(role))]).sort(([a], [b]) => ascii(String(a), String(b)))),
		roles: Object.fromEntries(roles.map((role) => [role, { keyids: [tufKeyId(roleKey(role))], threshold: 1 }])),
	};
	const rootBytes = pretty(signFixtureTuf(rootBody, roleKey("root")));
	const targetsBytes = pretty(
		signFixtureTuf(
			{ ...body("targets", "2028-01-01T00:00:00Z"), targets: Object.fromEntries(Object.entries(targets).sort(([a], [b]) => ascii(a, b))) },
			roleKey("targets"),
		),
	);
	const snapshotBytes = pretty(
		signFixtureTuf({ ...body("snapshot", "2028-01-01T00:00:00Z"), meta: { "targets.json": { version: 1, ...link(targetsBytes) } } }, roleKey("snapshot")),
	);
	const timestampBytes = pretty(
		signFixtureTuf({ ...body("timestamp", "2027-02-01T00:00:00Z"), meta: { "snapshot.json": { version: 1, ...link(snapshotBytes) } } }, roleKey("timestamp")),
	);
	for (const [role, bytes] of [
		["root", rootBytes],
		["targets", targetsBytes],
		["snapshot", snapshotBytes],
		["timestamp", timestampBytes],
	] as const) {
		const path = `metadata/1.${role}.json`;
		files.set(`registry/${path}`, bytes);
		evidence.push({ id: `finance-${role}`, registry: "finance", kind: `tuf-${role}`, path, digest: packageFileDigest(bytes) });
	}
	files.set("registry/metadata/timestamp.json", timestampBytes.slice());
	const old = parse<FixtureOldLock>("two-libraries/lock-core.json");
	const node = (id: string): FixtureOldNode => {
		const value = old.nodes[id];
		assert(value, `missing old lock node: ${id}`);
		return value;
	};
	const root = node(old.root).release;
	const nodes = [
		old.root,
		...Object.keys(old.nodes)
			.filter((id) => id !== old.root)
			.sort((a, b) => ascii(node(a).release.packagePath, node(b).release.packagePath)),
	].map((id) => ({
		...node(id),
		bindings: Object.entries(node(id).bindings)
			.sort(([a], [b]) => ascii(a, b))
			.map(([irPackageName, target]) => ({ irPackageName, target: node(target).release })),
	}));
	files.set(
		"morphir.lock",
		pretty({
			formatVersion: FIXTURE_VERSION,
			kind: "LibraryLock",
			resolution: { policy: "flat-library:0.1.0-draft.2", profile: "local-library", requiredCapabilities: ["dsse-ed25519", "local-directory", "tuf-1.0.36"] },
			graph: { root, nodes },
			registries: [{ id: "finance", snapshot: "finance-snapshot" }],
			acquisitions,
			evidence: evidence.sort((a, b) => ascii(a.id, b.id)),
		}),
	);
	const identity = packageFileDigest(Buffer.from(canonicalize(rootBody)));
	files.set(
		"trust-policy.json",
		pretty({
			formatVersion: FIXTURE_VERSION,
			kind: "LibraryTrustPolicy",
			repositories: [{ identity, bootstrapRoot: { version: 1, digest: packageFileDigest(rootBytes) }, namespaces: ["example.com/finance"] }],
			publisherRules: [{ namespace: "example.com/finance", publicKeys: publishers.map((key) => key.publicKey).sort(ascii), threshold: 1 }],
			continuedUse: "previous-authorization",
		}),
	);
	files.set(
		"configuration-one.json",
		pretty({ bindings: [{ alias: "finance", registryRoot: "finance", identity }], bootstrapRoots: [{ identity, version: "1", bytes: bytesValue(rootBytes) }] }),
	);
	const registryFiles = [...files]
		.filter(([path]) => path.startsWith("registry/"))
		.map(([path, bytes]) => ({ kind: "file", path: path.slice(9), bytes: bytesValue(bytes) }));
	const directories = new Set(
		registryFiles.flatMap(({ path }) => {
			const parts = path.split("/");
			return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join("/"));
		}),
	);
	files.set(
		"view-one.json",
		pretty({ entries: [...[...directories].map((path) => ({ kind: "directory", path })), ...registryFiles].sort((a, b) => ascii(a.path, b.path)) }),
	);
	files.set("empty-cache.json", pretty({ entries: [] }));
	files.set(
		"fixture-description.json",
		pretty({
			kind: "PublicDeterministicSignedFixture",
			fixedClock: FIXTURE_CLOCK,
			tools: { bun: "1.4.2", "tuf-js": "5.0.1", "@tufjs/canonical-json": "2.0.0", "@noble/curves": "2.4.0" },
			keyDerivation: "SHA-256 of UTF-8 morphir-mck-fixture:<label>; public test seeds only",
			publicKeys: [...roles.map(roleKey), ...publishers].map(({ label, publicKey }) => ({ label, publicKey })),
			inputDigests: Object.fromEntries(
				Object.entries(FIXTURE_INPUT_DIGESTS)
					.sort(([a], [b]) => ascii(a, b))
					.map(([path, digest]) => [path, `sha256:${digest}`]),
			),
		}),
	);
	return new Map([...files].sort(([a], [b]) => ascii(a, b)));
}
