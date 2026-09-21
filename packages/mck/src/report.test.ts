// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { formatSummary, type ReportResult, summarize } from "./report.ts";

test("summarizes package report results", () => {
	const report = { records: (["pass", "pass", "fail", "kit-error", "skipped"] as ReportResult[]).map((result) => ({ result })) };
	expect(summarize(report)).toEqual({ pass: 2, fail: 1, kitError: 1, skipped: 1 });
	expect(formatSummary(report)).toBe("2 pass, 1 fail, 1 kit-error, 1 skipped");
	expect(formatSummary({ records: [] })).toBe("0 pass, 0 fail, 0 kit-error, 0 skipped");
});
