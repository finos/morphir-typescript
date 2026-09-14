// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The run loop (spec S5.2). It never parses YAML and never looks inside a
// canonical: a Testee returns strings, and strings are compared. What a
// binding cannot do is a capabilities question, so a fence the binding
// declared no support for is skipped, never failed.
import type { KitCase, KitFence } from "../kit/case.ts";
import type { Kit } from "../kit/load.ts";
import { resolveTextFence } from "../kit/source.ts";
import { emptyReport, type Report, type ReportProfile, type ReportRecord, type ReportRole } from "../report.ts";
import { ProtocolError, parseCapabilities } from "../testee/protocol.ts";
import type { Capabilities, DecodeResponse, PathMode, Profile, Testee } from "../testee/testee.ts";
import { checkCanonical, checkRejected, checkWarnings, normalizeCanonical } from "./compare.ts";

export interface RunOptions {
	readonly strict: boolean;
	readonly only?: RegExp;
	readonly driverVersion: string;
	readonly kitVersion: string;
	readonly now?: () => number;
}

const CURRENT_VERSION = 4;
const KIT_ERROR_CASE = "kit-0000";

interface Target {
	readonly fence: KitFence;
	readonly role: ReportRole;
	readonly profile: ReportProfile;
	readonly body: string | null; // null: a text fence that could not be resolved (message carries why)
	readonly message: string | null;
}

// A fence's profile and body: the literal fence, or the file a text fence names.
function targetOf(kit: Kit, fence: KitFence): Target {
	if (fence.info.language !== "text") {
		return { fence, role: fence.info.role, profile: fence.info.role === "file" ? "tree" : fence.info.language, body: fence.body, message: null };
	}
	const r = resolveTextFence(kit, fence);
	return r.ok
		? { fence, role: fence.info.role, profile: r.profile, body: r.content, message: null }
		: { fence, role: fence.info.role, profile: "json", body: null, message: r.message };
}

export async function runKit(kit: Kit, testee: Testee, options: RunOptions): Promise<Report> {
	const now = options.now ?? (() => performance.now());
	let caps: Capabilities | null = null;
	let dead: string | null = null; // the protocol error that ended the conversation
	const records: ReportRecord[] = [];
	let header = { binding: "unknown", language: "unknown", driverVersion: options.driverVersion, kitVersion: options.kitVersion };
	try {
		caps = parseCapabilities(await testee.capabilities());
		header = { ...header, binding: caps.binding, language: caps.language };
	} catch (error) {
		dead = error instanceof Error ? error.message : String(error);
	}

	for (const e of kit.errors) {
		const owner = kit.cases.find((c) => c.file === e.file && c.line <= e.line);
		records.push({
			caseId: owner?.id ?? KIT_ERROR_CASE,
			irVersion: CURRENT_VERSION,
			profile: "json",
			role: "canonical",
			fenceIndex: 0,
			result: "kit-error",
			message: `${e.file}:${e.line}: ${e.message}`,
			durationMs: 0,
		});
	}

	for (const c of kit.cases) {
		if (options.only !== undefined && !options.only.test(c.id)) continue;
		const version = c.version ?? CURRENT_VERSION;
		const canonicals = new Map<ReportProfile, string>();
		const targets = c.fences.map((f) => targetOf(kit, f));
		for (const t of targets) if (t.role === "canonical" && t.body !== null) canonicals.set(t.profile, normalizeCanonical(t.body));
		const paths: readonly PathMode[] = caps?.paths ?? ["current"];
		for (const path of paths) {
			const perPath: ReportRecord[] = [];
			for (const t of targets) {
				const base = { caseId: c.id, irVersion: version, profile: t.profile, role: t.role, fenceIndex: t.fence.index, path };
				const started = now();
				const finish = (r: Omit<ReportRecord, keyof typeof base | "durationMs">): void => {
					perPath.push({ ...base, ...r, durationMs: Math.max(0, now() - started) });
				};
				if (c.status === "pending") {
					finish({ result: "skipped", message: "pending" });
					continue;
				}
				if (t.body === null) {
					finish({ result: "kit-error", message: t.message ?? "unresolved text fence" });
					continue;
				}
				if (dead !== null) {
					finish({ result: "kit-error", message: caps === null ? dead : `adapter unavailable: ${dead}` });
					continue;
				}
				const skip = unsupported(caps as Capabilities, version, t.profile, path);
				if (skip !== null) {
					finish({ result: "skipped", message: skip });
					continue;
				}
				try {
					if (t.role === "file") {
						// Tree layouts: readTree/writeTree are exercised only when a binding
						// declares "tree"; the TypeScript binding does so in plan 2c and the
						// comparison then follows S5.2 step 3, bullet 5.
						finish({ result: "skipped", message: "layout tree is declared but tree comparison arrives with plan 2c" });
						continue;
					}
					const response = await testee.decode({
						op: "decode",
						version,
						profile: t.profile as Profile,
						path,
						strip: c.compare !== "attributes",
						node: c.node ?? "",
						input: t.body,
					});
					if (t.role === "rejected") {
						const r = checkRejected(t.fence.info.keys, response);
						finish({
							result: r.result,
							...(r.expectedDiagnostic === undefined ? {} : { expectedDiagnostic: r.expectedDiagnostic }),
							...(r.observedDiagnostic === undefined ? {} : { observedDiagnostic: r.observedDiagnostic }),
							...(r.message === undefined ? {} : { message: r.message }),
						});
						continue;
					}
					finish(judgeAccepted(t, response, canonicals.get(t.profile)));
				} catch (error) {
					if (!(error instanceof ProtocolError)) throw error;
					dead = error.message;
					finish({ result: "kit-error", message: error.message });
				}
			}
			records.push(...perPath);
		}
		reconcilePaths(records, c, paths);
	}
	return { ...emptyReport(header), records };
}

function unsupported(caps: Capabilities, version: number, profile: ReportProfile, path: PathMode): string | null {
	if (!caps.versions.includes(version)) return `version ${version} not in capabilities`;
	if (profile === "tree") return caps.layouts.includes("tree") ? null : "layout tree not in capabilities";
	if (!caps.profiles.includes(profile)) return `profile ${profile} not in capabilities`;
	if (!caps.paths.includes(path)) return `path ${path} not in capabilities`;
	return null;
}

function judgeAccepted(
	t: Target,
	response: DecodeResponse,
	expected: string | undefined,
): Omit<ReportRecord, "caseId" | "irVersion" | "profile" | "role" | "fenceIndex" | "path" | "durationMs"> {
	if (!response.ok)
		return {
			result: "fail",
			observedDiagnostic: response.diagnostic,
			message: `${t.role} fence failed to decode: ${response.diagnostic.code} at ${response.diagnostic.cursor ?? "/"}: ${response.diagnostic.message ?? ""}`,
		};
	const warn = checkWarnings(t.fence.info.keys.warning, response.warnings);
	if (warn !== null) return { result: "fail", message: warn };
	const got = response.canonical[t.profile as Profile];
	if (got === undefined) return { result: "fail", message: `adapter returned no ${t.profile} canonical` };
	const want = expected ?? normalizeCanonical(t.body ?? "");
	const diff = checkCanonical(want, got);
	return diff === null ? { result: "pass" } : { result: "fail", message: diff };
}

// The two paths must agree fence by fence (S5.2 step 5).
function reconcilePaths(records: ReportRecord[], c: KitCase, paths: readonly PathMode[]): void {
	if (paths.length < 2) return;
	const mine = records.filter((r) => r.caseId === c.id);
	for (const f of c.fences) {
		const group = mine.filter((r) => r.fenceIndex === f.index);
		const signatures = new Set(group.map((r) => `${r.result}|${r.message ?? ""}|${r.observedDiagnostic?.code ?? ""}`));
		if (signatures.size <= 1) continue;
		for (const r of group) {
			const i = records.indexOf(r);
			records[i] = { ...r, result: "fail", message: `paths disagree: ${[...signatures].join(" vs ")}` };
		}
	}
}

export function exitCodeFor(report: Report, strict: boolean): 0 | 1 {
	for (const r of report.records) {
		if (r.result === "fail" || r.result === "kit-error") return 1;
		if (strict && r.result === "skipped") return 1;
	}
	return 0;
}
