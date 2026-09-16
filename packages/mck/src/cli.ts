#!/usr/bin/env node
// Command-line entry for @finos/morphir-mck.
//
//   mck check <dir> [--json]
//   mck kit sync <repository-root> [--force]
//   mck kit status [--remote]
//   mck run [--kit <dir>] [--repo-root <dir>] [--adapter <exe> [--adapter-arg <arg>]...] [--report <file>] [--strict] [--only <regex>] [--timeout <ms>]
//   mck coverage [--kit <dir>] [--repo-root <dir>]
//   mck --version
//
// finos/morphir-typescript#1 shipped `check`. #6 adds `kit sync` (vendor the
// parent repository's kit into packages/mck/kit) and `kit status` (prove the
// vendored copy still matches kit.lock.json), plus `run`, the driver
// itself, over the in-process TypeScript binding by default, or over
// `--adapter <exe>` (a child process speaking the JSON-lines protocol) when
// given; and `coverage` (see the kit README's coverage description), which
// reports every v4 vocabulary entry (a variant or a member spelling) that no
// kit case exercises.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VOCABULARY } from "../../ir/src/versions/v4/index.ts";
import { coverageGaps, formatGap } from "./coverage/coverage.ts";
import { runKit as driveKit, exitCodeFor } from "./driver/run.ts";
import { driverVersion, kitVersion } from "./driver/version.ts";
import { embeddedKitCommit, embeddedKitFiles } from "./kit/embedded-source.ts";
import { loadKit, loadKitFromFiles } from "./kit/load.ts";
import { kitStatus, readLock, syncKit } from "./kit/sync.ts";
import { formatSummary, writeReport } from "./report.ts";
import { inProcessTestee, resolveNode } from "./testee/in-process.ts";
import { processTestee } from "./testee/process.ts";

const USAGE =
	"usage: mck check <dir> [--json]\n       mck kit sync <repository-root> [--force]\n       mck kit status [--remote]\n       mck run [--kit <dir>] [--repo-root <dir>] [--adapter <exe> [--adapter-arg <arg>]...] [--report <file>] [--strict] [--only <regex>] [--timeout <ms>]\n       mck coverage [--kit <dir>] [--repo-root <dir>]\n       mck --version";
const KIT_USAGE = "usage: mck kit sync <repository-root> [--force]\n       mck kit status [--remote]";
const RUN_USAGE =
	"usage: mck run [--kit <dir>] [--repo-root <dir>] [--adapter <exe> [--adapter-arg <arg>]...] [--report <file>] [--strict] [--only <regex>] [--timeout <ms>]";
const COVERAGE_USAGE = "usage: mck coverage [--kit <dir>] [--repo-root <dir>]";

function packageRoot(): string {
	// `import.meta.dirname` only exists from Node 20.11; `engines.node` is `>=20`.
	return process.env.MCK_PACKAGE_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

async function runCheck(rest: readonly string[]): Promise<number> {
	const json = rest.includes("--json");
	const dir = rest.find((a) => !a.startsWith("--"));
	if (dir === undefined) {
		console.error(USAGE);
		return 2;
	}
	const kit = await loadKit(path.resolve(dir));
	if (json) {
		console.log(
			JSON.stringify(
				{
					files: kit.files,
					cases: kit.cases.map((c) => c.id),
					errors: kit.errors,
				},
				null,
				"\t",
			),
		);
		return kit.errors.length === 0 ? 0 : 1;
	}
	for (const e of kit.errors) console.error(`${e.file}:${e.line}: ${e.message}`);
	console.log(`${kit.cases.length} case(s) in ${kit.files.length} file(s), ${kit.errors.length} error(s)`);
	return kit.errors.length === 0 ? 0 : 1;
}

/**
 * True when the package root holds no `kit.lock.json`. `bun build --compile`
 * bundles the sources under a virtual root (`B:/~BUN`) that contains only the
 * modules it bundled, so `kit.lock.json` and the `kit/` tree are not there: a
 * compiled binary carries the kit through `kit/embedded.ts` instead. The `kit`
 * subcommands read both, so they report the embedded kit rather than failing
 * with ENOENT on a path inside the virtual root.
 */
function compiledWithoutCheckout(): boolean {
	return !existsSync(path.join(packageRoot(), "kit.lock.json"));
}

async function runKitSync(rest: readonly string[]): Promise<number> {
	if (compiledWithoutCheckout()) {
		console.error(`error: kit sync needs a source checkout of @finos/morphir-mck; this binary embeds the kit at finos/morphir ${embeddedKitCommit()}`);
		return 2;
	}
	const force = rest.includes("--force");
	const repositoryRoot = rest.find((a) => !a.startsWith("--"));
	if (repositoryRoot === undefined) {
		console.error(KIT_USAGE);
		return 2;
	}
	const lock = await syncKit(packageRoot(), path.resolve(repositoryRoot), { force });
	console.log(`kit synced to ${lock.commit} (${countSyncedFiles(packageRoot())} files, ${lock.contentHash})`);
	return 0;
}

function countSyncedFiles(root: string): number {
	let count = 0;
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			const p = path.join(dir, entry);
			if (entry === "embedded.ts") continue;
			if (statSync(p).isDirectory()) walk(p);
			else count += 1;
		}
	};
	walk(path.join(root, "kit"));
	return count;
}

function runKitStatus(rest: readonly string[]): number {
	const root = packageRoot();
	let commit: string;
	let code: number;
	if (compiledWithoutCheckout()) {
		commit = embeddedKitCommit();
		console.log(`embedded kit: finos/morphir ${commit} (compiled binary; lock file not available)`);
		code = 0;
	} else {
		const status = kitStatus(root);
		commit = readLock(root).commit;
		if (status.ok) {
			console.log(`kit matches kit.lock.json (${commit})`);
		} else {
			console.error(`kit differs from kit.lock.json: expected ${status.expected} actual ${status.actual}`);
		}
		code = status.ok ? 0 : 1;
	}
	if (rest.includes("--remote")) {
		try {
			const out = execFileSync("git", ["ls-remote", "https://github.com/finos/morphir", "refs/heads/main"], { encoding: "utf8" }).trim();
			const remote = out.split(/\s+/)[0] ?? "";
			const relation = remote === commit ? "same as" : "behind";
			console.log(`pinned ${commit} is ${relation} origin/main ${remote}`);
		} catch (error) {
			console.error(`could not reach origin/main: ${(error as Error).message}`);
		}
	}
	return code;
}

async function runKitCommand(rest: readonly string[]): Promise<number> {
	const [sub, ...rest2] = rest;
	try {
		if (sub === "sync") return await runKitSync(rest2);
		if (sub === "status") return runKitStatus(rest2);
	} catch (error) {
		console.error(`error: ${(error as Error).message}`);
		return 1;
	}
	console.error(KIT_USAGE);
	return 2;
}

// When `--kit` names a checkout's spec/ir/mck, the repository root three
// levels up is the natural default for resolving `text` fences that name
// other repository files (e.g. website/static/ir/examples/...).
function inferredRoot(kitDirectory: string): string | undefined {
	const normalized = kitDirectory.split(path.sep).join("/");
	return normalized.endsWith("spec/ir/mck") ? path.resolve(kitDirectory, "..", "..", "..") : undefined;
}

// The [--kit <dir>] [--repo-root <dir>] pair is shared by `run` and
// `coverage`; both resolve the same way (embedded kit by default, a checkout
// otherwise, with the repository root inferred from a spec/ir/mck path).
interface KitArgs {
	readonly kit?: string;
	readonly repoRoot?: string;
}

type ParsedKitArgs = { readonly ok: true; readonly args: KitArgs } | { readonly ok: false };

function parseKitArgs(rest: readonly string[]): ParsedKitArgs {
	let kit: string | undefined;
	let repoRoot: string | undefined;
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "--kit" || arg === "--repo-root") {
			const value = rest[++i];
			if (value === undefined) return { ok: false };
			if (arg === "--kit") kit = value;
			else repoRoot = value;
		} else {
			return { ok: false };
		}
	}
	return { ok: true, args: { kit, repoRoot } };
}

async function loadKitFor(args: KitArgs): ReturnType<typeof loadKit> {
	return args.kit === undefined
		? loadKitFromFiles(embeddedKitFiles())
		: loadKit(path.resolve(args.kit), args.repoRoot === undefined ? inferredRoot(path.resolve(args.kit)) : path.resolve(args.repoRoot));
}

async function runCoverage(rest: readonly string[]): Promise<number> {
	const parsed = parseKitArgs(rest);
	if (!parsed.ok) {
		console.error(COVERAGE_USAGE);
		return 2;
	}
	const kit = await loadKitFor(parsed.args);
	const gaps = coverageGaps(kit, VOCABULARY, resolveNode);
	if (gaps.length === 0) {
		console.log("coverage: every vocabulary entry has a case");
		return 0;
	}
	for (const g of gaps) console.log(formatGap(g));
	return 1;
}

const DEFAULT_TIMEOUT_MS = 30000;

interface RunArgs {
	readonly kit?: string;
	readonly repoRoot?: string;
	readonly adapter?: string;
	readonly adapterArgs: readonly string[];
	readonly report?: string;
	readonly strict: boolean;
	readonly only?: RegExp;
	readonly timeoutMs: number;
}

type ParsedRunArgs = { readonly ok: true; readonly args: RunArgs } | { readonly ok: false; readonly message?: string };

function parseRunArgs(rest: readonly string[]): ParsedRunArgs {
	let kit: string | undefined;
	let repoRoot: string | undefined;
	let adapter: string | undefined;
	const adapterArgs: string[] = [];
	let report: string | undefined;
	let strict = false;
	let only: RegExp | undefined;
	let timeoutMs = DEFAULT_TIMEOUT_MS;
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		// Every flag below takes an operand; a flag at the end of argv with
		// nothing after it is a usage error, not a silently-undefined value.
		if (
			arg === "--kit" ||
			arg === "--repo-root" ||
			arg === "--adapter" ||
			arg === "--adapter-arg" ||
			arg === "--report" ||
			arg === "--only" ||
			arg === "--timeout"
		) {
			const value = rest[++i];
			if (value === undefined) return { ok: false };
			if (arg === "--kit") kit = value;
			else if (arg === "--repo-root") repoRoot = value;
			else if (arg === "--adapter") adapter = value;
			else if (arg === "--adapter-arg") adapterArgs.push(value);
			else if (arg === "--report") report = value;
			else if (arg === "--only") {
				try {
					only = new RegExp(value);
				} catch (error) {
					return { ok: false, message: `invalid --only regex: ${(error as Error).message}` };
				}
			} else if (arg === "--timeout") {
				const ms = Number(value);
				if (!Number.isFinite(ms) || ms <= 0) return { ok: false, message: `invalid --timeout: ${value}` };
				timeoutMs = ms;
			}
		} else if (arg === "--strict") {
			strict = true;
		} else {
			return { ok: false };
		}
	}
	return { ok: true, args: { kit, repoRoot, adapter, adapterArgs, report, strict, only, timeoutMs } };
}

async function runRun(rest: readonly string[]): Promise<number> {
	const parsed = parseRunArgs(rest);
	if (!parsed.ok) {
		console.error(RUN_USAGE);
		if (parsed.message !== undefined) console.error(`error: ${parsed.message}`);
		return 2;
	}
	const args = parsed.args;
	const kit =
		args.kit === undefined
			? await loadKitFromFiles(embeddedKitFiles())
			: await loadKit(path.resolve(args.kit), args.repoRoot === undefined ? inferredRoot(path.resolve(args.kit)) : path.resolve(args.repoRoot));
	const kv = args.kit === undefined ? kitVersion(null) : kitVersion(path.resolve(args.kit));
	const testee = args.adapter === undefined ? inProcessTestee() : processTestee([args.adapter, ...args.adapterArgs], { timeoutMs: args.timeoutMs });
	try {
		const report = await driveKit(kit, testee, { strict: args.strict, only: args.only, driverVersion: driverVersion(), kitVersion: kv });
		if (args.report !== undefined) writeReport(report, path.resolve(args.report));
		console.log(formatSummary(report));
		for (const r of report.records) {
			if (r.result === "pass") continue;
			const pathSuffix = r.path === undefined ? "" : ` [${r.path}]`;
			console.log(`${r.result} ${r.caseId} fence ${r.fenceIndex}${pathSuffix}: ${r.message ?? ""}`);
		}
		return exitCodeFor(report, args.strict);
	} finally {
		await testee.close();
	}
}

async function main(argv: readonly string[]): Promise<number> {
	const [command, ...rest] = argv;
	if (command === "--version") {
		console.log(driverVersion());
		return 0;
	}
	if (command === "check") {
		try {
			return await runCheck(rest);
		} catch (error) {
			console.error(`error: ${(error as Error).message}`);
			return 1;
		}
	}
	if (command === "kit") return runKitCommand(rest);
	if (command === "run") {
		try {
			return await runRun(rest);
		} catch (error) {
			console.error(`error: ${(error as Error).message}`);
			return 1;
		}
	}
	if (command === "coverage") {
		try {
			return await runCoverage(rest);
		} catch (error) {
			console.error(`error: ${(error as Error).message}`);
			return 1;
		}
	}
	console.error(USAGE);
	return 2;
}

process.exit(await main(process.argv.slice(2)));
