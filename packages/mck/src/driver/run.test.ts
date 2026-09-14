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
});
