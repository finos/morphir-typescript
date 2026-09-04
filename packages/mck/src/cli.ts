#!/usr/bin/env bun
// Command-line entry for @finos/morphir-mck.
//
//   mck check <dir> [--json]
//
// Plan 1 ships `check` only: parse a kit directory and report structural
// errors. `run` (drive a binding) and `coverage` arrive in plan 2.
import path from "node:path";
import { loadKit } from "./kit/load.ts";

const USAGE = "usage: mck check <dir> [--json]";

async function main(argv: readonly string[]): Promise<number> {
	const [command, ...rest] = argv;
	if (command !== "check") {
		console.error(USAGE);
		return 2;
	}
	const json = rest.includes("--json");
	const dir = rest.find((a) => !a.startsWith("--"));
	if (dir === undefined) {
		console.error(USAGE);
		return 2;
	}
	const kit = await loadKit(path.resolve(dir));
	if (json) {
		console.log(JSON.stringify({
			files: kit.files,
			cases: kit.cases.map((c) => c.id),
			errors: kit.errors,
		}, null, "\t"));
		return kit.errors.length === 0 ? 0 : 1;
	}
	for (const e of kit.errors) console.error(`${e.file}:${e.line}: ${e.message}`);
	console.log(`${kit.cases.length} case(s) in ${kit.files.length} file(s), ${kit.errors.length} error(s)`);
	return kit.errors.length === 0 ? 0 : 1;
}

process.exit(await main(process.argv.slice(2)));
