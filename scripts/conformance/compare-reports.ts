// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Compares two mck reports (typically the in-process run and the run over
// the packaged adapter) and fails when they disagree on anything other than
// timing. `durationMs` and `startedAt` vary run to run even when nothing
// about the binding under test changed, so both are dropped before the
// comparison; every other field must match exactly, record for record.

import { readFile } from "node:fs/promises";

interface ComparableRecord {
	readonly [key: string]: unknown;
}

interface ComparableReport {
	readonly [key: string]: unknown;
	readonly records: readonly ComparableRecord[];
}

function withoutTiming<T extends ComparableRecord>(value: T): ComparableRecord {
	const { durationMs, ...rest } = value;
	void durationMs;
	return rest;
}

/** Strips the fields that legitimately vary between two runs of the same report: `startedAt` on the report, `durationMs` on every record. */
export function normalizeReport(report: ComparableReport): ComparableReport {
	const { startedAt, records, ...rest } = report;
	void startedAt;
	return { ...rest, records: records.map(withoutTiming) };
}

/**
 * Finds the first record where the two normalized reports disagree, comparing
 * position by position. Returns `undefined` when the reports match after
 * normalization, including when they have different record counts and every
 * shared position matches (the length mismatch itself is then the finding).
 */
export function firstDifference(
	left: ComparableReport,
	right: ComparableReport,
): { readonly index: number; readonly left: unknown; readonly right: unknown } | undefined {
	const a = normalizeReport(left);
	const b = normalizeReport(right);
	const length = Math.max(a.records.length, b.records.length);
	for (let index = 0; index < length; index++) {
		const l = a.records[index];
		const r = b.records[index];
		if (JSON.stringify(l) !== JSON.stringify(r)) return { index, left: l, right: r };
	}
	const { records: aRecords, ...aRest } = a;
	const { records: bRecords, ...bRest } = b;
	void aRecords;
	void bRecords;
	if (JSON.stringify(aRest) !== JSON.stringify(bRest)) return { index: -1, left: aRest, right: bRest };
	return undefined;
}

async function readReport(file: string): Promise<ComparableReport> {
	return JSON.parse(await readFile(file, "utf8")) as ComparableReport;
}

async function main(argv: readonly string[]): Promise<number> {
	const [leftFile, rightFile] = argv;
	if (leftFile === undefined || rightFile === undefined) {
		console.error("usage: compare-reports.ts <left-report.json> <right-report.json>");
		return 2;
	}
	const [left, right] = await Promise.all([readReport(leftFile), readReport(rightFile)]);
	const difference = firstDifference(left, right);
	if (difference === undefined) {
		console.log(`${leftFile} and ${rightFile} agree on ${left.records.length} record(s)`);
		return 0;
	}
	const where = difference.index === -1 ? "report header" : `record ${difference.index}`;
	console.error(`${leftFile} and ${rightFile} disagree at ${where}:`);
	console.error(`  ${leftFile}: ${JSON.stringify(difference.left)}`);
	console.error(`  ${rightFile}: ${JSON.stringify(difference.right)}`);
	return 1;
}

if (import.meta.main) {
	process.exit(await main(process.argv.slice(2)));
}
