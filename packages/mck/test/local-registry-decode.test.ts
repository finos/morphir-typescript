// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { decodeJsonDomain, decodeLibraryLock, decodeRegistryRecord, decodeReleaseStatement } from "../src/package/local-registry/decode.ts";
import { selectFailure } from "../src/package/local-registry/diagnostics.ts";
import { LocalId, RegistryPath } from "../src/package/local-registry/domain.ts";

const digest = `sha256:${"0".repeat(64)}`;
const release = { packagePath: "example.com/finance/root", version: "1.0.0" };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
function item<T>(values: readonly T[], index: number): T {
	const value = values[index];
	if (value === undefined) throw new Error("missing test fixture item");
	return value;
}
function lock() {
	return {
		formatVersion: "0.1.0-draft.3",
		kind: "LibraryLock",
		resolution: { policy: "flat-library:0.1.0-draft.2", profile: "local-library", requiredCapabilities: ["dsse-ed25519", "local-directory", "tuf-1.0.36"] },
		graph: {
			root: release,
			nodes: [
				{ release, irPackageName: "root", manifestDigest: digest, contentDigest: digest, bindings: [] as { irPackageName: string; target: typeof release }[] },
			],
		},
		registries: [{ id: "finance", snapshot: "snapshot" }],
		acquisitions: [
			{
				release,
				registry: "finance",
				record: { path: "records/root.json", digest },
				source: { kind: "registry-directory", path: "bundles/root" },
				statement: "statement",
			},
		],
		evidence: ["root", "timestamp", "snapshot", "targets"]
			.map((role) => ({ id: role, registry: "finance", kind: `tuf-${role}`, path: `metadata/1.${role}.json`, digest }))
			.concat([{ id: "statement", registry: "finance", kind: "release-statement", path: "statements/root.json", digest }]),
	};
}
const subject = { kind: "object" as const, registry: LocalId.parse("finance"), path: RegistryPath.parse("records/root.json") };
const statement = {
	formatVersion: "0.1.0-draft.3",
	kind: "LibraryReleaseStatement",
	release,
	irPackageName: "root",
	dependencies: [],
	manifestDigest: digest,
	contentDigest: digest,
};
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
			.join(",")}}`;
	return JSON.stringify(value);
}

test("valid lock decodes without claiming authentication and retains typed identifiers", () => {
	const result = decodeLibraryLock(encode(lock()));
	expect(result.ok).toBe(true);
	if (result.ok) expect(result.value.acquisitions[0]?.registry.toWire()).toBe("finance");
});

test.each(["formatVersion", "kind", "profile", "capability", "source", "evidence"])("unsupported %s precedes unrelated shape failures", (fault) => {
	const value = lock();
	if (fault === "formatVersion") value.formatVersion = "future";
	if (fault === "kind") value.kind = "future";
	if (fault === "profile") value.resolution.profile = "future";
	if (fault === "capability") value.resolution.requiredCapabilities.push("future");
	if (fault === "source") item(value.acquisitions, 0).source.kind = "future";
	if (fault === "evidence") item(value.evidence, 0).kind = "future";
	expect(decodeLibraryLock(encode({ ...value, extra: "bad" }))).toMatchObject({
		ok: false,
		diagnostic: {
			phase: "support",
			code: fault === "capability" ? "unsupported-capability" : fault === "source" ? "unsupported-source" : "unsupported-profile",
		},
	});
});

test("wrong discriminator type suppresses variant checks and remains shape failure", () => {
	expect(decodeLibraryLock(encode({ formatVersion: "0.1.0-draft.3", kind: 5 }))).toMatchObject({
		ok: false,
		diagnostic: { phase: "shape", witnesses: [{ pointer: "/kind", rule: "invalid-type" }] },
	});
});

test("wrong top discriminator suppresses recognized variant fields without calling them unknown", () => {
	expect(decodeLibraryLock(encode({ formatVersion: "0.1.0-draft.3", kind: [], graph: "not-checked" }))).toEqual({
		ok: false,
		diagnostic: {
			category: "invalid-input",
			code: "invalid-input",
			phase: "shape",
			witnesses: [{ kind: "violation", subject: { kind: "lock" }, pointer: "/kind", rule: "invalid-type" }],
		},
	});
});

test("domain checks do not invent violations beneath unknown or suppressed fields", () => {
	expect(decodeLibraryLock(encode({ formatVersion: "0.1.0-draft.3", kind: [], graph: 5 }))).toMatchObject({
		diagnostic: { witnesses: [{ pointer: "/kind", rule: "invalid-type" }] },
	});
	expect(decodeLibraryLock(encode({ ...lock(), unknown: { n: true } }))).toMatchObject({
		diagnostic: { witnesses: [{ pointer: "/unknown", rule: "unknown-field" }] },
	});
});

test("duplicate acquisitions do not suppress independent missing snapshot references", () => {
	const value = lock();
	value.acquisitions.push(item(value.acquisitions, 0));
	item(value.registries, 0).snapshot = "absent";
	const decoded = decodeLibraryLock(encode(value));
	expect(decoded.ok).toBe(false);
	if (!decoded.ok)
		expect(decoded.diagnostic.witnesses).toContainEqual({
			kind: "violation",
			subject: { kind: "lock" },
			pointer: "/registries/0/snapshot",
			rule: "missing-reference",
		});
});

test("duplicate release suppresses derived record-path duplicate", () => {
	const value = lock();
	value.acquisitions.push(item(value.acquisitions, 0));
	expect(decodeLibraryLock(encode(value))).toMatchObject({ diagnostic: { witnesses: [{ pointer: "/acquisitions/1/release", rule: "duplicate-identity" }] } });
});

test("duplicate release suppresses dependent statement reference checks", () => {
	const value = lock();
	value.acquisitions.push({ ...item(value.acquisitions, 0), statement: "absent" });
	expect(decodeLibraryLock(encode(value))).toMatchObject({ diagnostic: { witnesses: [{ pointer: "/acquisitions/1/release", rule: "duplicate-identity" }] } });
});

test("missing statement reference suppresses a derived orphan statement", () => {
	const value = lock();
	item(value.acquisitions, 0).statement = "absent";
	expect(decodeLibraryLock(encode(value))).toMatchObject({ diagnostic: { witnesses: [{ pointer: "/acquisitions/0/statement", rule: "missing-reference" }] } });
});

test("graph cardinality is bounded before topology work", () => {
	const value = lock();
	value.graph.nodes = Array.from({ length: 513 }, () => item(value.graph.nodes, 0));
	expect(decodeLibraryLock(encode(value))).toMatchObject({
		ok: false,
		diagnostic: { code: "resource-limit", witnesses: [{ resource: "graph-nodes", maximum: "512", observed: "513" }] },
	});
});

test.each(["evidence-entries", "node-bindings", "graph-bindings"])("lock enforces %s before topology", (resource) => {
	const value = lock();
	if (resource === "evidence-entries") value.evidence = Array.from({ length: 2049 }, () => item(value.evidence, 0));
	if (resource === "node-bindings") item(value.graph.nodes, 0).bindings = Array.from({ length: 513 }, () => ({ irPackageName: "root", target: release }));
	if (resource === "graph-bindings")
		value.graph.nodes = Array.from({ length: 65 }, () => ({
			...item(value.graph.nodes, 0),
			bindings: Array.from({ length: 512 }, () => ({ irPackageName: "root", target: release })),
		}));
	const result = decodeLibraryLock(encode(value));
	expect(result.ok).toBe(false);
	if (!result.ok)
		expect({
			code: result.diagnostic.code,
			resource: "resource" in item(result.diagnostic.witnesses, 0) ? (item(result.diagnostic.witnesses, 0) as { resource: string }).resource : undefined,
		}).toEqual({ code: "resource-limit", resource });
});

test("statement requirement count is bounded", () => {
	const dependency = { irPackageName: "root", packagePath: release.packagePath, versionRange: { minimumInclusive: "1.0.0", maximumExclusive: "2.0.0" } };
	const result = decodeReleaseStatement(encode({ ...statement, dependencies: Array.from({ length: 513 }, () => dependency) }), subject);
	expect(result).toMatchObject({
		ok: false,
		diagnostic: { code: "resource-limit", witnesses: [{ resource: "node-bindings", maximum: "512", observed: "513" }] },
	});
});

test("fatal path selection follows graph root despite acquisition permutation", () => {
	const value = lock();
	const root = item(value.acquisitions, 0);
	root.source.path = "bundles/z/con";
	const child = { ...root, release: { packagePath: "example.com/finance/child", version: "1.0.0" }, source: { ...root.source, path: "bundles/a/con" } };
	value.acquisitions = [child, root];
	expect(decodeLibraryLock(encode(value))).toMatchObject({
		diagnostic: { witnesses: [{ subject: { kind: "object", registry: "finance", path: "bundles/z/con" }, rule: "reserved-name" }] },
	});
});

test("shared unsafe source paths retain their first graph rank", () => {
	const value = lock();
	const root = item(value.acquisitions, 0);
	root.source.path = "bundles/z/con";
	const child = { ...root, release: { packagePath: "example.com/finance/child", version: "1.0.0" }, source: { ...root.source, path: "bundles/a/con" } };
	const sibling = { ...root, release: { packagePath: "example.com/finance/sibling", version: "1.0.0" } };
	value.acquisitions = [child, sibling, root];
	expect(decodeLibraryLock(encode(value))).toMatchObject({
		diagnostic: { witnesses: [{ subject: { kind: "object", registry: "finance", path: "bundles/z/con" }, rule: "reserved-name" }] },
	});
});

test("unsafe evidence sorts by logical path ahead of acquisition paths", () => {
	const value = lock();
	item(value.acquisitions, 0).source.path = "bundles/con";
	item(value.evidence, 0).path = "metadata/con";
	item(value.evidence, 1).path = "metadata/aux";
	expect(decodeLibraryLock(encode(value))).toMatchObject({
		diagnostic: { witnesses: [{ subject: { kind: "object", registry: "finance", path: "metadata/aux" }, rule: "reserved-name" }] },
	});
});

test("missing evidence paths do not give empty acquisition paths evidence priority", () => {
	const value = lock();
	item(value.acquisitions, 0).source.path = "";
	const { path: _path, ...evidenceWithoutPath } = item(value.evidence, 0);
	item(value.evidence, 1).path = "metadata/con";
	const malformed = { ...value, evidence: [evidenceWithoutPath, ...value.evidence.slice(1)] };
	expect(decodeLibraryLock(encode(malformed))).toMatchObject({
		diagnostic: { witnesses: [{ subject: { kind: "object", registry: "finance", path: "metadata/con" }, rule: "reserved-name" }] },
	});
});

test.each([
	["/tmp/unsafe", "unsafe-path", "grammar"],
	["bundles/con", "unsafe-path", "reserved-name"],
	["bundles/lpt0.json", "unsafe-path", "reserved-name"],
	[`bundles/${"a".repeat(129)}`, "resource-limit", "component-bytes"],
	[`bundles/${"a/".repeat(32)}leaf`, "resource-limit", "path-components"],
	[`bundles/${"a".repeat(120)}/${"b".repeat(120)}`, "resource-limit", "path-bytes"],
])("portable acquisition path rejects %s", (path, code, rule) => {
	const value = lock();
	item(value.acquisitions, 0).source.path = path;
	expect(decodeLibraryLock(encode(value))).toMatchObject({
		ok: false,
		diagnostic: { code, witnesses: [code === "unsafe-path" ? { rule } : { resource: rule }] },
	});
});

test.each([
	"duplicate-acquisition",
	"missing-acquisition",
	"orphan-acquisition",
	"record-path",
	"missing-evidence",
	"orphan-statement",
	"duplicate-evidence",
	"wrong-evidence-kind",
	"extra-snapshot",
	"orphan-registry",
	"cycle",
])("lock structure rejects %s", (fault) => {
	const value = lock();
	if (fault === "duplicate-acquisition") value.acquisitions.push(item(value.acquisitions, 0));
	if (fault === "missing-acquisition" || fault === "record-path") {
		const child = { packagePath: "example.com/finance/child", version: "1.0.0" };
		item(value.graph.nodes, 0).bindings.push({ irPackageName: "child", target: child });
		value.graph.nodes.push({ ...item(value.graph.nodes, 0), release: child, irPackageName: "child", bindings: [] });
		if (fault === "record-path") value.acquisitions.push({ ...item(value.acquisitions, 0), release: child });
	}
	if (fault === "orphan-acquisition") value.acquisitions.push({ ...item(value.acquisitions, 0), release: { ...release, version: "2.0.0" } });
	if (fault === "missing-evidence") item(value.acquisitions, 0).statement = "absent";
	if (fault === "orphan-statement") value.evidence.push({ ...item(value.evidence, 4), id: "extra", path: "statements/extra.json" });
	if (fault === "duplicate-evidence") value.evidence.push(item(value.evidence, 0));
	if (fault === "wrong-evidence-kind") item(value.acquisitions, 0).statement = "snapshot";
	if (fault === "extra-snapshot") value.evidence.push({ ...item(value.evidence, 2), id: "extra", path: "metadata/2.snapshot.json" });
	if (fault === "orphan-registry") value.registries.push({ id: "unused", snapshot: "snapshot" });
	if (fault === "cycle") item(value.graph.nodes, 0).bindings.push({ irPackageName: "root", target: release });
	expect(decodeLibraryLock(encode(value))).toMatchObject({ ok: false, diagnostic: { phase: "structure", code: "invalid-input" } });
});

test("closed shape validates unknown fields at nested levels", () => {
	const value = lock();
	expect(decodeLibraryLock(encode({ ...value, graph: { ...value.graph, root: { ...release, unexpected: "bad" } } }))).toMatchObject({
		ok: false,
		diagnostic: { phase: "shape", witnesses: [{ pointer: "/graph/root/unexpected", rule: "unknown-field" }] },
	});
});

test("topology reports exactly edges within separate cycles, self loops, and disconnected dangling nodes", () => {
	const value = lock();
	const releases = Array.from({ length: 8 }, (_, index) => ({ packagePath: `example.com/node-${index}`, version: "1.0.0" }));
	const adjacency = [[1], [2], [1, 3], [3, 4], [5], [4], [7]];
	value.graph.root = item(releases, 0);
	value.graph.nodes = adjacency.map((targets, index) => ({
		...item(value.graph.nodes, 0),
		release: item(releases, index),
		irPackageName: `node-${index}`,
		bindings: targets.map((target) => ({ irPackageName: `node-${target}`, target: item(releases, target) })),
	}));
	value.acquisitions = value.graph.nodes.map((node, index) => ({
		...item(value.acquisitions, 0),
		release: node.release,
		record: { path: `records/node-${index}.json`, digest },
		statement: `statement-${index}`,
	}));
	value.evidence = value.evidence
		.filter((entry) => entry.kind !== "release-statement")
		.concat(
			value.graph.nodes.map((_, index) => ({
				id: `statement-${index}`,
				registry: "finance",
				kind: "release-statement",
				path: `statements/node-${index}.json`,
				digest,
			})),
		);
	const result = decodeLibraryLock(encode(value));
	expect(result.ok).toBe(false);
	if (!result.ok)
		expect(result.diagnostic.witnesses).toEqual([
			...(
				[
					["/graph/nodes/1/bindings/0/target", "cycle"],
					["/graph/nodes/2/bindings/0/target", "cycle"],
					["/graph/nodes/3/bindings/0/target", "cycle"],
					["/graph/nodes/4/bindings/0/target", "cycle"],
					["/graph/nodes/5/bindings/0/target", "cycle"],
					["/graph/nodes/6/bindings/0/target", "dangling-binding"],
					["/graph/nodes/6/release", "unreachable-node"],
				] as const
			).map(([pointer, rule]) => ({ kind: "violation" as const, subject: { kind: "lock" as const }, pointer, rule })),
		]);
});

test("nonadjacent duplicate acquisitions retain original first-occurrence pointers", () => {
	const value = lock();
	const extra = { ...item(value.acquisitions, 0), release: { ...release, version: "2.0.0" }, record: { path: "records/extra.json", digest } };
	value.acquisitions.push(extra, { ...item(value.acquisitions, 0), statement: "absent" }, { ...extra, statement: "absent" });
	const result = decodeLibraryLock(encode(value));
	expect(result.ok).toBe(false);
	if (!result.ok)
		expect(result.diagnostic.witnesses).toEqual([
			{ kind: "violation", subject: { kind: "lock" }, pointer: "/acquisitions/1/release", rule: "orphan-reference" },
			{ kind: "violation", subject: { kind: "lock" }, pointer: "/acquisitions/2/release", rule: "duplicate-identity" },
			{ kind: "violation", subject: { kind: "lock" }, pointer: "/acquisitions/3/release", rule: "duplicate-identity" },
		]);
});

test("repeated capabilities retain each original duplicate pointer", () => {
	const value = lock();
	value.resolution.requiredCapabilities.push("dsse-ed25519", "tuf-1.0.36", "dsse-ed25519");
	expect(decodeLibraryLock(encode(value))).toMatchObject({
		diagnostic: {
			witnesses: [
				{ pointer: "/resolution/requiredCapabilities/3", rule: "duplicate-identity" },
				{ pointer: "/resolution/requiredCapabilities/4", rule: "duplicate-identity" },
				{ pointer: "/resolution/requiredCapabilities/5", rule: "duplicate-identity" },
			],
		},
	});
});

test("records require exactly one LF and statement payloads require none", () => {
	const record = {
		...statement,
		kind: "LibraryRegistryRecord",
		source: { kind: "registry-directory", path: "bundles/root" },
		statement: { path: "statements/root.json", digest },
	};
	expect(decodeRegistryRecord(Buffer.from(`${canonical(record)}\n`), subject).ok).toBe(true);
	expect(decodeReleaseStatement(Buffer.from(canonical(statement)), subject).ok).toBe(true);
	for (const suffix of ["", "\n\n", "\r\n"])
		expect(decodeRegistryRecord(Buffer.from(canonical(record) + suffix), subject)).toMatchObject({
			ok: false,
			diagnostic: { phase: "repository", witnesses: [{ rule: "noncanonical" }] },
		});
	expect(decodeReleaseStatement(Buffer.from(`${canonical(statement)}\n`), subject)).toMatchObject({
		ok: false,
		diagnostic: { phase: "repository", witnesses: [{ rule: "noncanonical" }] },
	});
});

test("canonical shape rejection precedes statement dependency structure checks", () => {
	const payload = {
		...statement,
		dependencies: [{ irPackageName: "root", packagePath: release.packagePath, versionRange: { minimumInclusive: "2.0.0", maximumExclusive: "1.0.0" } }],
	};
	expect(decodeReleaseStatement(Buffer.from(`${canonical(payload)}\n`), subject)).toMatchObject({
		diagnostic: { witnesses: [{ pointer: "", rule: "noncanonical" }] },
	});
});

test("JSON domains preserve exact TUF integer lexemes and DSSE extensions", () => {
	const tuf = decodeJsonDomain(Buffer.from('{"signed":{"version":9007199254740993,"extra":"é"}}'), { kind: "tuf", role: "root" }, subject);
	expect(tuf.ok).toBe(true);
	if (tuf.ok) expect(tuf.value.text).toContain("9007199254740993");
	expect(decodeJsonDomain(Buffer.from('{"extra":1.5,"hint":"é"}'), { kind: "dsse" }, subject).ok).toBe(true);
	expect(decodeJsonDomain(Buffer.from('{"signed":{"version":1e3}}'), { kind: "tuf", role: "root" }, subject)).toMatchObject({
		ok: false,
		diagnostic: { phase: "repository" },
	});
	expect(decodeReleaseStatement(encode({ ...statement, irPackageName: "é" }), subject).ok).toBe(false);
});

test("bounded JSON rejects bytes and depth before unsafe parsing", () => {
	expect(decodeLibraryLock(new Uint8Array(16 * 1024 * 1024 + 20))).toMatchObject({
		ok: false,
		diagnostic: { code: "resource-limit", phase: "decode", witnesses: [{ maximum: "16777216", observed: "16777217" }] },
	});
	expect(decodeJsonDomain(Buffer.from(`${"[".repeat(10000)}0${"]".repeat(10000)}`), { kind: "dsse" }, subject)).toMatchObject({
		ok: false,
		diagnostic: { code: "resource-limit", witnesses: [{ resource: "json-depth", maximum: "64", observed: "65" }] },
	});
	expect(decodeLibraryLock(Buffer.from('{"a":"\\ud800","kind":"future"}'))).toMatchObject({ ok: false, diagnostic: { phase: "decode" } });
});

test("diagnostics select first phase then code and canonical unique witnesses", () => {
	const witness = { kind: "violation" as const, subject: { kind: "lock" as const }, pointer: "/z", rule: "unknown-field" as const };
	expect(
		selectFailure([
			{ code: "invalid-input", phase: "shape", witnesses: [witness] },
			{ code: "unsupported-source", phase: "support", witnesses: [{ kind: "unsupported", subject: { kind: "lock" }, pointer: "/source", value: "future" }] },
			{ code: "unsupported-profile", phase: "support", witnesses: [{ kind: "unsupported", subject: { kind: "lock" }, pointer: "/kind", value: "future" }] },
		]),
	).toMatchObject({ diagnostic: { code: "unsupported-profile", phase: "support" } });
	expect(selectFailure([{ code: "invalid-input", phase: "shape", witnesses: [witness, { ...witness, pointer: "/a" }, witness] }])).toMatchObject({
		diagnostic: { witnesses: [{ pointer: "/a" }, { pointer: "/z" }] },
	});
});

// Exact independently fixed wire probes from the parent contract; never round-trip their bytes.
test.each([
	["bom", "efbbbf7b7d", "", "malformed-json"],
	["duplicate-key", "7b226b696e64223a224c6962726172794c6f636b222c225c7530303662696e64223a224c6962726172794c6f636b227d", "/kind", "duplicate-key"],
	["malformed-json", "7b", "", "malformed-json"],
	["invalid-utf8", "7b22ff223a22227d", "", "malformed-json"],
] as const)("raw fixed %s lock rejection", (_name, hex, pointer, rule) => {
	expect(decodeLibraryLock(Buffer.from(hex, "hex"))).toEqual({
		ok: false,
		diagnostic: {
			category: "invalid-input",
			code: "invalid-input",
			phase: "decode",
			witnesses: [{ kind: "violation", subject: { kind: "lock" }, pointer, rule }],
		},
	});
});
