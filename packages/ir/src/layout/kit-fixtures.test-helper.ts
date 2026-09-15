// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Reading the compatibility kit's fences from the layout tests.
//
// The kit is markdown, and the layout tests need three things out of it: the
// `file` fences of one set, the canonical document a set must read to, and the
// whole-document cases a tree round trip runs over. Extracting them here keeps
// one copy of the fence grammar instead of one per test file, and the tests
// read the vendored kit by relative path rather than importing anything from
// `packages/mck`.
//
// Not a package source file: it uses `node:fs`, and `tsconfig.build.json`
// excludes `*.test-helper.ts` alongside `*.test.ts` so it never reaches `dist`.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const KIT_CASES = path.resolve(import.meta.dir, "../../../mck/kit/spec/ir/mck");

/** The published complete example, the one distribution the kit keeps as a file. */
export const COMPLETE_EXAMPLE = path.resolve(import.meta.dir, "../../../mck/kit/website/static/ir/examples/v4/complete-example.json");

const DOCUMENT_TREE = path.join(KIT_CASES, "document-tree.md");
const DOCUMENT_TREE_TEXT = readFileSync(DOCUMENT_TREE, "utf8");

const FILE_FENCE = /^```yaml file path=(\S+) set=(\S+)\r?\n([\s\S]*?)^```$/gm;

/** The `file` fences of one set of `document-tree.md`, as the map readTree takes. */
export function fileSet(set: string): Map<string, string> {
	const out = new Map<string, string>();
	FILE_FENCE.lastIndex = 0;
	for (const m of DOCUMENT_TREE_TEXT.matchAll(FILE_FENCE)) {
		if (m[2] === set) out.set(m[1] as string, m[3] as string);
	}
	return out;
}

function caseBody(text: string, start: number): string {
	const after = text.indexOf("\n## ", start + 1);
	return text.slice(start, after === -1 ? text.length : after);
}

/** The `yaml canonical` fence of one `document-tree.md` case. */
export function canonicalYaml(id: string): string {
	const body = caseBody(DOCUMENT_TREE_TEXT, DOCUMENT_TREE_TEXT.indexOf(`## ${id}:`));
	const m = /^```yaml canonical\r?\n([\s\S]*?)^```$/m.exec(body);
	if (m === null) throw new Error(`no yaml canonical fence in ${id}`);
	return m[1] as string;
}

// A case heading names its node; only the whole-document cases ("Distribution"
// in the kit's spelling) are distributions a tree can hold.
const DISTRIBUTION_HEADING = /^## ([a-z0-9-]+): .*\{node=Distribution\}\s*$/gm;
const JSON_CANONICAL = /^```json canonical\r?\n([\s\S]*?)^```$/m;

/** Every kit case whose node is a whole distribution and which has a JSON canonical. */
export function distributionCanonicals(): readonly (readonly [string, string])[] {
	const out: (readonly [string, string])[] = [];
	for (const name of readdirSync(KIT_CASES)
		.filter((n) => n.endsWith(".md"))
		.sort()) {
		const text = readFileSync(path.join(KIT_CASES, name), "utf8");
		DISTRIBUTION_HEADING.lastIndex = 0;
		for (const heading of text.matchAll(DISTRIBUTION_HEADING)) {
			const fence = JSON_CANONICAL.exec(caseBody(text, heading.index + heading[0].length));
			if (fence !== null) out.push([heading[1] as string, fence[1] as string] as const);
		}
	}
	return out;
}

/** The complete example's text, read from the vendored kit. */
export function completeExample(): string {
	return readFileSync(COMPLETE_EXAMPLE, "utf8");
}
