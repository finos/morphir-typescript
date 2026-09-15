// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the run loop (spec S5.2) against a scripted Testee and in-memory
// kits, one scenario per test as the brief lays them out.
import { describe, expect, test } from "bun:test";
import type { Kit } from "../kit/load.ts";
import { loadKitFromFiles } from "../kit/load.ts";
import { KIT_PATH, kitFilesFromMap } from "../kit/source.ts";
import { ProtocolError } from "../testee/protocol.ts";
import type { Capabilities, DecodeRequest, DecodeResponse, ReadTreeRequest, Testee, WriteTreeRequest, WriteTreeResponse } from "../testee/testee.ts";
import { checkCanonical } from "./compare.ts";
import { exitCodeFor, runKit } from "./run.ts";

const FULL_CAPS: Capabilities = {
	contractVersion: 1,
	binding: "scripted",
	language: "scripted",
	versions: [4],
	profiles: ["json"],
	layouts: ["single"],
	paths: ["current"],
	nodes: ["Type", "Value", "Pattern", "IRFile"],
};

function kitFrom(files: ReadonlyMap<string, string>): Promise<Kit> {
	return loadKitFromFiles(kitFilesFromMap("scripted", files));
}

interface Scripted {
	readonly testee: Testee;
	readonly decodeCalls: DecodeRequest[];
	readonly capabilitiesCalls: number;
}

function scriptedTestee(capabilities: unknown, decode: (req: DecodeRequest) => DecodeResponse): Scripted {
	const decodeCalls: DecodeRequest[] = [];
	let capabilitiesCalls = 0;
	const testee: Testee = {
		capabilities: async () => {
			capabilitiesCalls += 1;
			return capabilities as Capabilities;
		},
		decode: async (req) => {
			decodeCalls.push(req);
			return decode(req);
		},
		readTree: async (_req: ReadTreeRequest) => {
			throw new Error("readTree not scripted for this test");
		},
		writeTree: async (_req: WriteTreeRequest): Promise<WriteTreeResponse> => {
			throw new Error("writeTree not scripted for this test");
		},
		close: async () => {},
	};
	return {
		testee,
		decodeCalls,
		get capabilitiesCalls() {
			return capabilitiesCalls;
		},
	} as Scripted;
}

const opts = { strict: false, driverVersion: "0.0.0-test", kitVersion: "test" };

describe("runKit", () => {
	test("1. canonical + accepted fences, matching testee: pass on every fence and path", async () => {
		const kit = await kitFrom(
			new Map([
				[`${KIT_PATH}/types.md`, ["## types-0001: t {node=Type}", "```json canonical", '{"a":1}', "```", "```json accepted", '{"a":1}', "```", ""].join("\n")],
			]),
		);
		const caps: Capabilities = { ...FULL_CAPS, paths: ["current", "pinned"] };
		const { testee } = scriptedTestee(caps, () => ({ ok: true, kind: "Type", canonical: { json: '{"a":1}' }, warnings: [] }));
		const report = await runKit(kit, testee, opts);
		expect(report.records).toHaveLength(4);
		for (const r of report.records) {
			expect(r.result).toBe("pass");
			expect(r.caseId).toBe("types-0001");
			expect(r.profile).toBe("json");
			expect(r.irVersion).toBe(4);
			expect(r.path).toBeDefined();
		}
		const roles = report.records.map((r) => r.role).sort();
		expect(roles).toEqual(["accepted", "accepted", "canonical", "canonical"]);
		const fenceIndexes = new Set(report.records.map((r) => r.fenceIndex));
		expect(fenceIndexes).toEqual(new Set([0, 1]));
	});

	test("2. accepted fence returns a different canonical: fail with the checkCanonical message", async () => {
		const kit = await kitFrom(
			new Map([
				[`${KIT_PATH}/types.md`, ["## types-0001: t {node=Type}", "```json canonical", '{"a":1}', "```", "```json accepted", '{"a":1}', "```", ""].join("\n")],
			]),
		);
		// Both fences carry the same body; the accepted fence's decode is made to
		// answer wrong by keying on call order rather than content.
		let call = 0;
		const { testee } = scriptedTestee(FULL_CAPS, () => {
			call += 1;
			return call === 1
				? { ok: true, kind: "Type", canonical: { json: '{"a":1}' }, warnings: [] }
				: { ok: true, kind: "Type", canonical: { json: '{"a":2}' }, warnings: [] };
		});
		const report = await runKit(kit, testee, opts);
		expect(report.records).toHaveLength(2);
		const accepted = report.records.find((r) => r.role === "accepted");
		expect(accepted?.result).toBe("fail");
		expect(accepted?.message).toBe(checkCanonical('{"a":1}', '{"a":2}') ?? undefined);
		const canonical = report.records.find((r) => r.role === "canonical");
		expect(canonical?.result).toBe("pass");
	});

	test("3. accepted warning=legacy_spelling: pass when it matches, fail when it doesn't", async () => {
		const kitWith = (warnings: readonly { code: string; cursor: string }[]) =>
			kitFrom(
				new Map([
					[
						`${KIT_PATH}/types.md`,
						["## types-0001: t {node=Type}", "```json canonical", '{"a":1}', "```", "```json accepted warning=legacy_spelling", '{"a":1}', "```", ""].join(
							"\n",
						),
					],
				]),
			).then(async (kit) => {
				const { testee } = scriptedTestee(FULL_CAPS, () => ({ ok: true, kind: "Type", canonical: { json: '{"a":1}' }, warnings }));
				return runKit(kit, testee, opts);
			});
		const passing = await kitWith([{ code: "legacy_spelling", cursor: "/a" }]);
		const acceptedPass = passing.records.find((r) => r.role === "accepted");
		expect(acceptedPass?.result).toBe("pass");

		const failing = await kitWith([]);
		const acceptedFail = failing.records.find((r) => r.role === "accepted");
		expect(acceptedFail?.result).toBe("fail");
		expect(acceptedFail?.message).toBe("should have warned legacy_spelling and nothing else (got nothing)");
	});

	test("4. rejected diagnostic= and expect=, judged by checkRejected", async () => {
		const kit = await kitFrom(
			new Map([
				[
					`${KIT_PATH}/types.md`,
					[
						"## types-0001: t {node=Type}",
						"```json canonical",
						'{"a":1}',
						"```",
						"```json rejected diagnostic=unknown_member",
						'{"b":1}',
						"```",
						"```json rejected expect=Tuple",
						'{"c":1}',
						"```",
						"",
					].join("\n"),
				],
			]),
		);
		const { testee } = scriptedTestee(FULL_CAPS, (req) => {
			if (req.input.includes("b")) return { ok: false, diagnostic: { code: "unknown_member", stage: "normalization", cursor: "/x", message: "m" } };
			if (req.input.includes("c")) return { ok: true, kind: "Tuple", canonical: { json: "[]" }, warnings: [] };
			return { ok: true, kind: "Type", canonical: { json: '{"a":1}' }, warnings: [] };
		});
		const report = await runKit(kit, testee, opts);
		const diagnostic = report.records.find((r) => r.fenceIndex === 1);
		expect(diagnostic).toMatchObject({ result: "pass", expectedDiagnostic: "unknown_member" });
		const expectRec = report.records.find((r) => r.fenceIndex === 2);
		expect(expectRec).toMatchObject({ result: "pass" });
	});

	test("5. profile and layout skips: yaml body, text-yaml, text-json (compares against itself)", async () => {
		const kit = await kitFrom(
			new Map([
				[`${KIT_PATH}/types.md`, ["## types-0001: t {node=Type}", "```yaml canonical", "a: 1", "```", ""].join("\n")],
				[`${KIT_PATH}/values.md`, ["## values-0001: v {node=Value}", "```text canonical", `${KIT_PATH}/documents/v.yaml`, "```", ""].join("\n")],
				[`${KIT_PATH}/patterns.md`, ["## patterns-0001: p {node=Pattern}", "```text canonical", `${KIT_PATH}/documents/p.json`, "```", ""].join("\n")],
				[`${KIT_PATH}/documents/v.yaml`, "a: 1\n"],
				[`${KIT_PATH}/documents/p.json`, '{"p":1}\n'],
			]),
		);
		const { testee, decodeCalls } = scriptedTestee(FULL_CAPS, () => ({ ok: true, kind: "Pattern", canonical: { json: '{"p":1}' }, warnings: [] }));
		const report = await runKit(kit, testee, opts);

		const yamlBody = report.records.find((r) => r.caseId === "types-0001");
		expect(yamlBody).toMatchObject({ result: "skipped", message: "profile yaml not in capabilities" });

		const textYaml = report.records.find((r) => r.caseId === "values-0001");
		expect(textYaml).toMatchObject({ result: "skipped", message: "profile yaml not in capabilities" });

		const textJson = report.records.find((r) => r.caseId === "patterns-0001");
		expect(textJson).toMatchObject({ result: "pass", profile: "json" });
		expect(decodeCalls).toHaveLength(1);
		expect(decodeCalls[0]?.input).toBe('{"p":1}\n');
	});

	test("6. file fences with a single-only testee are skipped as tree unsupported", async () => {
		const kit = await kitFrom(
			new Map([
				[
					`${KIT_PATH}/document-tree.md`,
					["## document-tree-0001: d {node=IRFile}", "```json canonical", '{"a":1}', "```", "```json file path=a.json", '{"a":1}', "```", ""].join("\n"),
				],
			]),
		);
		const { testee } = scriptedTestee(FULL_CAPS, () => ({ ok: true, kind: "IRFile", canonical: { json: '{"a":1}' }, warnings: [] }));
		const report = await runKit(kit, testee, opts);
		const fileRecord = report.records.find((r) => r.role === "file");
		expect(fileRecord).toMatchObject({ result: "skipped", profile: "tree", message: "layout tree not in capabilities" });
	});

	test("7. pending case: every fence skipped with message pending", async () => {
		const kit = await kitFrom(
			new Map([
				[
					`${KIT_PATH}/types.md`,
					[
						"## types-0001: t {status=pending}",
						"```json rejected diagnostic=unknown_member",
						'{"a":1}',
						"```",
						"```json rejected expect=Tuple",
						'{"b":1}',
						"```",
						"",
					].join("\n"),
				],
			]),
		);
		const { testee, decodeCalls } = scriptedTestee(FULL_CAPS, () => ({ ok: true, kind: "Type", canonical: { json: "{}" }, warnings: [] }));
		const report = await runKit(kit, testee, opts);
		expect(report.records).toHaveLength(2);
		for (const r of report.records) expect(r).toMatchObject({ result: "skipped", message: "pending" });
		expect(decodeCalls).toHaveLength(0);
	});

	test("8. version=3 with a v4-only testee: skipped", async () => {
		const kit = await kitFrom(
			new Map([[`${KIT_PATH}/types.md`, ["## types-0001: t {node=Type version=3}", "```json canonical", '{"a":1}', "```", ""].join("\n")]]),
		);
		const { testee } = scriptedTestee(FULL_CAPS, () => ({ ok: true, kind: "Type", canonical: { json: '{"a":1}' }, warnings: [] }));
		const report = await runKit(kit, testee, opts);
		expect(report.records).toHaveLength(1);
		expect(report.records[0]).toMatchObject({ result: "skipped", message: "version 3 not in capabilities" });
	});

	test("9. paths disagree: both records fail", async () => {
		const kit = await kitFrom(new Map([[`${KIT_PATH}/types.md`, ["## types-0001: t {node=Type}", "```json canonical", '{"a":1}', "```", ""].join("\n")]]));
		const caps: Capabilities = { ...FULL_CAPS, paths: ["current", "pinned"] };
		const { testee } = scriptedTestee(caps, (req) => ({
			ok: true,
			kind: "Type",
			canonical: { json: req.path === "current" ? '{"a":1}' : '{"a":2}' },
			warnings: [],
		}));
		const report = await runKit(kit, testee, opts);
		expect(report.records).toHaveLength(2);
		for (const r of report.records) {
			expect(r.result).toBe("fail");
			expect(r.message).toMatch(/^paths disagree:/);
		}
	});

	test("10. kit errors become kit-error records, owned by the enclosing case when there is one", async () => {
		const files = new Map([
			[
				`${KIT_PATH}/types.md`,
				[
					"```json canonical",
					"1",
					"```",
					"## types-0001: t {node=Type}",
					"```json canonical",
					'{"a":1}',
					"```",
					"```json canonical",
					'{"a":2}',
					"```",
					"",
				].join("\n"),
			],
		]);
		const kit = await kitFrom(files);
		expect(kit.errors.length).toBe(2);
		const { testee } = scriptedTestee(FULL_CAPS, () => ({ ok: true, kind: "Type", canonical: { json: '{"a":1}' }, warnings: [] }));
		const report = await runKit(kit, testee, opts);
		const kitErrors = report.records.filter((r) => r.result === "kit-error");
		expect(kitErrors).toHaveLength(2);
		const unowned = kitErrors.find((r) => r.caseId === "kit-0000");
		expect(unowned).toMatchObject({ role: "canonical", fenceIndex: 0, profile: "json", irVersion: 4 });
		const owned = kitErrors.find((r) => r.caseId === "types-0001");
		expect(owned).toBeDefined();
	});

	test("11. a ProtocolError thrown mid-run ends the conversation", async () => {
		const kit = await kitFrom(
			new Map([
				[
					`${KIT_PATH}/types.md`,
					[
						"## types-0001: t {node=Type}",
						"```json canonical",
						'{"a":1}',
						"```",
						"```json accepted",
						'{"a":1}',
						"```",
						"```json accepted",
						'{"a":1}',
						"```",
						"",
					].join("\n"),
				],
			]),
		);
		let call = 0;
		const { testee, decodeCalls } = scriptedTestee(FULL_CAPS, () => {
			call += 1;
			if (call === 2) throw new ProtocolError("adapter crashed");
			return { ok: true, kind: "Type", canonical: { json: '{"a":1}' }, warnings: [] };
		});
		const report = await runKit(kit, testee, opts);
		expect(report.records).toHaveLength(3);
		expect(report.records[0]?.result).toBe("pass");
		expect(report.records[1]).toMatchObject({ result: "kit-error", message: "adapter crashed" });
		expect(report.records[2]).toMatchObject({ result: "kit-error", message: "adapter unavailable: adapter crashed" });
		expect(decodeCalls).toHaveLength(2);
	});

	test("12. only restricts to matching case ids", async () => {
		const kit = await kitFrom(
			new Map([
				[`${KIT_PATH}/types.md`, ["## types-0001: t {node=Type}", "```json canonical", '{"a":1}', "```", ""].join("\n")],
				[`${KIT_PATH}/values.md`, ["## values-0001: v {node=Value}", "```json canonical", '{"a":1}', "```", ""].join("\n")],
			]),
		);
		const { testee } = scriptedTestee(FULL_CAPS, () => ({ ok: true, kind: "Type", canonical: { json: '{"a":1}' }, warnings: [] }));
		const report = await runKit(kit, testee, { ...opts, only: /^types-/ });
		expect(report.records.map((r) => r.caseId)).toEqual(["types-0001"]);
	});

	test("13. exitCodeFor", () => {
		const base = { contractVersion: 1 as const, binding: "b", language: "l", driverVersion: "d", kitVersion: "k", startedAt: new Date().toISOString() };
		const passOnly = {
			...base,
			records: [
				{ caseId: "types-0001", irVersion: 4, profile: "json" as const, role: "canonical" as const, fenceIndex: 0, result: "pass" as const, durationMs: 0 },
			],
		};
		expect(exitCodeFor(passOnly, false)).toBe(0);
		const withSkip = { ...base, records: [{ ...passOnly.records[0]!, result: "skipped" as const }] };
		expect(exitCodeFor(withSkip, false)).toBe(0);
		expect(exitCodeFor(withSkip, true)).toBe(1);
		const withFail = { ...base, records: [{ ...passOnly.records[0]!, result: "fail" as const }] };
		expect(exitCodeFor(withFail, false)).toBe(1);
		const withKitError = { ...base, records: [{ ...passOnly.records[0]!, result: "kit-error" as const }] };
		expect(exitCodeFor(withKitError, false)).toBe(1);
	});

	test("14. capabilities rejected by parseCapabilities: every fence kit-error, no decode calls", async () => {
		const kit = await kitFrom(
			new Map([
				[`${KIT_PATH}/types.md`, ["## types-0001: t {node=Type}", "```json canonical", '{"a":1}', "```", "```json accepted", '{"a":1}', "```", ""].join("\n")],
			]),
		);
		const { testee, decodeCalls } = scriptedTestee(
			{ contractVersion: 2, binding: "b", language: "l", versions: [4], profiles: ["json"], layouts: ["single"], paths: ["current"] },
			() => ({
				ok: true,
				kind: "Type",
				canonical: { json: '{"a":1}' },
				warnings: [],
			}),
		);
		const report = await runKit(kit, testee, opts);
		expect(report.records).toHaveLength(2);
		for (const r of report.records) expect(r.result).toBe("kit-error");
		expect(decodeCalls).toHaveLength(0);
	});

	test("15. (fix round 1, Critical 1) a kit-error sharing a caseId with a two-path case is never swept into path reconciliation", async () => {
		// Two identical-content canonical fences still trip case.ts's "more than
		// one canonical" rule (a kit error, attributed to types-0001,
		// fenceIndex 0, no path), while every fence in the case decodes and
		// compares consistently on both paths. Before the fix, reconcilePaths
		// scanned the whole report by caseId, so the kit-error record joined the
		// fenceIndex-0 group and its mismatched signature (no `path`, "kit-error"
		// vs "pass") flipped both real path records to a false "paths disagree".
		const kit = await kitFrom(
			new Map([
				[
					`${KIT_PATH}/types.md`,
					[
						"## types-0001: t {node=Type}",
						"```json canonical",
						'{"a":1}',
						"```",
						"```json canonical",
						'{"a":1}',
						"```",
						"```json accepted",
						'{"a":1}',
						"```",
						"",
					].join("\n"),
				],
			]),
		);
		expect(kit.errors.length).toBe(1);
		const caps: Capabilities = { ...FULL_CAPS, paths: ["current", "pinned"] };
		const { testee } = scriptedTestee(caps, () => ({ ok: true, kind: "Type", canonical: { json: '{"a":1}' }, warnings: [] }));
		const report = await runKit(kit, testee, opts);

		const kitError = report.records.find((r) => r.result === "kit-error");
		expect(kitError).toMatchObject({ caseId: "types-0001", fenceIndex: 0 });
		expect(kitError?.path).toBeUndefined();

		for (const fenceIndex of [0, 1, 2]) {
			const pair = report.records.filter((r) => r.fenceIndex === fenceIndex && r.path !== undefined);
			expect(pair).toHaveLength(2);
			for (const r of pair) expect(r.result).toBe("pass");
		}
	});

	test("16. (fix round 1, Critical 2) a kit error inside the second case of a file is owned by that case, not the file's first", async () => {
		const kit = await kitFrom(
			new Map([
				[
					`${KIT_PATH}/types.md`,
					[
						"## types-0001: first {node=Type}",
						"```json canonical",
						'{"a":1}',
						"```",
						"## types-0002: second {node=Type}",
						"```json canonical",
						'{"a":1}',
						"```",
						"```json canonical",
						'{"a":2}',
						"```",
						"",
					].join("\n"),
				],
			]),
		);
		expect(kit.errors.length).toBe(1);
		const { testee } = scriptedTestee(FULL_CAPS, () => ({ ok: true, kind: "Type", canonical: { json: '{"a":1}' }, warnings: [] }));
		const report = await runKit(kit, testee, opts);
		const kitError = report.records.find((r) => r.result === "kit-error");
		expect(kitError?.caseId).toBe("types-0002");
	});

	test("17. (fix round 1, Critical 2) the same, with two declared paths, does not misattribute or downgrade unrelated records", async () => {
		const kit = await kitFrom(
			new Map([
				[
					`${KIT_PATH}/types.md`,
					[
						"## types-0001: first {node=Type}",
						"```json canonical",
						'{"a":1}',
						"```",
						"## types-0002: second {node=Type}",
						"```json canonical",
						'{"a":1}',
						"```",
						"```json canonical",
						'{"a":2}',
						"```",
						"",
					].join("\n"),
				],
			]),
		);
		expect(kit.errors.length).toBe(1);
		const caps: Capabilities = { ...FULL_CAPS, paths: ["current", "pinned"] };
		const { testee } = scriptedTestee(caps, () => ({ ok: true, kind: "Type", canonical: { json: '{"a":1}' }, warnings: [] }));
		const report = await runKit(kit, testee, opts);
		const kitError = report.records.find((r) => r.result === "kit-error");
		expect(kitError?.caseId).toBe("types-0002");
		const firstCaseRecords = report.records.filter((r) => r.caseId === "types-0001");
		expect(firstCaseRecords).toHaveLength(2);
		for (const r of firstCaseRecords) expect(r.result).toBe("pass");
	});

	test("18. (fix round 1, Important 3) an accepted fence with no canonical of its profile is kit-error, not self-compared", async () => {
		const kit = await kitFrom(
			new Map([
				[`${KIT_PATH}/types.md`, ["## types-0001: t {node=Type}", "```yaml canonical", "a: 1", "```", "```json accepted", '{"a":1}', "```", ""].join("\n")],
			]),
		);
		const { testee, decodeCalls } = scriptedTestee(FULL_CAPS, () => ({ ok: true, kind: "Type", canonical: { json: '{"a":1}' }, warnings: [] }));
		const report = await runKit(kit, testee, opts);
		const accepted = report.records.find((r) => r.role === "accepted");
		expect(accepted).toMatchObject({ result: "kit-error", message: "no canonical json fence in types-0001" });
		expect(decodeCalls).toHaveLength(1);
	});

	test("19. (fix round 1, Ruling A) an undeclared node is skipped and the testee is never asked to decode it", async () => {
		const kit = await kitFrom(
			new Map([[`${KIT_PATH}/types.md`, ["## types-0001: t {node=Frobnicate}", "```json canonical", '{"a":1}', "```", ""].join("\n")]]),
		);
		const { testee, decodeCalls } = scriptedTestee(FULL_CAPS, () => ({ ok: true, kind: "Type", canonical: { json: '{"a":1}' }, warnings: [] }));
		const report = await runKit(kit, testee, opts);
		expect(report.records).toHaveLength(1);
		expect(report.records[0]).toMatchObject({ result: "skipped", message: "node Frobnicate not in capabilities" });
		expect(decodeCalls).toHaveLength(0);
	});

	test("20. (fix round 1, Ruling A) a case with no node= is skipped as node unset", async () => {
		const kit = await kitFrom(new Map([[`${KIT_PATH}/types.md`, ["## types-0001: t", "```json canonical", '{"a":1}', "```", ""].join("\n")]]));
		const { testee, decodeCalls } = scriptedTestee(FULL_CAPS, () => ({ ok: true, kind: "Type", canonical: { json: '{"a":1}' }, warnings: [] }));
		const report = await runKit(kit, testee, opts);
		expect(report.records).toHaveLength(1);
		expect(report.records[0]).toMatchObject({ result: "skipped", message: "node unset not in capabilities" });
		expect(decodeCalls).toHaveLength(0);
	});

	test("21. (fix round 1, minor 7) a text fence whose role is file gets profile tree, like a literal file fence", async () => {
		const kit = await kitFrom(
			new Map([
				[
					`${KIT_PATH}/document-tree.md`,
					[
						"## document-tree-0001: d {node=IRFile}",
						"```json canonical",
						'{"a":1}',
						"```",
						"```text file path=manifest",
						`${KIT_PATH}/documents/manifest.json`,
						"```",
						"",
					].join("\n"),
				],
				[`${KIT_PATH}/documents/manifest.json`, '{"m":1}\n'],
			]),
		);
		const { testee, decodeCalls } = scriptedTestee(FULL_CAPS, () => ({ ok: true, kind: "IRFile", canonical: { json: '{"a":1}' }, warnings: [] }));
		const report = await runKit(kit, testee, opts);
		const fileRecord = report.records.find((r) => r.role === "file");
		expect(fileRecord).toMatchObject({ result: "skipped", profile: "tree", message: "layout tree not in capabilities" });
		// Only the canonical fence's decode call happened; the text-file fence
		// was never resolved into a json/yaml decode attempt.
		expect(decodeCalls).toHaveLength(1);
	});
});

// ------------------------------------------------- the tree comparison (S8)

const TREE_CAPS: Capabilities = { ...FULL_CAPS, profiles: ["json", "yaml"], layouts: ["single", "tree"] };

const MANIFEST_BODY = ["formatVersion: 4", "distribution: Library", "package: a/b", "pathBudget: 4000"].join("\n");
const MODULE_BODY = ["formatVersion: 4", "path: m", "types: []", "values: []"].join("\n");
const TREE_CANONICAL = "distribution: Library";

/** A `document-tree` case with one canonical fence and the `file` fences given. */
function treeKit(fences: readonly string[], canonical = ["```yaml canonical", TREE_CANONICAL, "```"]): Promise<Kit> {
	return kitFrom(new Map([[`${KIT_PATH}/document-tree.md`, ["## document-tree-0001: d {node=IRFile}", ...canonical, ...fences, ""].join("\n")]]));
}

const SET_FENCES: readonly string[] = [
	"```yaml file path=manifest set=s",
	MANIFEST_BODY,
	"```",
	"```yaml file path=pkg/a/b/m/module set=s",
	MODULE_BODY,
	"```",
];

interface TreeScript {
	readonly readTree?: (req: ReadTreeRequest) => DecodeResponse;
	readonly writeTree?: (req: WriteTreeRequest) => WriteTreeResponse;
}

function treeTestee(capabilities: Capabilities, script: TreeScript): { testee: Testee; readCalls: ReadTreeRequest[]; writeCalls: WriteTreeRequest[] } {
	const readCalls: ReadTreeRequest[] = [];
	const writeCalls: WriteTreeRequest[] = [];
	const testee: Testee = {
		capabilities: async () => capabilities,
		decode: async () => ({ ok: true, kind: "IRFile", canonical: { json: TREE_CANONICAL, yaml: TREE_CANONICAL }, warnings: [] }),
		readTree: async (req) => {
			readCalls.push(req);
			return script.readTree?.(req) ?? { ok: true, kind: "IRFile", canonical: { yaml: TREE_CANONICAL }, warnings: [] };
		},
		writeTree: async (req) => {
			writeCalls.push(req);
			return script.writeTree?.(req) ?? { ok: true, files: [] };
		},
		close: async () => {},
	};
	return { testee, readCalls, writeCalls };
}

/** The set written back exactly as the fences spell it. */
const WRITTEN_SET: readonly { path: string; content: string }[] = [
	{ path: "manifest", content: MANIFEST_BODY },
	{ path: "pkg/a/b/m/module", content: MODULE_BODY },
];
const echoSet = (): WriteTreeResponse => ({ ok: true, files: WRITTEN_SET });

describe("runKit: the tree comparison", () => {
	test("a. a set that reads to the canonical and writes back identically passes on every fence", async () => {
		const kit = await treeKit(SET_FENCES);
		const { testee, readCalls, writeCalls } = treeTestee(TREE_CAPS, { writeTree: echoSet });
		const report = await runKit(kit, testee, opts);
		const files = report.records.filter((r) => r.role === "file");
		expect(files).toHaveLength(2);
		for (const r of files) expect(r).toMatchObject({ result: "pass", profile: "tree", caseId: "document-tree-0001" });
		// One readTree and one writeTree for the set, not one per fence.
		expect(readCalls).toHaveLength(1);
		expect(writeCalls).toHaveLength(1);
		// The fence body, verbatim, under its logical path: the driver never
		// reshapes what a fence says before handing it to the testee.
		expect(readCalls[0]).toMatchObject({
			profile: "yaml",
			strip: true,
			files: [
				{ path: "manifest", content: `${MANIFEST_BODY}\n` },
				{ path: "pkg/a/b/m/module", content: `${MODULE_BODY}\n` },
			],
		});
		// The budget is read lexically from the manifest fence (S8).
		expect(writeCalls[0]).toMatchObject({ policy: { profile: "yaml", pathBudget: 4000 }, input: `${TREE_CANONICAL}\n` });
		// Records come back in fence order, canonical first.
		expect(report.records.map((r) => r.fenceIndex)).toEqual([0, 1, 2]);
	});

	test("b. a read canonical that differs fails every fence of the set with the same message", async () => {
		const kit = await treeKit(SET_FENCES);
		const { testee } = treeTestee(TREE_CAPS, {
			readTree: () => ({ ok: true, kind: "IRFile", canonical: { yaml: "distribution: Application" }, warnings: [] }),
			writeTree: echoSet,
		});
		const report = await runKit(kit, testee, opts);
		const files = report.records.filter((r) => r.role === "file");
		expect(files).toHaveLength(2);
		for (const r of files) {
			expect(r.result).toBe("fail");
			expect(r.message).toBe("set s read back differently: line 1 differs: expected distribution: Library got distribution: Application");
		}
	});

	test("c. a written file the set does not have fails the manifest's record only", async () => {
		const kit = await treeKit(SET_FENCES);
		const { testee } = treeTestee(TREE_CAPS, {
			writeTree: () => ({ ok: true, files: [...WRITTEN_SET, { path: "pkg/a/b/m/extra.type", content: "x" }] }),
		});
		const report = await runKit(kit, testee, opts);
		const files = report.records.filter((r) => r.role === "file");
		expect(files[0]).toMatchObject({ result: "fail", message: "writeTree produced pkg/a/b/m/extra.type, which the set does not have" });
		expect(files[1]).toMatchObject({ result: "pass" });
	});

	test("d. a file the writer omits fails that fence's record only", async () => {
		const kit = await treeKit(SET_FENCES);
		const { testee } = treeTestee(TREE_CAPS, {
			writeTree: () => ({ ok: true, files: [{ path: "manifest", content: MANIFEST_BODY }] }),
		});
		const report = await runKit(kit, testee, opts);
		const files = report.records.filter((r) => r.role === "file");
		expect(files[0]).toMatchObject({ result: "pass" });
		expect(files[1]).toMatchObject({ result: "fail", message: "writeTree did not produce pkg/a/b/m/module" });
	});

	test("e. a set whose fences mix json and yaml is a kit-error", async () => {
		const kit = await treeKit([
			"```yaml file path=manifest set=s",
			MANIFEST_BODY,
			"```",
			"```json file path=pkg/a/b/m/module set=s",
			'{ "formatVersion": 4 }',
			"```",
		]);
		const { testee, readCalls } = treeTestee(TREE_CAPS, {});
		const report = await runKit(kit, testee, opts);
		const files = report.records.filter((r) => r.role === "file");
		expect(files).toHaveLength(2);
		for (const r of files) expect(r).toMatchObject({ result: "kit-error", message: "mixed profiles in set s" });
		expect(readCalls).toHaveLength(0);
	});

	test("f. a manifest with no readable pathBudget is a kit-error, and a missing manifest names the set", async () => {
		const noBudget = await treeKit(["```yaml file path=manifest set=s", "formatVersion: 4", "```"]);
		const { testee } = treeTestee(TREE_CAPS, {});
		const report = await runKit(noBudget, testee, opts);
		expect(report.records.filter((r) => r.role === "file")[0]).toMatchObject({
			result: "kit-error",
			message: "set s: manifest has no readable pathBudget",
		});

		const noManifest = await treeKit(["```yaml file path=pkg/a/b/m/module set=s", MODULE_BODY, "```"]);
		const second = await runKit(noManifest, treeTestee(TREE_CAPS, {}).testee, opts);
		expect(second.records.filter((r) => r.role === "file")[0]).toMatchObject({ result: "kit-error", message: "set s has no manifest" });
	});

	test("f2. an unresolved text file fence carries the fuller `set <name>: <message>`, the set's other fences the bare message", async () => {
		const kit = await treeKit([
			"```yaml file path=manifest set=s",
			MANIFEST_BODY,
			"```",
			"```text file path=pkg/a/b/m/module set=s",
			`${KIT_PATH}/documents/missing.yaml`,
			"```",
		]);
		const { testee } = treeTestee(TREE_CAPS, {});
		const report = await runKit(kit, testee, opts);
		const files = report.records.filter((r) => r.role === "file");
		expect(files).toHaveLength(2);
		const bareMessage = `text fence names ${KIT_PATH}/documents/missing.yaml, which is not in the kit source (scripted)`;
		const manifestRecord = files.find((r) => r.fenceIndex === 1);
		const moduleRecord = files.find((r) => r.fenceIndex === 2);
		expect(manifestRecord).toMatchObject({ result: "kit-error", message: bareMessage });
		expect(moduleRecord).toMatchObject({ result: "kit-error", message: `set s: ${bareMessage}` });
	});

	test("g. a testee without the tree layout skips the set, and one without the profile skips it too", async () => {
		const kit = await treeKit(SET_FENCES);
		const single = await runKit(kit, treeTestee({ ...TREE_CAPS, layouts: ["single"] }, {}).testee, opts);
		for (const r of single.records.filter((x) => x.role === "file")) {
			expect(r).toMatchObject({ result: "skipped", profile: "tree", message: "layout tree not in capabilities" });
		}
		const jsonOnly = await runKit(kit, treeTestee({ ...TREE_CAPS, profiles: ["json"] }, {}).testee, opts);
		for (const r of jsonOnly.records.filter((x) => x.role === "file")) {
			expect(r).toMatchObject({ result: "skipped", profile: "tree", message: "profile yaml not in capabilities" });
		}
	});

	test("h. a mode=read set runs only the read half", async () => {
		const kit = await treeKit([
			"```yaml file path=manifest set=s mode=read",
			MANIFEST_BODY,
			"```",
			"```yaml file path=pkg/a/b/m/module set=s mode=read",
			MODULE_BODY,
			"```",
		]);
		// The writer would produce nothing at all; with the write half skipped the
		// set still passes on its read.
		const { testee, readCalls, writeCalls } = treeTestee(TREE_CAPS, { writeTree: () => ({ ok: true, files: [] }) });
		const report = await runKit(kit, testee, opts);
		const files = report.records.filter((r) => r.role === "file");
		expect(files).toHaveLength(2);
		for (const r of files) expect(r).toMatchObject({ result: "pass" });
		expect(readCalls).toHaveLength(1);
		expect(writeCalls).toHaveLength(0);
	});

	test("i. a readTree the testee refuses fails the set and carries the diagnostic", async () => {
		const kit = await treeKit(SET_FENCES);
		const { testee } = treeTestee(TREE_CAPS, {
			readTree: () => ({ ok: false, diagnostic: { code: "missing_member", cursor: "manifest", message: 'missing file "manifest"' } }),
			writeTree: echoSet,
		});
		const report = await runKit(kit, testee, opts);
		for (const r of report.records.filter((x) => x.role === "file")) {
			expect(r.result).toBe("fail");
			expect(r.message).toContain('set s failed to readTree: missing_member at manifest: missing file "manifest"');
			expect(r.observedDiagnostic).toMatchObject({ code: "missing_member" });
		}
	});

	test("j. a case with a file set but no canonical of the set's profile is a kit-error", async () => {
		const kit = await treeKit(SET_FENCES, ["```json canonical", '{"a":1}', "```"]);
		const { testee } = treeTestee(TREE_CAPS, {});
		const report = await runKit(kit, testee, opts);
		for (const r of report.records.filter((x) => x.role === "file")) {
			expect(r).toMatchObject({ result: "kit-error", message: "no canonical yaml fence in document-tree-0001" });
		}
	});

	test("k. a writeTree the testee refuses fails every record of the set with the diagnostic", async () => {
		const kit = await treeKit(SET_FENCES);
		const { testee } = treeTestee(TREE_CAPS, {
			writeTree: () => ({ ok: false, diagnostic: { code: "invalid_distribution_shape", cursor: "/", message: "path budget 4000 cannot fit x" } }),
		});
		const report = await runKit(kit, testee, opts);
		const files = report.records.filter((r) => r.role === "file");
		expect(files).toHaveLength(2);
		for (const r of files) {
			expect(r.result).toBe("fail");
			expect(r.message).toBe("set s failed to writeTree: invalid_distribution_shape at /: path budget 4000 cannot fit x");
		}
	});

	test("l. a read failure and a write failure are both reported on the record that has both", async () => {
		const kit = await treeKit(SET_FENCES);
		const { testee } = treeTestee(TREE_CAPS, {
			readTree: () => ({ ok: true, kind: "IRFile", canonical: { yaml: "distribution: Application" }, warnings: [] }),
			writeTree: () => ({ ok: true, files: [{ path: "manifest", content: MANIFEST_BODY }] }),
		});
		const report = await runKit(kit, testee, opts);
		const files = report.records.filter((r) => r.role === "file");
		// The manifest read back wrong but was written correctly: the read message
		// alone. The module failed both halves and carries both.
		expect(files[0]?.message).toBe("set s read back differently: line 1 differs: expected distribution: Library got distribution: Application");
		expect(files[1]?.message).toBe(
			"set s read back differently: line 1 differs: expected distribution: Library got distribution: Application; writeTree did not produce pkg/a/b/m/module",
		);
		for (const r of files) expect(r.result).toBe("fail");
	});

	test("m. compare=attributes sends strip: false to both tree operations", async () => {
		const kit = await kitFrom(
			new Map([
				[
					`${KIT_PATH}/document-tree.md`,
					["## document-tree-0001: d {node=IRFile compare=attributes}", "```yaml canonical", TREE_CANONICAL, "```", ...SET_FENCES, ""].join("\n"),
				],
			]),
		);
		const { testee, readCalls, writeCalls } = treeTestee(TREE_CAPS, { writeTree: echoSet });
		await runKit(kit, testee, opts);
		expect(readCalls[0]?.strip).toBeFalse();
		// writeTree has no strip of its own: the policy is the whole request, and
		// the canonical it is fed already carries the attributes.
		expect(writeCalls).toHaveLength(1);
		expect(writeCalls[0]?.policy).toEqual({ profile: "yaml", pathBudget: 4000 });
	});
});
