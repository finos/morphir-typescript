#!/usr/bin/env bun
// Command-line entry for @finos/morphir-ir-conformance.
//
//   morphir-conformance check <dir> [--json]
//
// Plan 1 ships `check` only: parse a corpus directory and report structural
// errors. `run` (drive a binding) and `coverage` arrive in plan 2.
import path from "node:path";
import { loadCorpus } from "./corpus/load.ts";

const USAGE = "usage: morphir-conformance check <dir> [--json]";

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
	const corpus = await loadCorpus(path.resolve(dir));
	if (json) {
		console.log(JSON.stringify({
			files: corpus.files,
			cases: corpus.cases.map((c) => c.id),
			errors: corpus.errors,
		}, null, "\t"));
		return corpus.errors.length === 0 ? 0 : 1;
	}
	for (const e of corpus.errors) console.error(`${e.file}:${e.line}: ${e.message}`);
	console.log(`${corpus.cases.length} case(s) in ${corpus.files.length} file(s), ${corpus.errors.length} error(s)`);
	return corpus.errors.length === 0 ? 0 : 1;
}

process.exit(await main(process.argv.slice(2)));
