// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { StableVersion as PublicStableVersion, parseResolutionInput as publicParseResolutionInput } from "../src/index.ts";
import { ContentDigest, IRPackageName, ManifestDigest, PackagePath, type ReleaseId, StableVersion, VersionRange } from "../src/package/resolution/model.ts";
import {
	compareCanonicalReleaseLists,
	compareReleaseIdsCanonical,
	orderBindingsForOutput,
	orderLockedNodesForOutput,
	orderReleaseIdsForOutput,
} from "../src/package/resolution/order.ts";
import { parseResolutionInput, resolutionInputToWire } from "../src/package/resolution/parse.ts";

describe("StableVersion", () => {
	test("is exported with the resolution parser from the MCK package entry point", () => {
		expect(PublicStableVersion).toBe(StableVersion);
		expect(publicParseResolutionInput).toBe(parseResolutionInput);
	});

	test("compares unbounded decimal components exactly", () => {
		const lower = StableVersion.parse("9007199254740992.0.0");
		const higher = StableVersion.parse("9007199254740993.0.0");

		expect(lower.compare(higher)).toBe(-1);
		expect(higher.compare(lower)).toBe(1);
	});

	test.each(["01.0.0", "1.0", "1.0.0-rc.1", "1.0.0+build"])("rejects non-profile version %s", (version) => {
		expect(() => StableVersion.parse(version)).toThrow();
	});
});

describe("validated scalar values", () => {
	test("keeps authority package paths distinct from canonical IR package names", () => {
		expect(PackagePath.parse("example.com/finance/eligibility").toWire()).toBe("example.com/finance/eligibility");
		expect(IRPackageName.parse("example/HTTP-client").toWire()).toBe("example/HTTP-client");
		expect(() => PackagePath.parse("example/HTTP-client")).toThrow();
		expect(() => IRPackageName.parse("example/--http-client")).toThrow();
	});

	test("keeps manifest and content digests as separately validated values", () => {
		const digest = `sha256:${"a".repeat(64)}`;
		expect(ManifestDigest.parse(digest).toWire()).toBe(digest);
		expect(ContentDigest.parse(digest).toWire()).toBe(digest);
		for (const invalid of [`sha256:${"A".repeat(64)}`, `sha256:${"a".repeat(63)}`, "md5:00"]) expect(() => ManifestDigest.parse(invalid)).toThrow();
	});

	test("does not expose an empty or reversed version interval", () => {
		expect(VersionRange.parse("1.0.0", "2.0.0").toWire()).toEqual({ minimumInclusive: "1.0.0", maximumExclusive: "2.0.0" });
		expect(() => VersionRange.parse("1.0.0", "1.0.0")).toThrow();
		expect(() => VersionRange.parse("2.0.0", "1.0.0")).toThrow();
	});
});

const release = (packagePath: string, version: string): ReleaseId => ({
	packagePath: PackagePath.parse(packagePath),
	version: StableVersion.parse(version),
});

describe("canonical release ordering", () => {
	test("orders paths ascending and versions descending without numeric loss", () => {
		const entries = [release("z.example/pkg", "1.0.0"), release("a.example/pkg", "9007199254740992.0.0"), release("a.example/pkg", "9007199254740993.0.0")];
		expect([...entries].sort(compareReleaseIdsCanonical).map((entry) => `${entry.packagePath.toWire()}@${entry.version.toWire()}`)).toEqual([
			"a.example/pkg@9007199254740993.0.0",
			"a.example/pkg@9007199254740992.0.0",
			"z.example/pkg@1.0.0",
		]);
	});

	test("compares canonical lists with prefixes first and divergent package sets at their first entry", () => {
		const a = release("a.example/pkg", "1.0.0");
		const b = release("b.example/pkg", "1.0.0");
		const c = release("c.example/pkg", "1.0.0");
		expect(compareCanonicalReleaseLists([a], [a, b])).toBe(-1);
		expect(compareCanonicalReleaseLists([a, c], [b])).toBe(-1);
	});

	test("puts the fixed root first for output without changing canonical graph ordering", () => {
		const root = release("z.example/root", "1.0.0");
		const child = release("a.example/child", "2.0.0");
		expect(orderReleaseIdsForOutput(root, [root, child])).toEqual([root, child]);
		expect([root, child].sort(compareReleaseIdsCanonical)).toEqual([child, root]);
	});

	test("is antisymmetric and transitive on a fixed domain", () => {
		const domain = [release("a.example/pkg", "1.0.0"), release("a.example/pkg", "2.0.0"), release("b.example/pkg", "1.0.0")];
		for (const left of domain) {
			for (const right of domain) expect(compareReleaseIdsCanonical(left, right)).toBe(-compareReleaseIdsCanonical(right, left) || 0);
		}
		for (const first of domain) {
			for (const second of domain) {
				for (const third of domain) {
					if (compareReleaseIdsCanonical(first, second) <= 0 && compareReleaseIdsCanonical(second, third) <= 0)
						expect(compareReleaseIdsCanonical(first, third)).toBeLessThanOrEqual(0);
				}
			}
		}
	});
});

const digest = (digit: string) => `sha256:${digit.repeat(64)}`;
const releaseRecord = (packagePath: string, version: string, irPackageName: string, dependencies: unknown[] = []) => ({
	release: { packagePath, version },
	irPackageName,
	manifestDigest: digest("0"),
	contentDigest: digest("1"),
	dependencies,
});
const requirement = (irPackageName: string, packagePath: string, minimumInclusive = "1.0.0", maximumExclusive = "2.0.0") => ({
	irPackageName,
	packagePath,
	versionRange: { minimumInclusive, maximumExclusive },
});
const lockedNode = (packagePath: string, version: string, irPackageName: string, bindings: unknown[] = []) => ({
	release: { packagePath, version },
	irPackageName,
	manifestDigest: digest("0"),
	contentDigest: digest("1"),
	bindings,
});
const initialInput = () => ({
	formatVersion: "0.1.0-draft.2",
	capability: "flat-library",
	mode: "initial",
	root: releaseRecord("example.com/app/root", "1.0.0", "example/app", [requirement("example/provider", "example.com/provider")]),
	catalogs: [{ packagePath: "example.com/provider", releases: [releaseRecord("example.com/provider", "1.2.0", "example/provider")] }],
});
const lock = () => ({
	root: { packagePath: "example.com/app/root", version: "1.0.0" },
	nodes: [
		lockedNode("example.com/app/root", "1.0.0", "example/app", [
			{ irPackageName: "example/provider", target: { packagePath: "example.com/provider", version: "1.2.0" } },
		]),
		lockedNode("example.com/provider", "1.2.0", "example/provider"),
	],
});

function parseObject(value: unknown) {
	return parseResolutionInput(JSON.stringify(value));
}

describe("parseResolutionInput", () => {
	test("returns immutable structured initial input with original pointers and an explicit wire projection", () => {
		const wire = initialInput();
		const parsed = parseObject(wire);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value.mode).toBe("initial");
		if (parsed.value.mode !== "initial") throw new Error("expected initial input");
		expect(parsed.value.root.sourcePointer).toBe("/root");
		expect(parsed.value.catalogs[0]?.releases[0]?.sourcePointer).toBe("/catalogs/0/releases/0");
		expect(resolutionInputToWire(parsed.value) as unknown).toEqual(wire);
		expect(Object.isFrozen(parsed.value.catalogs)).toBe(true);
	});

	test("parses update and replay as distinct domain modes", () => {
		const base = initialInput();
		const update = parseObject({ ...base, mode: "update", lock: lock(), targets: [{ kind: "eligible", packagePath: "example.com/provider" }] });
		const replay = parseObject({
			formatVersion: base.formatVersion,
			capability: base.capability,
			mode: "replay",
			root: base.root,
			releases: base.catalogs[0]?.releases,
			lock: lock(),
		});
		expect(update.ok && update.value.mode).toBe("update");
		expect(replay.ok && replay.value.mode).toBe("replay");
	});

	test("reports malformed JSON alone and throws for the parser resource bound", () => {
		expect(parseResolutionInput('{"mode":"initial",')).toEqual({
			ok: false,
			diagnostic: { code: "invalid-input", violations: [{ pointer: "", rule: "malformed-json" }] },
		});
		expect(() => parseResolutionInput("[".repeat(1001) + "]".repeat(1001))).toThrow("nesting");
	});

	test("rejects a leading BOM at the package raw-document boundary", () => {
		expect(parseResolutionInput(`\uFEFF${JSON.stringify(initialInput())}`)).toEqual({
			ok: false,
			diagnostic: { code: "invalid-input", violations: [{ pointer: "", rule: "malformed-json" }] },
		});
	});

	test("collects, escapes, sorts and deduplicates decoded duplicate-key violations before shape checks", () => {
		const parsed = parseResolutionInput('{"a/b~c":{"x/y~z":1,"x\\u002fy~z":2},"a":{},"a":{"b":1,"b":2},');
		expect(parsed).toEqual({
			ok: false,
			diagnostic: { code: "invalid-input", violations: [{ pointer: "", rule: "malformed-json" }] },
		});
		const duplicates = parseResolutionInput('{"a/b~c":{"x/y~z":1,"x\\u002fy~z":2},"a":{},"a":{"b":1,"b":2}}');
		expect(duplicates).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-input",
				violations: [
					{ pointer: "/a", rule: "duplicate-key" },
					{ pointer: "/a/b", rule: "duplicate-key" },
					{ pointer: "/a~1b~0c/x~1y~0z", rule: "duplicate-key" },
				],
			},
		});
	});

	test("sorts duplicate and unknown-field pointers by Unicode scalar value", () => {
		const duplicates = parseResolutionInput('{"\\ue000":0,"\\ue000":1,"\\ud800\\udc00":0,"\\ud800\\udc00":1}');
		expect(duplicates).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-input",
				violations: [
					{ pointer: "/\uE000", rule: "duplicate-key" },
					{ pointer: "/\u{10000}", rule: "duplicate-key" },
				],
			},
		});
		const unknownFields = initialInput() as ReturnType<typeof initialInput> & Record<string, unknown>;
		unknownFields["\u{10000}"] = 1;
		unknownFields["\uE000"] = 1;
		const result = parseObject(unknownFields);
		expect(result).toMatchObject({
			ok: false,
			diagnostic: {
				code: "invalid-input",
				violations: [
					{ pointer: "/\uE000", rule: "unknown-field" },
					{ pointer: "/\u{10000}", rule: "unknown-field" },
				],
			},
		});
	});

	test.each(['{"\\ud800":1}', '{"a":"\\udc00"}', '{"a":1,"a":"\\ud800"}'])("reports non-scalar decoded JSON as malformed for %s", (input) => {
		expect(parseResolutionInput(input)).toEqual({
			ok: false,
			diagnostic: { code: "invalid-input", violations: [{ pointer: "", rule: "malformed-json" }] },
		});
	});

	test("accepts valid surrogate pairs without Unicode normalization", () => {
		const result = parseResolutionInput('{"\\ud800\\udc00":"\\ud83d\\ude00"}');
		expect(result).toMatchObject({
			ok: false,
			diagnostic: {
				code: "invalid-input",
				violations: expect.arrayContaining([{ pointer: "/\u{10000}", rule: "unknown-field" }]),
			},
		});
	});

	test("enforces outer shape and defers a recognized update lock to phase 4", () => {
		const initialWithLock = { ...initialInput(), lock: {} };
		expect(parseObject(initialWithLock)).toMatchObject({
			ok: false,
			diagnostic: { code: "invalid-input", violations: [{ pointer: "/lock", rule: "unknown-field" }] },
		});
		const { catalogs: _catalogs, ...missingCatalogs } = initialInput();
		expect(parseObject(missingCatalogs)).toMatchObject({
			ok: false,
			diagnostic: { code: "invalid-input", violations: [{ pointer: "/catalogs", rule: "missing-field" }] },
		});
		const updateWithoutLock = { ...initialInput(), mode: "update", targets: [{ kind: "eligible", packagePath: "example.com/provider" }] };
		expect(parseObject(updateWithoutLock)).toMatchObject({
			ok: false,
			diagnostic: { code: "invalid-lock", violations: [{ pointer: "/lock", rule: "missing-field" }] },
		});
	});

	test("reports scalar grammar failures and all unknown fields in a phase", () => {
		const value = initialInput();
		value.root.release.version = "01.0.0";
		value.root.irPackageName = "example/--app";
		value.root.manifestDigest = digest("A");
		Object.assign(value.root, { extra: true });
		expect(parseObject(value)).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-input",
				violations: [
					{ pointer: "/root/extra", rule: "unknown-field" },
					{ pointer: "/root/irPackageName", rule: "invalid-name" },
					{ pointer: "/root/manifestDigest", rule: "invalid-digest" },
					{ pointer: "/root/release/version", rule: "invalid-version" },
				],
			},
		});
	});

	test("checks outer identities in traversal order and suppresses semantics below later duplicates", () => {
		const value = initialInput();
		value.catalogs.push({
			packagePath: "example.com/provider",
			releases: [
				releaseRecord("wrong.example/provider", "2.0.0", "example/provider", [
					requirement("example/duplicate", "example.com/one", "2.0.0", "1.0.0"),
					requirement("example/duplicate", "example.com/two"),
				]),
			],
		});
		expect(parseObject(value)).toEqual({
			ok: false,
			diagnostic: { code: "invalid-input", violations: [{ pointer: "/catalogs/1/packagePath", rule: "duplicate-identity" }] },
		});
	});

	test("reports interval, release identity, requirement and target duplicates", () => {
		const value = initialInput();
		value.root.dependencies = [requirement("example/provider", "example.com/provider", "2.0.0", "1.0.0"), requirement("example/provider", "example.com/other")];
		value.catalogs[0]?.releases.push(releaseRecord("example.com/provider", "1.2.0", "example/other"));
		const update = {
			...value,
			mode: "update",
			lock: lock(),
			targets: [
				{ kind: "eligible", packagePath: "example.com/provider" },
				{ kind: "exact", packagePath: "example.com/provider", version: "1.2.0" },
			],
		};
		expect(parseObject(update)).toMatchObject({
			ok: false,
			diagnostic: {
				code: "invalid-input",
				violations: [
					{ pointer: "/catalogs/0/releases/1/release", rule: "duplicate-identity" },
					{ pointer: "/root/dependencies/0/versionRange", rule: "invalid-interval" },
					{ pointer: "/root/dependencies/1/irPackageName", rule: "duplicate-identity" },
					{ pointer: "/targets/1/packagePath", rule: "duplicate-identity" },
				],
			},
		});
	});

	test("validates lock shape in phase 4, including initial-lock and nested unknown fields", () => {
		const value = { ...initialInput(), mode: "update", targets: [{ kind: "eligible", packagePath: "example.com/provider" }], lock: lock() };
		const first = value.lock.nodes[0];
		const second = value.lock.nodes[1];
		if (first === undefined || second === undefined) throw new Error("expected lock fixture nodes");
		first.manifestDigest = "bad";
		Object.assign(second, { surprise: true });
		expect(parseObject(value)).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-lock",
				violations: [
					{ pointer: "/lock/nodes/0/manifestDigest", rule: "invalid-digest" },
					{ pointer: "/lock/nodes/1/surprise", rule: "unknown-field" },
				],
			},
		});
	});

	test("checks lock identities and flat IR-name uniqueness in phase 5", () => {
		const value = { ...initialInput(), mode: "update", targets: [{ kind: "eligible", packagePath: "example.com/provider" }], lock: lock() };
		value.lock.nodes.push(lockedNode("example.com/provider", "1.3.0", "example/app"));
		value.lock.nodes.push(
			lockedNode("other.example/provider", "1.0.0", "example/app", [
				{ irPackageName: "example/provider", target: { packagePath: "example.com/provider", version: "1.2.0" } },
				{ irPackageName: "example/provider", target: { packagePath: "example.com/provider", version: "1.2.0" } },
			]),
		);
		value.lock.nodes[0]?.bindings.push({
			irPackageName: "example/provider",
			target: { packagePath: "example.com/provider", version: "1.3.0" },
		});
		expect(parseObject(value)).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-lock",
				violations: [
					{ pointer: "/lock/nodes/0/bindings/1/irPackageName", rule: "duplicate-identity" },
					{ pointer: "/lock/nodes/2/release/packagePath", rule: "duplicate-identity" },
					{ pointer: "/lock/nodes/3/irPackageName", rule: "unsupported-flat-binding" },
				],
			},
		});
	});

	test("does not run target membership before later old-lock validation phases", () => {
		const value = {
			...initialInput(),
			mode: "update",
			lock: lock(),
			targets: [{ kind: "eligible", packagePath: "absent.example/package" }],
		};
		expect(parseObject(value).ok).toBe(true);
	});

	test("normalizes lock output with root first and bindings by IR package name", () => {
		const value = { ...initialInput(), mode: "update", targets: [{ kind: "eligible", packagePath: "example.com/provider" }], lock: lock() };
		value.lock.nodes[0]?.bindings.unshift({
			irPackageName: "another/dependency",
			target: { packagePath: "another.example/dependency", version: "1.0.0" },
		});
		value.lock.nodes.push(lockedNode("another.example/dependency", "1.0.0", "another/dependency"));
		value.lock.nodes.reverse();
		const parsed = parseObject(value);
		if (!parsed.ok || parsed.value.mode !== "update") throw new Error("expected update input");
		const ordered = orderLockedNodesForOutput(parsed.value.lock.root, parsed.value.lock.nodes);
		const orderedRoot = ordered[0];
		if (orderedRoot === undefined) throw new Error("expected ordered root node");
		expect(ordered.map((node) => node.release.packagePath.toWire())).toEqual(["example.com/app/root", "another.example/dependency", "example.com/provider"]);
		expect(orderBindingsForOutput(orderedRoot.bindings).map((binding) => binding.irPackageName.toWire())).toEqual(["another/dependency", "example/provider"]);
	});
});
