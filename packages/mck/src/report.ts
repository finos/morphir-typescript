// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
// Shared package-report summaries. Native IR reports use the consolidated contract.
export type ReportResult = "pass" | "fail" | "kit-error" | "skipped";

export interface Summary {
	readonly pass: number;
	readonly fail: number;
	readonly kitError: number;
	readonly skipped: number;
}

type Summarizable = { readonly records: readonly { readonly result: ReportResult }[] };

export function summarize(report: Summarizable): Summary {
	let pass = 0;
	let fail = 0;
	let kitError = 0;
	let skipped = 0;
	for (const r of report.records) {
		if (r.result === "pass") pass += 1;
		else if (r.result === "fail") fail += 1;
		else if (r.result === "kit-error") kitError += 1;
		else skipped += 1;
	}
	return { pass, fail, kitError, skipped };
}

export function formatSummary(report: Summarizable): string {
	const s = summarize(report);
	return `${s.pass} pass, ${s.fail} fail, ${s.kitError} kit-error, ${s.skipped} skipped`;
}
