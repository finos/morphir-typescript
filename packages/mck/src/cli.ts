#!/usr/bin/env bun
// Command-line entry for @finos/morphir-mck.
//
//   mck check <dir> [--json]
//   mck kit sync <repository-root> [--force]
//   mck kit status [--remote]
//   mck run [--kit <dir>] [--repo-root <dir>] [--adapter <exe> [--adapter-arg <arg>]...] [--report <file>] [--strict] [--only <regex>] [--timeout <ms>]
//   mck --version
//
// Plan 1 shipped `check`. Plan 2 adds `kit sync` (vendor the parent
// repository's kit into packages/mck/kit) and `kit status` (prove the
// vendored copy still matches kit.lock.json). Plan 2b adds `run`, the driver
// itself, over the in-process TypeScript binding by default, or over
// `--adapter <exe>` (a child process speaking the JSON-lines protocol) when
// given.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { runKit as driveKit, exitCodeFor } from "./driver/run.ts";
import { driverVersion, kitVersion } from "./driver/version.ts";
import { embeddedKitFiles } from "./kit/embedded-source.ts";
import { loadKit, loadKitFromFiles } from "./kit/load.ts";
import { kitStatus, readLock, syncKit } from "./kit/sync.ts";
import { formatSummary, writeReport } from "./report.ts";
import { inProcessTestee } from "./testee/in-process.ts";
import { processTestee } from "./testee/process.ts";

const USAGE =
	"usage: mck check <dir> [--json]\n       mck kit sync <repository-root> [--force]\n       mck kit status [--remote]\n       mck run [--kit <dir>] [--repo-root <dir>] [--adapter <exe> [--adapter-arg <arg>]...] [--report <file>] [--strict] [--only <regex>] [--timeout <ms>]\n       mck --version";
const KIT_USAGE = "usage: mck kit sync <repository-root> [--force]\n       mck kit status [--remote]";
const RUN_USAGE =
	"usage: mck run [--kit <dir>] [--repo-root <dir>] [--adapter <exe> [--adapter-arg <arg>]...] [--report <file>] [--strict] [--only <regex>] [--timeout <ms>]";

function packageRoot(): string {
	return process.env.MCK_PACKAGE_ROOT ?? path.resolve(import.meta.dirname, "..");
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

async function runKitSync(rest: readonly string[]): Promise<number> {
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
	const status = kitStatus(root);
	const lock = readLock(root);
	if (status.ok) {
		console.log(`kit matches kit.lock.json (${lock.commit})`);
	} else {
		console.error(`kit differs from kit.lock.json: expected ${status.expected} actual ${status.actual}`);
	}
	if (rest.includes("--remote")) {
		try {
			const out = execFileSync("git", ["ls-remote", "https://github.com/finos/morphir", "refs/heads/main"], { encoding: "utf8" }).trim();
			const remote = out.split(/\s+/)[0] ?? "";
			const relation = remote === lock.commit ? "same as" : "behind";
			console.log(`pinned ${lock.commit} is ${relation} origin/main ${remote}`);
		} catch (error) {
			console.error(`could not reach origin/main: ${(error as Error).message}`);
		}
	}
	return status.ok ? 0 : 1;
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
	if (command === "check") return runCheck(rest);
	if (command === "kit") return runKitCommand(rest);
	if (command === "run") {
		try {
			return await runRun(rest);
		} catch (error) {
			console.error(`error: ${(error as Error).message}`);
			return 1;
		}
	}
	console.error(USAGE);
	return 2;
}

process.exit(await main(process.argv.slice(2)));
