#!/usr/bin/env bun
// Command-line entry for @finos/morphir-mck.
//
//   mck check <dir> [--json]
//   mck kit sync <repository-root> [--force]
//   mck kit status [--remote]
//
// Plan 1 shipped `check`. Plan 2 adds `kit sync` (vendor the parent
// repository's kit into packages/mck/kit) and `kit status` (prove the
// vendored copy still matches kit.lock.json).
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { loadKit } from "./kit/load.ts";
import { kitStatus, readLock, syncKit } from "./kit/sync.ts";

const USAGE = "usage: mck check <dir> [--json]\n       mck kit sync <repository-root> [--force]\n       mck kit status [--remote]";
const KIT_USAGE = "usage: mck kit sync <repository-root> [--force]\n       mck kit status [--remote]";

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

async function runKit(rest: readonly string[]): Promise<number> {
	const [sub, ...rest2] = rest;
	if (sub === "sync") return runKitSync(rest2);
	if (sub === "status") return runKitStatus(rest2);
	console.error(KIT_USAGE);
	return 2;
}

async function main(argv: readonly string[]): Promise<number> {
	const [command, ...rest] = argv;
	if (command === "check") return runCheck(rest);
	if (command === "kit") return runKit(rest);
	console.error(USAGE);
	return 2;
}

process.exit(await main(process.argv.slice(2)));
