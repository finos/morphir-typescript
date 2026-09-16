//
// TypeScript mirror of spec/ir/mck/report.schema.json in finos/morphir.
// Keep the two in step: the schema is the contract other languages validate
// against; these types are what the driver writes.
//
// Kit errors (a malformed case file) become records too, so a syntax mistake
// in the kit shows up in the same report as a binding's failures rather than
// aborting the run. A kit error is reported as a `kit-error` record under the
// case it falls inside, when the error's line is on or after that case's
// heading; otherwise (a fence before the first heading, or a case-less file)
// it is reported under the reserved caseId `kit-0000`, role `canonical`,
// fenceIndex 0, profile `json`, irVersion 4, with `message` set to
// `<file>:<line>: <message>`.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ReportResult = "pass" | "fail" | "kit-error" | "skipped";
export type ReportProfile = "json" | "yaml" | "tree";
export type ReportRole = "canonical" | "accepted" | "rejected" | "file";

export interface ReportDiagnostic {
	readonly code: string;
	readonly stage?: "syntax" | "normalization" | "semantic";
	readonly cursor?: string;
	readonly message?: string;
}

export interface ReportRecord {
	readonly caseId: string;
	readonly irVersion: number;
	readonly profile: ReportProfile;
	readonly role: ReportRole;
	readonly fenceIndex: number;
	readonly path?: "current" | "pinned";
	readonly result: ReportResult;
	readonly expectedDiagnostic?: string;
	readonly observedDiagnostic?: ReportDiagnostic;
	readonly message?: string;
	readonly durationMs: number;
}

export interface Report {
	readonly contractVersion: 1;
	readonly binding: string;
	readonly language: string;
	/**
	 * The support table the adapter declared in capabilities, canonical, or
	 * `unknown` when the adapter never answered capabilities at all.
	 */
	readonly formatVersions: string;
	readonly driverVersion: string;
	readonly kitVersion: string;
	readonly startedAt: string;
	readonly records: readonly ReportRecord[];
}

export function emptyReport(header: Pick<Report, "binding" | "language" | "formatVersions" | "driverVersion" | "kitVersion">): Report {
	return { contractVersion: 1, ...header, startedAt: new Date().toISOString(), records: [] };
}

export function writeReport(report: Report, file: string): void {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(report, null, "\t")}\n`);
}

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
