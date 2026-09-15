// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the report comparison used by `mise run check:conformance`
// to hold the in-process binding and the packaged adapter to the same
// results.

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { firstDifference, normalizeReport } from "./compare-reports.ts";

function report(records: readonly Record<string, unknown>[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		contractVersion: 1,
		binding: "morphir-typescript",
		language: "typescript",
		driverVersion: "0.0.1",
		kitVersion: "abc",
		startedAt: "2026-01-01T00:00:00.000Z",
		records,
		...overrides,
	};
}

function record(caseId: string, result: string, durationMs: number): Record<string, unknown> {
	return { caseId, fenceIndex: 0, profile: "json", role: "canonical", result, durationMs };
}

describe("normalizeReport", () => {
	test("drops startedAt and every record's durationMs", () => {
		const normalized = normalizeReport(report([record("types-0001", "pass", 12)]));
		expect(normalized).not.toHaveProperty("startedAt");
		expect(normalized.records[0]).not.toHaveProperty("durationMs");
		expect(normalized.records[0]).toEqual({ caseId: "types-0001", fenceIndex: 0, profile: "json", role: "canonical", result: "pass" });
	});
});

describe("firstDifference", () => {
	test("reports no difference when only timing fields differ", () => {
		const left = report([record("types-0001", "pass", 12)], { startedAt: "2026-01-01T00:00:00.000Z" });
		const right = report([record("types-0001", "pass", 999)], { startedAt: "2026-01-02T00:00:00.000Z" });
		expect(firstDifference(left, right)).toBeUndefined();
	});

	test("finds the first differing record by position", () => {
		const left = report([record("types-0001", "pass", 1), record("types-0002", "pass", 1)]);
		const right = report([record("types-0001", "pass", 1), record("types-0002", "fail", 1)]);
		const difference = firstDifference(left, right);
		expect(difference?.index).toBe(1);
	});

	test("reports a length mismatch as a difference at the shorter report's end", () => {
		const left = report([record("types-0001", "pass", 1)]);
		const right = report([record("types-0001", "pass", 1), record("types-0002", "pass", 1)]);
		const difference = firstDifference(left, right);
		expect(difference?.index).toBe(1);
		expect(difference?.left).toBeUndefined();
	});

	test("finds a difference in the report header when records match", () => {
		const left = report([record("types-0001", "pass", 1)], { binding: "morphir-typescript" });
		const right = report([record("types-0001", "pass", 1)], { binding: "morphir-typescript-adapter" });
		const difference = firstDifference(left, right);
		expect(difference?.index).toBe(-1);
	});
});

describe("compare-reports.ts CLI", () => {
	async function run(args: readonly string[]): Promise<{ code: number; out: string; err: string }> {
		const proc = Bun.spawn(["bun", path.join(import.meta.dir, "compare-reports.ts"), ...args], { stdout: "pipe", stderr: "pipe" });
		const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
		return { code, out, err };
	}

	test("exits 0 and prints a summary when the reports agree", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "mck-compare-"));
		try {
			const left = path.join(dir, "left.json");
			const right = path.join(dir, "right.json");
			await writeFile(left, JSON.stringify(report([record("types-0001", "pass", 1)])));
			await writeFile(right, JSON.stringify(report([record("types-0001", "pass", 5)])));
			const r = await run([left, right]);
			expect(r.code).toBe(0);
			expect(r.out).toContain("agree on 1 record(s)");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("exits 1 and prints the first differing record when the reports disagree", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "mck-compare-"));
		try {
			const left = path.join(dir, "left.json");
			const right = path.join(dir, "right.json");
			await writeFile(left, JSON.stringify(report([record("types-0001", "pass", 1)])));
			await writeFile(right, JSON.stringify(report([record("types-0001", "fail", 1)])));
			const r = await run([left, right]);
			expect(r.code).toBe(1);
			expect(r.err).toContain("record 0");
			expect(r.err).toContain("types-0001");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("exits 2 with usage when an argument is missing", async () => {
		const r = await run(["only-one.json"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("usage:");
	});
});
