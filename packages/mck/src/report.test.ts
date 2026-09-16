//
// Tests for the report skeleton builder. Run with: bun test src/report.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyReport, formatSummary, type Report, type ReportRecord, summarize, writeReport } from "./report.ts";

test("emptyReport is a valid report skeleton", () => {
	const report: Report = emptyReport({
		binding: "morphir-typescript",
		language: "typescript",
		formatVersions: "[4.0.0,4.1.0)",
		driverVersion: "0.0.0",
		kitVersion: "test",
	});
	expect(report.contractVersion).toBe(1);
	expect(report.formatVersions).toBe("[4.0.0,4.1.0)");
	expect(report.records).toEqual([]);
	expect(() => new Date(report.startedAt).toISOString()).not.toThrow();
});

const threeRecords: readonly ReportRecord[] = [
	{ caseId: "types-0001", irVersion: 4, profile: "json", role: "canonical", fenceIndex: 0, result: "pass", durationMs: 1 },
	{ caseId: "types-0002", irVersion: 4, profile: "json", role: "accepted", fenceIndex: 0, result: "fail", message: "nope", durationMs: 1 },
	{
		caseId: "types-0003",
		irVersion: 4,
		profile: "yaml",
		role: "canonical",
		fenceIndex: 0,
		result: "skipped",
		message: "profile yaml not in capabilities",
		durationMs: 0,
	},
];

describe("summarize", () => {
	test("counts each result", () => {
		const report = {
			...emptyReport({ binding: "b", language: "l", formatVersions: "[4.0.0,4.1.0)", driverVersion: "d", kitVersion: "k" }),
			records: threeRecords,
		};
		expect(summarize(report)).toEqual({ pass: 1, fail: 1, kitError: 0, skipped: 1 });
	});
});

describe("formatSummary", () => {
	test("formats the summary line", () => {
		const report = {
			...emptyReport({ binding: "b", language: "l", formatVersions: "[4.0.0,4.1.0)", driverVersion: "d", kitVersion: "k" }),
			records: threeRecords,
		};
		expect(formatSummary(report)).toBe("1 pass, 1 fail, 0 kit-error, 1 skipped");
	});
});

describe("writeReport", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const d of dirs.splice(0)) rmSync(d, { force: true, recursive: true });
	});

	test("round-trips a report through a temp file, creating parent directories", () => {
		const d = mkdtempSync(path.join(tmpdir(), "mck-report-"));
		dirs.push(d);
		const file = path.join(d, "nested", "out.json");
		const report = {
			...emptyReport({ binding: "b", language: "l", formatVersions: "[4.0.0,4.1.0)", driverVersion: "d", kitVersion: "k" }),
			records: threeRecords,
		};
		writeReport(report, file);
		const raw = readFileSync(file, "utf8");
		expect(raw.endsWith("\n")).toBe(true);
		expect(raw).toContain('\t"contractVersion": 1');
		const roundTripped = JSON.parse(raw) as Report;
		expect(summarize(roundTripped)).toEqual({ pass: 1, fail: 1, kitError: 0, skipped: 1 });
	});
});
