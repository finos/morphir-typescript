// Public surface of @finos/morphir-mck. Plan 1 exposes the case-file parser
// and report types; the driver and coverage script arrive in plan 2.
export { tokenize, type Block } from "./kit/markdown.ts";
export { parseInfoString, isInfoError, type FenceInfo, type Language, type Role } from "./kit/info-string.ts";
export { parseKitFile, topicOf, type KitCase, type KitFence, type KitError, type ParsedFile } from "./kit/case.ts";
export { loadKit, type Kit } from "./kit/load.ts";
export { emptyReport, type Report, type ReportRecord, type ReportDiagnostic, type ReportResult, type ReportProfile, type ReportRole } from "./report.ts";
