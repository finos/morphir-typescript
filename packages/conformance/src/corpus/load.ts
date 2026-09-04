//
// Loads a corpus directory: every top-level `*.md` except README.md, in name
// order. Cross-file checks (an id in two files) live here; per-file checks live
// in case.ts.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type CorpusCase, type CorpusError, parseCorpusFile } from "./case.ts";

export interface Corpus {
	readonly cases: readonly CorpusCase[];
	readonly errors: readonly CorpusError[];
	readonly files: readonly string[];
}

export async function loadCorpus(directory: string): Promise<Corpus> {
	const files = readdirSync(directory, { withFileTypes: true })
		.filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "README.md")
		.map((e) => path.join(directory, e.name))
		.sort();

	if (files.length === 0) {
		return { cases: [], errors: [{ file: directory, line: 0, message: `no corpus files (*.md) in ${directory}` }], files };
	}

	const cases: CorpusCase[] = [];
	const errors: CorpusError[] = [];
	const owner = new Map<string, string>();
	for (const file of files) {
		const parsed = parseCorpusFile(file, readFileSync(file, "utf8"));
		errors.push(...parsed.errors);
		for (const c of parsed.cases) {
			const first = owner.get(c.id);
			if (first !== undefined && first !== file) {
				errors.push({ file, line: c.line, message: `duplicate case id "${c.id}" across files (first in ${first})` });
			}
			owner.set(c.id, first ?? file);
			cases.push(c);
		}
	}
	return { cases, errors, files };
}
