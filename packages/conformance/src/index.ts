// Public surface of @finos/morphir-ir-conformance. Plan 1 exposes the corpus
// parser and report types; the driver and coverage script arrive in plan 2.
export { tokenize, type Block } from "./corpus/markdown.ts";
export { parseInfoString, isInfoError, type FenceInfo, type Language, type Role } from "./corpus/info-string.ts";
export { parseCorpusFile, topicOf, type CorpusCase, type CorpusFence, type CorpusError, type ParsedFile } from "./corpus/case.ts";
export { loadCorpus, type Corpus } from "./corpus/load.ts";
export { emptyReport, type Report, type ReportRecord, type ReportDiagnostic, type ReportResult, type ReportProfile, type ReportRole } from "./report.ts";
