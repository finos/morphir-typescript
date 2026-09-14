// Public surface of @finos/morphir-mck. Plan 1 exposes the case-file parser
// and report types; the driver and coverage script arrive in plan 2.

export { type KitCase, type KitError, type KitFence, type ParsedFile, parseKitFile, topicOf } from "./kit/case.ts";
export { type FenceInfo, isInfoError, type Language, parseInfoString, type Role } from "./kit/info-string.ts";
export { type Kit, loadKit, loadKitFromFiles } from "./kit/load.ts";
export { type Block, tokenize } from "./kit/markdown.ts";
export {
	KIT_PATH,
	type KitFiles,
	kitFilesFromDirectory,
	kitFilesFromMap,
	profileOfPath,
	type ResolvedText,
	resolveTextFence,
	textFenceTarget,
} from "./kit/source.ts";
export { emptyReport, type Report, type ReportDiagnostic, type ReportProfile, type ReportRecord, type ReportResult, type ReportRole } from "./report.ts";
