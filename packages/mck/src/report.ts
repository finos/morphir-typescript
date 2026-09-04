//
// TypeScript mirror of spec/ir/mck/report.schema.json in finos/morphir.
// Keep the two in step: the schema is the contract other languages validate
// against; these types are what the driver writes.

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
	readonly driverVersion: string;
	readonly kitVersion: string;
	readonly startedAt: string;
	readonly records: readonly ReportRecord[];
}

export function emptyReport(header: Pick<Report, "binding" | "language" | "driverVersion" | "kitVersion">): Report {
	return { contractVersion: 1, ...header, startedAt: new Date().toISOString(), records: [] };
}
