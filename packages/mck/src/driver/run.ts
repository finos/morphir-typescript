// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The run loop (kit README, "What the driver does with a case"). It never
// parses YAML and never looks inside a canonical: a Testee returns strings,
// and strings are compared. What a binding cannot do is a capabilities
// question, so a fence the binding declared no support for is skipped, never
// failed.
import type { KitCase, KitFence } from "../kit/case.ts";
import { setLabel, setOf } from "../kit/info-string.ts";
import type { Kit } from "../kit/load.ts";
import { resolveTextFence } from "../kit/source.ts";
import { emptyReport, type Report, type ReportProfile, type ReportRecord, type ReportRole } from "../report.ts";
import { ProtocolError, parseCapabilities } from "../testee/protocol.ts";
import type { Capabilities, DecodeResponse, PathMode, Profile, Testee, WriteTreeResponse } from "../testee/testee.ts";
import { checkCanonical, checkRejected, checkWarnings, normalizeCanonical, pathBudgetOf } from "./compare.ts";

export interface RunOptions {
	readonly strict: boolean;
	readonly only?: RegExp;
	readonly driverVersion: string;
	readonly kitVersion: string;
	readonly now?: () => number;
}

const CURRENT_VERSION = 4;
const KIT_ERROR_CASE = "kit-0000";
/** The logical path of a document tree's root file (document-tree page, "Distribution Manifest"); the budget is read from it. */
const MANIFEST = "manifest";

interface Target {
	readonly fence: KitFence;
	readonly role: ReportRole;
	readonly profile: ReportProfile;
	/**
	 * The serialization the fence is written in. For every role but `file` it is
	 * the same as `profile`; a `file` fence is judged as the tree layout
	 * (`profile: "tree"`) but still has to be read as json or yaml, and the set
	 * it belongs to sends that profile to the testee.
	 */
	readonly language: Profile;
	readonly body: string | null; // null: a text fence that could not be resolved (message carries why)
	readonly message: string | null;
}

/** What a comparison decides about one fence, before the record's identity is added. */
type Verdict = Omit<ReportRecord, "caseId" | "irVersion" | "profile" | "role" | "fenceIndex" | "path" | "durationMs">;

// A fence's profile and body: the literal fence, or the file a text fence
// names. A `file`-role fence is always the tree layout's, whether it embeds
// its content literally or (like a canonical/accepted text fence) names
// another file for it: the language token only ever picks the fence's own
// syntax, never its role in the comparison.
function targetOf(kit: Kit, fence: KitFence): Target {
	if (fence.info.role === "file") {
		if (fence.info.language !== "text") return { fence, role: "file", profile: "tree", language: fence.info.language, body: fence.body, message: null };
		const r = resolveTextFence(kit, fence);
		return r.ok
			? { fence, role: "file", profile: "tree", language: r.profile as Profile, body: r.content, message: null }
			: { fence, role: "file", profile: "tree", language: "json", body: null, message: r.message };
	}
	if (fence.info.language !== "text") {
		return { fence, role: fence.info.role, profile: fence.info.language, language: fence.info.language, body: fence.body, message: null };
	}
	const r = resolveTextFence(kit, fence);
	return r.ok
		? { fence, role: fence.info.role, profile: r.profile, language: r.profile as Profile, body: r.content, message: null }
		: { fence, role: fence.info.role, profile: "json", language: "json", body: null, message: r.message };
}

interface FileSet {
	readonly name: string;
	readonly targets: readonly Target[];
}

// A case's `file` fences, in the sets they declare. A set is the unit of the
// tree comparison: it is read as one tree and written back as one tree, so
// every fence in it shares one verdict for the read and one per-path verdict
// for the write. Fences that name no set share the anonymous one.
function fileSetsOf(targets: readonly Target[]): readonly FileSet[] {
	const byName = new Map<string, Target[]>();
	for (const t of targets) {
		if (t.role !== "file") continue;
		const name = setOf(t.fence.info);
		const list = byName.get(name);
		if (list === undefined) byName.set(name, [t]);
		else list.push(t);
	}
	return [...byName].map(([name, list]) => ({ name, targets: list }));
}

// The nearest case whose heading precedes the error, in the file the error
// belongs to; a file may hold several cases, so "the first case in the file"
// is wrong whenever the error is not inside the first one.
function ownerOf(cases: readonly KitCase[], file: string, line: number): KitCase | undefined {
	let owner: KitCase | undefined;
	for (const c of cases) {
		if (c.file !== file || c.line > line) continue;
		if (owner === undefined || c.line > owner.line) owner = c;
	}
	return owner;
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
		const owner = ownerOf(kit.cases, e.file, e.line);
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
		const targets = c.fences.map((f) => targetOf(kit, f));
		// The expectation every accepted fence and every file set of this case is
		// held to, normalized for comparison; the body is kept unnormalized beside
		// it because a tree write is fed the fence as the kit spells it.
		const canonicals = new Map<ReportProfile, string>();
		const canonicalBodies = new Map<ReportProfile, string>();
		for (const t of targets) {
			if (t.role !== "canonical" || t.body === null) continue;
			canonicals.set(t.profile, normalizeCanonical(t.body));
			canonicalBodies.set(t.profile, t.body);
		}
		const paths: readonly PathMode[] = caps?.paths ?? ["current"];
		// Kept per path, not folded into `records`, until path agreement (below)
		// has had its say: reconciliation must only ever touch what this case's
		// own fences produced for this case's own paths, never anything else
		// that happens to share its caseId (a kit-error record has no `path` and
		// must never be swept into a fence-index comparison).
		const byPath = new Map<PathMode, ReportRecord[]>();
		const sets = fileSetsOf(targets);
		for (const path of paths) {
			const perPath: ReportRecord[] = [];
			for (const t of targets) {
				if (t.role === "file") continue;
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
				const skip = unsupported(caps as Capabilities, version, t.profile, path, c.node);
				if (skip !== null) {
					finish({ result: "skipped", message: skip });
					continue;
				}
				try {
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
					finish(judgeAccepted(t, response, canonicals.get(t.profile), c.id));
				} catch (error) {
					if (!(error instanceof ProtocolError)) throw error;
					dead = error.message;
					finish({ result: "kit-error", message: error.message });
				}
			}
			for (const set of sets) {
				const started = now();
				let verdicts: ReadonlyMap<number, Verdict>;
				try {
					verdicts = await runFileSet({ set, kitCase: c, version, path, caps, dead, canonicals, canonicalBodies, testee });
				} catch (error) {
					if (!(error instanceof ProtocolError)) throw error;
					dead = error.message;
					verdicts = new Map(set.targets.map((t) => [t.fence.index, { result: "kit-error", message: error.message } as Verdict]));
				}
				const durationMs = Math.max(0, now() - started);
				for (const t of set.targets) {
					const verdict = verdicts.get(t.fence.index) ?? { result: "kit-error" as const, message: `set ${label(set)} produced no verdict` };
					perPath.push({ caseId: c.id, irVersion: version, profile: "tree", role: "file", fenceIndex: t.fence.index, path, ...verdict, durationMs });
				}
			}
			// Sets are judged after the single-document fences, so the records come
			// back in fence order rather than in the order the comparisons ran.
			perPath.sort((a, b) => a.fenceIndex - b.fenceIndex);
			byPath.set(path, perPath);
		}
		reconcilePaths(byPath, c, paths);
		for (const path of paths) records.push(...(byPath.get(path) ?? []));
	}
	return { ...emptyReport(header), records };
}

function label(set: FileSet): string {
	return setLabel(set.name);
}

function describeDiagnostic(d: { readonly code: string; readonly cursor?: string; readonly message?: string }): string {
	return `${d.code} at ${d.cursor ?? "/"}: ${d.message ?? ""}`;
}

interface FileSetRun {
	readonly set: FileSet;
	readonly kitCase: KitCase;
	readonly version: number;
	readonly path: PathMode;
	readonly caps: Capabilities | null;
	readonly dead: string | null;
	readonly canonicals: ReadonlyMap<ReportProfile, string>;
	readonly canonicalBodies: ReadonlyMap<ReportProfile, string>;
	readonly testee: Testee;
}

/**
 * The tree comparison (kit README, `mode=read` / file-set section) for one
 * set, on one path.
 *
 * The set is read as a tree and the canonical it produces is held to the case's
 * canonical fence of the set's own profile — the same expectation the
 * single-document fences of the case answer to, which is the whole point of the
 * layout being an alternative spelling rather than a second format. Unless the
 * set says `mode=read`, the same canonical is then written back out and every
 * file compared, byte for byte, with the fence that carries its path.
 *
 * Each fence of the set gets its own record, but a set has one read verdict, so
 * a read failure is reported identically on all of them; only the write half
 * can distinguish one fence from another.
 */
async function runFileSet(run: FileSetRun): Promise<ReadonlyMap<number, Verdict>> {
	const { set, kitCase: c, version, path, caps, dead, canonicals, canonicalBodies, testee } = run;
	const out = new Map<number, Verdict>();
	const all = (verdict: Verdict): ReadonlyMap<number, Verdict> => {
		for (const t of set.targets) out.set(t.fence.index, verdict);
		return out;
	};

	if (c.status === "pending") return all({ result: "skipped", message: "pending" });

	const unresolved = set.targets.find((t) => t.body === null);
	if (unresolved !== undefined) {
		all({ result: "kit-error", message: unresolved.message ?? "unresolved text fence" });
		for (const t of set.targets)
			if (t.body === null) out.set(t.fence.index, { result: "kit-error", message: `set ${label(set)}: ${t.message ?? "unresolved text fence"}` });
		return out;
	}
	if (caps === null || dead !== null)
		return all({ result: "kit-error", message: caps === null ? (dead ?? "no capabilities") : `adapter unavailable: ${dead}` });

	// What a binding cannot do is a capabilities question, so a set it declared
	// no support for is skipped before the kit's own rules are applied to it.
	const skip = unsupported(caps, version, "tree", path, c.node);
	if (skip !== null) return all({ result: "skipped", message: skip });

	const languages = new Set(set.targets.map((t) => t.language));
	if (languages.size > 1) return all({ result: "kit-error", message: `mixed profiles in set ${label(set)}` });
	const language = (set.targets[0] as Target).language;
	if (!caps.profiles.includes(language)) return all({ result: "skipped", message: `profile ${language} not in capabilities` });

	const manifest = set.targets.find((t) => t.fence.info.keys.path === MANIFEST);
	if (manifest === undefined) return all({ result: "kit-error", message: `set ${label(set)} has no manifest` });
	const pathBudget = pathBudgetOf(manifest.body as string);
	if (pathBudget === null) return all({ result: "kit-error", message: `set ${label(set)}: manifest has no readable pathBudget` });

	const expected = canonicals.get(language);
	const canonicalBody = canonicalBodies.get(language);
	if (expected === undefined || canonicalBody === undefined) return all({ result: "kit-error", message: `no canonical ${language} fence in ${c.id}` });

	const read = judgeTreeRead(
		set,
		language,
		await testee.readTree({
			op: "readTree",
			version,
			profile: language,
			path,
			strip: c.compare !== "attributes",
			node: c.node ?? "",
			files: set.targets.map((t) => ({ path: t.fence.info.keys.path as string, content: t.body as string })),
		}),
		expected,
	);
	// `mode=read` marks a set whose input a canonical writer never reproduces
	// (a reserved `$meta` member, say): only the read half is meaningful there.
	const writes =
		manifest.fence.info.keys.mode === "read"
			? new Map<number, string>()
			: judgeTreeWrite(
					set,
					manifest,
					await testee.writeTree({ op: "writeTree", version, path, policy: { profile: language, pathBudget }, input: canonicalBody }),
				);

	for (const t of set.targets) {
		const write = writes.get(t.fence.index);
		if (read.result !== "pass" && write !== undefined) out.set(t.fence.index, { ...read, message: `${read.message ?? ""}; ${write}` });
		else if (read.result !== "pass") out.set(t.fence.index, read);
		else if (write !== undefined) out.set(t.fence.index, { result: "fail", message: write });
		else out.set(t.fence.index, { result: "pass" });
	}
	return out;
}

function judgeTreeRead(set: FileSet, language: Profile, response: DecodeResponse, expected: string): Verdict {
	if (!response.ok)
		return {
			result: "fail",
			observedDiagnostic: response.diagnostic,
			message: `set ${label(set)} failed to readTree: ${describeDiagnostic(response.diagnostic)}`,
		};
	// The grammar gives `file` no `warning=` key, so a set is always held to
	// "no warnings", the way a canonical fence is.
	const warn = checkWarnings(undefined, response.warnings);
	if (warn !== null) return { result: "fail", message: `set ${label(set)}: ${warn}` };
	const got = response.canonical[language];
	if (got === undefined) return { result: "fail", message: `set ${label(set)}: adapter returned no ${language} canonical` };
	const diff = checkCanonical(expected, got);
	return diff === null ? { result: "pass" } : { result: "fail", message: `set ${label(set)} read back differently: ${diff}` };
}

/** The write half, as a message per failing fence index; an absent entry is a pass. */
function judgeTreeWrite(set: FileSet, manifest: Target, response: WriteTreeResponse): ReadonlyMap<number, string> {
	const out = new Map<number, string>();
	if (!response.ok) {
		for (const t of set.targets) out.set(t.fence.index, `set ${label(set)} failed to writeTree: ${describeDiagnostic(response.diagnostic)}`);
		return out;
	}
	const produced = new Map(response.files.map((f) => [f.path, f.content]));
	for (const t of set.targets) {
		const logical = t.fence.info.keys.path as string;
		const content = produced.get(logical);
		produced.delete(logical);
		if (content === undefined) out.set(t.fence.index, `writeTree did not produce ${logical}`);
		else {
			const diff = checkCanonical(t.body as string, content);
			if (diff !== null) out.set(t.fence.index, `writeTree wrote ${logical} differently: ${diff}`);
		}
	}
	// A file the set does not have is the set's problem as a whole, so it is
	// reported on the record of the fence that defines the set: its manifest.
	const extra = [...produced.keys()].sort().map((p) => `writeTree produced ${p}, which the set does not have`);
	if (extra.length > 0) {
		const existing = out.get(manifest.fence.index);
		out.set(manifest.fence.index, existing === undefined ? extra.join("; ") : `${existing}; ${extra.join("; ")}`);
	}
	return out;
}

function unsupported(caps: Capabilities, version: number, profile: ReportProfile, path: PathMode, node: string | null): string | null {
	if (node === null || !caps.nodes.includes(node)) return `node ${node ?? "unset"} not in capabilities`;
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
	caseId: string,
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
	let want: string;
	if (expected !== undefined) {
		want = expected;
	} else if (t.role === "canonical") {
		// A canonical fence with no sibling of its own profile compares against
		// itself: it is its own expectation.
		want = normalizeCanonical(t.body ?? "");
	} else {
		return { result: "kit-error", message: `no canonical ${t.profile} fence in ${caseId}` };
	}
	const diff = checkCanonical(want, got);
	return diff === null ? { result: "pass" } : { result: "fail", message: diff };
}

// The two paths must agree fence by fence (kit README, "What the driver does
// with a case"). Only this case's own per-path records are in scope, so a
// kit-error record sharing this caseId but no path is never touched.
function reconcilePaths(byPath: Map<PathMode, ReportRecord[]>, c: KitCase, paths: readonly PathMode[]): void {
	if (paths.length < 2) return;
	for (const f of c.fences) {
		const group = paths
			.map((path) => {
				const list = byPath.get(path);
				const index = list?.findIndex((r) => r.fenceIndex === f.index) ?? -1;
				return list !== undefined && index !== -1 ? { path, list, index } : null;
			})
			.filter((entry): entry is { path: PathMode; list: ReportRecord[]; index: number } => entry !== null);
		const signatures = new Set(group.map(({ list, index }) => signatureOf(list[index] as ReportRecord)));
		if (signatures.size <= 1) continue;
		for (const { list, index } of group) {
			const r = list[index] as ReportRecord;
			list[index] = { ...r, result: "fail", message: `paths disagree: ${[...signatures].join(" vs ")}` };
		}
	}
}

/**
 * What "the paths agree" means for one fence: the same verdict, reached for the
 * same stated reason.
 *
 * It compares the record's outcome rather than the canonical text the adapter
 * returned, which is equivalent here and cheaper. Every path runs the same
 * fence, so every path is adjudicated against the same expected string: a
 * canonical mismatch is already reported as `result: "fail"` with a `message`
 * that names the diff against that one expectation, so two paths whose
 * canonicals differ cannot both carry the same result-and-message pair. The
 * diagnostic code is included for the reject fences, where the message may be
 * absent and the code is the whole verdict.
 */
function signatureOf(r: ReportRecord): string {
	return `${r.result}|${r.message ?? ""}|${r.observedDiagnostic?.code ?? ""}`;
}

export function exitCodeFor(report: Report, strict: boolean): 0 | 1 {
	for (const r of report.records) {
		if (r.result === "fail" || r.result === "kit-error") return 1;
		if (strict && r.result === "skipped") return 1;
	}
	return 0;
}
