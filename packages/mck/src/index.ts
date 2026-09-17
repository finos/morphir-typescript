// Public surface of @finos/morphir-mck. finos/morphir-typescript#1 exposes
// the case-file parser and report types; the driver and coverage script
// arrive in #6.

export { type CoverageGap, coverageGaps, formatGap } from "./coverage/coverage.ts";
export { checkCanonical, checkRejected, checkWarnings, normalizeCanonical, type RejectedCheck } from "./driver/compare.ts";
export { exitCodeFor, type RunOptions, runKit } from "./driver/run.ts";
export { driverVersion, kitVersion } from "./driver/version.ts";
export { type KitCase, type KitError, type KitFence, type ParsedFile, parseKitFile, topicOf } from "./kit/case.ts";
export { embeddedKitCommit, embeddedKitFiles } from "./kit/embedded-source.ts";
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
export {
	PACKAGE_CONTRACT,
	PACKAGE_OPERATIONS,
	type PackageCapabilities,
	type PackageLibrary,
	type PackageOperation,
	type PackageRequest,
	type PackageResponse,
	type PackageSchemas,
	type PackageTestee,
} from "./package/contract.ts";
export { loadPackageKit, loadPackageKitFromFiles, type PackageCase, type PackageKit } from "./package/corpus.ts";
export { processPackageTestee, processResolutionTestee } from "./package/process.ts";
export { parsePackageCapabilities, parsePackageRequest, parsePackageResponse } from "./package/protocol.ts";
export { canonicalizePackageDocument, packageFileDigest, referencePackageTestee, referenceResolutionTestee } from "./package/reference.ts";
export {
	RESOLUTION_CONTRACT,
	RESOLUTION_OPERATIONS,
	RESOLUTION_PROFILES,
	type ResolutionCapabilities,
	type ResolutionKit,
	type ResolutionOperation,
	type ResolutionProfile,
	type ResolutionRequest,
	type ResolutionResponse,
	type ResolutionTestee,
} from "./package/resolution/contract.ts";
export { loadResolutionKit, loadResolutionKitFromFiles } from "./package/resolution/corpus.ts";
export { ResolutionExecutionError, resolveLibrary } from "./package/resolution/index.ts";
export * from "./package/resolution/model.ts";
export * from "./package/resolution/order.ts";
export { parseResolutionInput, resolutionInputToWire } from "./package/resolution/parse.ts";
export { parseResolutionCapabilities, parseResolutionRequest, parseResolutionResponse, projectResolutionResult } from "./package/resolution/protocol.ts";
export { type InitialSearchResult, searchInitialLibrary } from "./package/resolution/search.ts";
export {
	type PackageContractRecord,
	type PackageContractReport,
	type PackageRecord,
	type PackageReport,
	packageExitCode,
	runPackageKit,
	runResolutionKit,
} from "./package/run.ts";
export {
	emptyReport,
	formatSummary,
	type Report,
	type ReportDiagnostic,
	type ReportProfile,
	type ReportRecord,
	type ReportResult,
	type ReportRole,
	type Summary,
	summarize,
	writeReport,
} from "./report.ts";
export { IN_PROCESS_CAPABILITIES, inProcessTestee, NODE_KINDS, resolveNode } from "./testee/in-process.ts";
export { type ProcessOptions, processTestee } from "./testee/process.ts";
export {
	ProtocolError,
	parseCapabilities,
	parseDecodeResponse,
	parseEnvelope,
	parseFormatVersions,
	parseRequest,
	parseWriteTreeResponse,
} from "./testee/protocol.ts";
export type {
	Capabilities,
	DecodeRequest,
	DecodeResponse,
	Envelope,
	Layout,
	PathMode,
	Profile,
	ProtocolDiagnostic,
	ReadTreeRequest,
	Request,
	Testee,
	TreeFile,
	Warning,
	WriteTreeRequest,
	WriteTreeResponse,
} from "./testee/testee.ts";
