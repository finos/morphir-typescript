// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Comparison rules (spec S5.2 step 4). A Testee answers with strings, never
// parsed structures, so the driver compares canonicals by string equality
// only, allowing exactly one trailing newline of slack; warnings and
// rejections are checked structurally against what the fence declared.
import type { ReportDiagnostic } from "../report.ts";
import type { DecodeResponse, ProtocolDiagnostic, Warning } from "../testee/testee.ts";

export function normalizeCanonical(s: string): string {
	if (s.endsWith("\r\n")) return s.slice(0, -2);
	if (s.endsWith("\n")) return s.slice(0, -1);
	return s;
}

// The tree comparison needs the set's path budget, and the driver may not
// parse either profile (S8): it reads the number lexically from the manifest
// fence with one expression that matches both spellings.
const PATH_BUDGET = /"pathBudget"\s*:\s*(\d+)|^\s*pathBudget\s*:\s*(\d+)\s*$/m;

export function pathBudgetOf(manifestText: string): number | null {
	const m = PATH_BUDGET.exec(manifestText);
	if (m === null) return null;
	const digits = m[1] ?? m[2];
	return digits === undefined ? null : Number.parseInt(digits, 10);
}

export function checkCanonical(expected: string, actual: string): string | null {
	const e = normalizeCanonical(expected).split("\n");
	const a = normalizeCanonical(actual).split("\n");
	const lines = Math.max(e.length, a.length);
	for (let i = 0; i < lines; i++) {
		const el = i < e.length ? e[i] : "<end>";
		const al = i < a.length ? a[i] : "<end>";
		if (el !== al) return `line ${i + 1} differs: expected ${el} got ${al}`;
	}
	return null;
}

export function checkWarnings(wanted: string | undefined, warnings: readonly Warning[]): string | null {
	if (wanted === undefined) {
		if (warnings.length === 0) return null;
		const w = warnings[0] as Warning;
		return `warned unexpectedly: ${w.code} at ${w.cursor}`;
	}
	if (warnings.length === 0) return `should have warned ${wanted} and nothing else (got nothing)`;
	const bad = warnings.find((w) => w.code !== wanted);
	if (bad !== undefined) return `should have warned ${wanted} and nothing else (got ${bad.code} at ${bad.cursor})`;
	return null;
}

export interface RejectedCheck {
	readonly result: "pass" | "fail";
	readonly expectedDiagnostic?: string;
	readonly observedDiagnostic?: ReportDiagnostic;
	readonly message?: string;
}

function toReportDiagnostic(d: ProtocolDiagnostic): ReportDiagnostic {
	const out: { code: string; stage?: "syntax" | "normalization" | "semantic"; cursor?: string; message?: string } = { code: d.code };
	if (d.stage !== undefined) out.stage = d.stage;
	if (d.cursor !== undefined) out.cursor = d.cursor;
	if (d.message !== undefined) out.message = d.message;
	return out;
}

function describe(d: ProtocolDiagnostic): string {
	return `${d.code} at ${d.cursor ?? "/"}: ${d.message ?? ""}`;
}

// A `rejected` fence names exactly one of `diagnostic=` (the expected
// diagnostic code) or `expect=` (the node kind, when the fence in fact
// decodes without error, e.g. a value that is well-formed but the wrong
// shape for the case being made).
export function checkRejected(keys: Readonly<Record<string, string>>, response: DecodeResponse): RejectedCheck {
	const diagnosticWanted = keys.diagnostic;
	if (diagnosticWanted !== undefined) {
		if (!response.ok) {
			const observedDiagnostic = toReportDiagnostic(response.diagnostic);
			if (response.diagnostic.code === diagnosticWanted) {
				return { result: "pass", expectedDiagnostic: diagnosticWanted, observedDiagnostic };
			}
			return {
				result: "fail",
				expectedDiagnostic: diagnosticWanted,
				observedDiagnostic,
				message: `expected ${diagnosticWanted}, got ${describe(response.diagnostic)}`,
			};
		}
		return {
			result: "fail",
			expectedDiagnostic: diagnosticWanted,
			message: `expected ${diagnosticWanted}, but the fence decoded as ${response.kind}`,
		};
	}

	const expectWanted = keys.expect;
	if (expectWanted !== undefined) {
		if (response.ok) {
			if (response.kind === expectWanted) return { result: "pass" };
			return { result: "fail", message: `expected a ${expectWanted}, decoded a ${response.kind}` };
		}
		return { result: "fail", message: `expected a ${expectWanted}, got ${describe(response.diagnostic)}` };
	}

	return { result: "fail", message: "rejected fence has neither diagnostic= nor expect=" };
}
