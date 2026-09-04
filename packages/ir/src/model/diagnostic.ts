//
// Diagnostics are values with a stable code, a processing stage, and a cursor
// into the document, per docs/spec/ir/format-version.md and the v4 semantic
// model page. Message text may change; codes never do.
export type DiagnosticStage = "syntax" | "normalization" | "semantic";

export type DiagnosticCode =
	| "invalid_json" | "duplicate_member" | "invalid_type" | "missing_member" | "unknown_member"
	| "unknown_node" | "ambiguous_shorthand" | "invalid_name" | "invalid_path" | "invalid_fqname"
	| "invalid_literal" | "invalid_access" | "invalid_distribution_shape"
	| "missing_format_version" | "duplicate_format_version" | "invalid_format_version_type"
	| "invalid_format_version_syntax" | "format_version_out_of_range"
	| "unsupported_format_version_major" | "unsupported_format_version_revision";

export interface Diagnostic {
	readonly code: DiagnosticCode;
	readonly stage: DiagnosticStage;
	readonly cursor: string;
	readonly message: string;
	readonly line: number | null;
	readonly column: number | null;
}

export function diagnostic(
	code: DiagnosticCode,
	stage: DiagnosticStage,
	cursor: string,
	message: string,
	location?: { readonly line: number; readonly column: number },
): Diagnostic {
	return { code, stage, cursor, message, line: location?.line ?? null, column: location?.column ?? null };
}
