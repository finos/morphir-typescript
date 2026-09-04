//
// Tests for the report skeleton builder. Run with: bun test src/report.test.ts
import { expect, test } from "bun:test";
import { type Report, emptyReport } from "./report.ts";

test("emptyReport is a valid report skeleton", () => {
	const report: Report = emptyReport({ binding: "morphir-typescript", language: "typescript", driverVersion: "0.0.0", kitVersion: "test" });
	expect(report.contractVersion).toBe(1);
	expect(report.records).toEqual([]);
	expect(() => new Date(report.startedAt).toISOString()).not.toThrow();
});
