// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Loads a kit: every top-level `*.md` of the kit directory except README.md,
// in name order. Cross-file checks (an id in two files) live here; per-file
// checks live in case.ts. The bytes come from a KitFiles source so the same
// loader serves a checkout and the embedded copy.
import { type KitCase, type KitError, parseKitFile } from "./case.ts";
import { KIT_PATH, type KitFiles, kitFilesFromDirectory } from "./source.ts";

export interface Kit {
	readonly cases: readonly KitCase[];
	readonly errors: readonly KitError[];
	readonly files: readonly string[];
	readonly source: KitFiles;
}

export async function loadKitFromFiles(source: KitFiles): Promise<Kit> {
	const files = source
		.list()
		.filter((p) => p.startsWith(`${KIT_PATH}/`) && !p.slice(KIT_PATH.length + 1).includes("/") && p.endsWith(".md") && !p.endsWith("/README.md"))
		.sort();
	if (files.length === 0) {
		return { cases: [], errors: [{ file: source.label, line: 0, message: `no MCK case files (*.md) in ${source.label}` }], files, source };
	}
	const cases: KitCase[] = [];
	const errors: KitError[] = [];
	const owner = new Map<string, string>();
	for (const file of files) {
		const parsed = parseKitFile(source.display(file), source.read(file) ?? "");
		errors.push(...parsed.errors);
		for (const c of parsed.cases) {
			const first = owner.get(c.id);
			if (first !== undefined && first !== c.file)
				errors.push({ file: c.file, line: c.line, message: `duplicate case id "${c.id}" across files (first in ${first})` });
			owner.set(c.id, first ?? c.file);
			cases.push(c);
		}
	}
	return { cases, errors, files, source };
}

export async function loadKit(directory: string, repositoryRoot?: string): Promise<Kit> {
	return loadKitFromFiles(kitFilesFromDirectory(directory, repositoryRoot));
}
