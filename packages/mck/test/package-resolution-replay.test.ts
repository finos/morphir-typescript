// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { resolveLibrary } from "../src/index.ts";
import { parseResolutionInput } from "../src/package/resolution/parse.ts";
import { validateOldLock } from "../src/package/resolution/replay.ts";

const digest = (digit: string) => `sha256:${digit.repeat(64)}`;

type ReleaseIdLiteral = { packagePath: string; version: string };
type RequirementLiteral = {
	irPackageName: string;
	packagePath: string;
	versionRange: { minimumInclusive: string; maximumExclusive: string };
};
type ReleaseRecordLiteral = {
	release: ReleaseIdLiteral;
	irPackageName: string;
	manifestDigest: string;
	contentDigest: string;
	dependencies: RequirementLiteral[];
};
type BindingLiteral = { irPackageName: string; target: ReleaseIdLiteral };
type LockedNodeLiteral = Omit<ReleaseRecordLiteral, "dependencies"> & { bindings: BindingLiteral[] };
type ReplayLiteral = {
	formatVersion: "0.1.0-draft.2";
	capability: "flat-library";
	root: ReleaseRecordLiteral;
	mode: "replay";
	releases: ReleaseRecordLiteral[];
	lock: { root: ReleaseIdLiteral; nodes: LockedNodeLiteral[] };
};

const id = (packagePath: string, version = "1.0.0"): ReleaseIdLiteral => ({ packagePath, version });

const requirement = (irPackageName: string, packagePath: string, minimumInclusive = "1.0.0", maximumExclusive = "2.0.0"): RequirementLiteral => ({
	irPackageName,
	packagePath,
	versionRange: { minimumInclusive, maximumExclusive },
});

const record = (packagePath: string, version: string, irPackageName: string, dependencies: RequirementLiteral[] = []): ReleaseRecordLiteral => ({
	release: id(packagePath, version),
	irPackageName,
	manifestDigest: digest("0"),
	contentDigest: digest("1"),
	dependencies,
});

const node = (metadata: ReleaseRecordLiteral, bindings: BindingLiteral[] = []): LockedNodeLiteral => ({
	release: { ...metadata.release },
	irPackageName: metadata.irPackageName,
	manifestDigest: metadata.manifestDigest,
	contentDigest: metadata.contentDigest,
	bindings,
});

const binding = (irPackageName: string, packagePath: string, version = "1.0.0"): BindingLiteral => ({
	irPackageName,
	target: id(packagePath, version),
});

function replayInput(): ReplayLiteral {
	const helper = record("example.com/lib/helper", "1.5.0", "example/helper");
	const provider = record("example.com/lib/provider", "1.2.0", "example/provider", [requirement("example/helper", "example.com/lib/helper", "1.0.0", "2.0.0")]);
	const root = record("example.com/app/root", "1.0.0", "example/app", [requirement("example/provider", "example.com/lib/provider", "1.0.0", "2.0.0")]);
	return {
		formatVersion: "0.1.0-draft.2",
		capability: "flat-library",
		root,
		mode: "replay",
		// Replay deliberately contains exact selected metadata only.
		releases: [provider, helper],
		lock: {
			root: { ...root.release },
			nodes: [
				node(helper),
				node(root, [binding("example/provider", "example.com/lib/provider", "1.2.0")]),
				node(provider, [binding("example/helper", "example.com/lib/helper", "1.5.0")]),
			],
		},
	};
}

function chainReplayInput(nodeCount: number): ReplayLiteral {
	if (nodeCount < 1) throw new Error("a replay chain needs at least one node");
	const records = Array.from({ length: nodeCount }, (_, index) => {
		const nextIndex = index + 1;
		const dependencies = nextIndex < nodeCount ? [requirement(`example/chain-node-${nextIndex}`, `example.com/chain/node-${nextIndex}`)] : [];
		return record(`example.com/chain/node-${index}`, "1.0.0", `example/chain-node-${index}`, dependencies);
	});
	const root = records[0];
	if (root === undefined) throw new Error("fixture root is absent");
	return {
		formatVersion: "0.1.0-draft.2",
		capability: "flat-library",
		root,
		mode: "replay",
		releases: records.slice(1),
		lock: {
			root: { ...root.release },
			nodes: records.map((metadata, index) => {
				const next = records[index + 1];
				return node(metadata, next === undefined ? [] : [binding(next.irPackageName, next.release.packagePath)]);
			}),
		},
	};
}

describe("resolveLibrary replay", () => {
	test("replays exact selected releases without requiring newer candidates", () => {
		const input = replayInput();
		const helperNode = input.lock.nodes[0];
		const rootNode = input.lock.nodes[1];
		const providerNode = input.lock.nodes[2];
		if (helperNode === undefined || rootNode === undefined || providerNode === undefined) throw new Error("fixture nodes are absent");
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: true,
			graph: {
				root: input.lock.root,
				nodes: [rootNode, helperNode, providerNode],
			},
		});
	});

	test("ignores supplied newer metadata and preserves the exact older lock", () => {
		const input = replayInput();
		input.releases.push(record("example.com/lib/provider", "1.9.0", "example/provider"));
		const result = resolveLibrary(JSON.stringify(input));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.graph.nodes.map((selected) => selected.release)).toEqual([
			id("example.com/app/root"),
			id("example.com/lib/helper", "1.5.0"),
			id("example.com/lib/provider", "1.2.0"),
		]);
	});

	test("returns raw-input diagnostics through the public entry point", () => {
		expect(resolveLibrary("{")).toEqual({
			ok: false,
			diagnostic: { code: "invalid-input", violations: [{ pointer: "", rule: "malformed-json" }] },
		});
	});

	test("rejects a lock whose root node is absent", () => {
		const input = replayInput();
		input.lock.nodes.splice(1, 1);
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: { code: "invalid-lock", violations: [{ pointer: "/lock/root", rule: "missing-root" }] },
		});
	});

	test("suppresses root presence and reachability after lock root disagreement", () => {
		const input = replayInput();
		input.lock.root = id("example.com/app/other");
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: { code: "invalid-lock", violations: [{ pointer: "/lock/root", rule: "identity-mismatch" }] },
		});
	});

	test("reports dangling targets before dereferencing them and excludes their edges from reachability", () => {
		const input = replayInput();
		const rootBinding = input.lock.nodes[1]?.bindings[0];
		if (rootBinding === undefined) throw new Error("fixture root binding is absent");
		rootBinding.target.version = "1.9.0";
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-lock",
				violations: [
					{ pointer: "/lock/nodes/0/release", rule: "unreachable-node" },
					{ pointer: "/lock/nodes/1/bindings/0/target", rule: "dangling-binding" },
					{ pointer: "/lock/nodes/2/release", rule: "unreachable-node" },
				],
			},
		});
	});

	test("rejects duplicate binding identities during lock identity validation", () => {
		const input = replayInput();
		input.lock.nodes[1]?.bindings.push(binding("example/provider", "example.com/lib/provider", "1.2.0"));
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-lock",
				violations: [{ pointer: "/lock/nodes/1/bindings/1/irPackageName", rule: "duplicate-identity" }],
			},
		});
	});

	test("reports every binding target on a directed cycle", () => {
		const input = replayInput();
		input.releases[1]?.dependencies.push(requirement("example/provider", "example.com/lib/provider", "1.0.0", "2.0.0"));
		input.lock.nodes[0]?.bindings.push(binding("example/provider", "example.com/lib/provider", "1.2.0"));
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-lock",
				violations: [
					{ pointer: "/lock/nodes/0/bindings/0/target", rule: "cycle" },
					{ pointer: "/lock/nodes/2/bindings/0/target", rule: "cycle" },
				],
			},
		});
	});

	test("validates a long acyclic chain", () => {
		expect(resolveLibrary(JSON.stringify(chainReplayInput(600))).ok).toBe(true);
	});

	test("reports self-loops and every edge in a disconnected cycle", () => {
		const input = replayInput();
		const first = record("example.com/disconnected/first", "1.0.0", "example/disconnected-first");
		const second = record("example.com/disconnected/second", "1.0.0", "example/disconnected-second");
		input.lock.nodes[1]?.bindings.push(binding("example/app", "example.com/app/root"));
		input.lock.nodes.push(node(first, [binding(second.irPackageName, second.release.packagePath)]));
		input.lock.nodes.push(node(second, [binding(first.irPackageName, first.release.packagePath)]));

		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-lock",
				violations: [
					{ pointer: "/lock/nodes/1/bindings/1/target", rule: "cycle" },
					{ pointer: "/lock/nodes/3/bindings/0/target", rule: "cycle" },
					{ pointer: "/lock/nodes/3/release", rule: "unreachable-node" },
					{ pointer: "/lock/nodes/4/bindings/0/target", rule: "cycle" },
					{ pointer: "/lock/nodes/4/release", rule: "unreachable-node" },
				],
			},
		});
	});

	test("reports every node unreachable from the lock root", () => {
		const input = replayInput();
		input.root.dependencies.length = 0;
		input.lock.nodes[1]?.bindings.splice(0);
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-lock",
				violations: [
					{ pointer: "/lock/nodes/0/release", rule: "unreachable-node" },
					{ pointer: "/lock/nodes/2/release", rule: "unreachable-node" },
				],
			},
		});
	});

	test("reports every missing selected metadata record in canonical release order", () => {
		const input = replayInput();
		input.releases.length = 0;
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "incomplete-input",
				missing: [
					{ kind: "release", release: id("example.com/lib/helper", "1.5.0") },
					{ kind: "release", release: id("example.com/lib/provider", "1.2.0") },
				],
			},
		});
	});

	test("stops at missing selected metadata before checking lock digests", () => {
		const input = replayInput();
		input.releases.splice(1, 1);
		const rootNode = input.lock.nodes[1];
		if (rootNode === undefined) throw new Error("fixture root node is absent");
		rootNode.manifestDigest = digest("2");
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "incomplete-input",
				missing: [{ kind: "release", release: id("example.com/lib/helper", "1.5.0") }],
			},
		});
	});

	test("accumulates independent manifest and content digest changes", () => {
		const input = replayInput();
		const providerNode = input.lock.nodes[2];
		if (providerNode === undefined) throw new Error("fixture provider node is absent");
		providerNode.manifestDigest = digest("2");
		providerNode.contentDigest = digest("3");
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-lock",
				violations: [
					{ pointer: "/lock/nodes/2/contentDigest", rule: "digest-mismatch" },
					{ pointer: "/lock/nodes/2/manifestDigest", rule: "digest-mismatch" },
				],
			},
		});
	});

	test("requires exact binding coverage of original requirements", () => {
		const input = replayInput();
		const helperTwo = record("example.com/lib/helper-two", "1.0.0", "example/helper-two");
		input.releases.push(helperTwo);
		input.lock.nodes.push(node(helperTwo));
		input.root.dependencies.push(requirement("example/helper", "example.com/lib/helper"));
		input.root.dependencies.push(requirement("example/helper-two", "example.com/lib/helper-two"));
		input.lock.nodes[1]?.bindings.push(binding("example/helper", "example.com/lib/helper", "1.5.0"));
		input.lock.nodes[1]?.bindings.push(binding("example/helper-two", "example.com/lib/helper-two"));
		input.releases[0]?.dependencies.push(requirement("example/helper-two", "example.com/lib/helper-two"));
		input.lock.nodes[2]?.bindings.splice(0);
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-lock",
				violations: [{ pointer: "/lock/nodes/2/bindings", rule: "binding-mismatch" }],
			},
		});
	});

	test("rejects bindings not declared by immutable metadata", () => {
		const input = replayInput();
		input.lock.nodes[1]?.bindings.push(binding("example/alias", "example.com/lib/provider", "1.2.0"));
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-lock",
				violations: [{ pointer: "/lock/nodes/1/bindings/1/irPackageName", rule: "binding-mismatch" }],
			},
		});
	});

	test("rejects a binding target whose PackagePath disagrees with its requirement", () => {
		const input = replayInput();
		const rootRequirement = input.root.dependencies[0];
		if (rootRequirement === undefined) throw new Error("fixture root requirement is absent");
		rootRequirement.packagePath = "example.com/lib/wrong";
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-lock",
				violations: [{ pointer: "/lock/nodes/1/bindings/0/target", rule: "binding-mismatch" }],
			},
		});
	});

	test("rejects a target node whose IR name disagrees with its requirement", () => {
		const input = replayInput();
		const providerRecord = input.releases[0];
		const providerNode = input.lock.nodes[2];
		if (providerRecord === undefined || providerNode === undefined) throw new Error("fixture provider is absent");
		providerRecord.irPackageName = "example/wrong";
		providerNode.irPackageName = "example/wrong";
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-lock",
				violations: [{ pointer: "/lock/nodes/1/bindings/0/target", rule: "binding-mismatch" }],
			},
		});
	});

	test("rejects a locked node IR name that differs from immutable metadata", () => {
		const input = replayInput();
		const providerNode = input.lock.nodes[2];
		if (providerNode === undefined) throw new Error("fixture provider node is absent");
		providerNode.irPackageName = "example/wrong";
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-lock",
				violations: [
					{ pointer: "/lock/nodes/1/bindings/0/target", rule: "binding-mismatch" },
					{ pointer: "/lock/nodes/2/irPackageName", rule: "identity-mismatch" },
				],
			},
		});
	});

	test("rejects an exact selected version outside its original interval", () => {
		const input = replayInput();
		const providerRecord = input.releases[0];
		const providerNode = input.lock.nodes[2];
		const rootBinding = input.lock.nodes[1]?.bindings[0];
		if (providerRecord === undefined || providerNode === undefined || rootBinding === undefined) throw new Error("fixture provider is absent");
		providerRecord.release.version = "2.0.0";
		providerNode.release.version = "2.0.0";
		rootBinding.target.version = "2.0.0";
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-lock",
				violations: [{ pointer: "/lock/nodes/1/bindings/0/target", rule: "requirement-mismatch" }],
			},
		});
	});

	test("validates an update old lock without applying its new exact target", () => {
		const replay = replayInput();
		const update = {
			...replay,
			mode: "update",
			catalogs: replay.releases.map((release) => ({ packagePath: release.release.packagePath, releases: [release] })),
			targets: [{ kind: "exact", packagePath: "example.com/lib/provider", version: "9.0.0" }],
			releases: undefined,
		};
		const parsed = parseResolutionInput(JSON.stringify(update));
		if (!parsed.ok || parsed.value.mode !== "update") throw new Error("fixture update did not parse");
		expect(validateOldLock(parsed.value).ok).toBe(true);
	});
});
