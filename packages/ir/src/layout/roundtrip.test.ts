// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Single file ⇄ document tree ⇄ single file. A distribution written as a tree
// and read back is the same distribution, in either profile; a tree read into
// a distribution and written back is the same tree. The kit's `Distribution`
// cases and the published complete example are the corpus.
// Run with: bun test packages/ir/src/layout/roundtrip.test.ts
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { JSON_PROFILE, type ProfileCodec } from "../codec/profile.ts";
import { YAML_PROFILE } from "../codec/yaml/index.ts";
import type { IRFile } from "../model/index.ts";
import type { TA, VA } from "../versions/v4/attributes.ts";
import { json, yaml } from "../versions/v4/index.ts";
import { readTree } from "./read-tree.ts";
import { writeTree } from "./write-tree.ts";

const KIT_CASES = path.resolve(import.meta.dir, "../../../mck/kit/spec/ir/mck");
const COMPLETE_EXAMPLE = path.resolve(import.meta.dir, "../../../mck/kit/website/static/ir/examples/v4/complete-example.json");

// A case heading names its node; only the whole-document cases ("Distribution"
// in the kit's spelling) are distributions a tree can hold.
const HEADING = /^## ([a-z0-9-]+): .*\{node=Distribution\}\s*$/gm;
const JSON_CANONICAL = /^```json canonical\r?\n([\s\S]*?)^```$/m;

interface Case {
	readonly id: string;
	readonly file: IRFile<TA, VA>;
}

function distributionCases(): readonly Case[] {
	const out: Case[] = [];
	for (const name of readdirSync(KIT_CASES)
		.filter((n) => n.endsWith(".md"))
		.sort()) {
		const text = readFileSync(path.join(KIT_CASES, name), "utf8");
		HEADING.lastIndex = 0;
		for (const heading of text.matchAll(HEADING)) {
			const start = heading.index + heading[0].length;
			const after = text.indexOf("\n## ", start);
			const body = text.slice(start, after === -1 ? text.length : after);
			const fence = JSON_CANONICAL.exec(body);
			if (fence === null) continue;
			const r = json.read(fence[1] as string);
			if (!r.ok) throw new Error(`kit case ${heading[1]} does not read: ${r.error.code} ${r.error.message}`);
			out.push({ id: heading[1] as string, file: r.value });
		}
	}
	const complete = json.read(readFileSync(COMPLETE_EXAMPLE, "utf8"));
	if (!complete.ok) throw new Error(`the complete example does not read: ${complete.error.code}`);
	out.push({ id: "complete-example", file: complete.value });
	return out;
}

const CASES = distributionCases();

const PROFILES: readonly (readonly [string, ProfileCodec])[] = [
	["json", JSON_PROFILE],
	["yaml", YAML_PROFILE],
];

describe("a distribution written as a tree and read back is the same distribution", () => {
	// The kit's other two Distribution cases (document-tree-0004 and -0005) carry
	// only a YAML canonical; they are exercised from their `file` sets below.
	test("the corpus is every kit Distribution case with a JSON canonical, plus the complete example", () => {
		expect(CASES.map((c) => c.id)).toEqual([
			"distributions-0002",
			"distributions-0004",
			"distributions-0005",
			"distributions-0006",
			"distributions-0007",
			"complete-example",
		]);
	});

	for (const [name, profile] of PROFILES) {
		for (const c of CASES) {
			test(`${c.id} through a ${name} tree`, () => {
				const tree = writeTree(c.file, { profile, pathBudget: 4000 });
				expect(tree.ok).toBe(true);
				if (!tree.ok) return;
				const back = readTree(tree.value, profile);
				expect(back.ok).toBe(true);
				if (!back.ok) return;
				expect(back.value.value).toEqual(c.file);
			});
		}
	}
});

// -------------------------------------------------------- the other direction

const KIT_TEXT = readFileSync(path.join(KIT_CASES, "document-tree.md"), "utf8");
const FILE_FENCE = /^```yaml file path=(\S+) set=(\S+)\r?\n([\s\S]*?)^```$/gm;

function fileSet(set: string): Map<string, string> {
	const out = new Map<string, string>();
	FILE_FENCE.lastIndex = 0;
	for (const m of KIT_TEXT.matchAll(FILE_FENCE)) {
		if (m[2] === set) out.set(m[1] as string, m[3] as string);
	}
	return out;
}

describe("a tree read into a distribution and written back is the same tree", () => {
	// The `meta` set is not in this list on purpose: `$meta` is reserved and a
	// writer never emits one (decision 0014), so that set is deliberately not
	// reproduced.
	const sets: readonly (readonly [string, number])[] = [
		["escape", 4000],
		["truncate", 64],
	];

	for (const [set, pathBudget] of sets) {
		test(`the ${set} set survives readTree then writeTree`, () => {
			const files = fileSet(set);
			const read = readTree(files, YAML_PROFILE);
			expect(read.ok).toBe(true);
			if (!read.ok) return;
			const back = writeTree(read.value.value, { profile: YAML_PROFILE, pathBudget });
			expect(back.ok).toBe(true);
			if (!back.ok) return;
			expect(new Map(back.value)).toEqual(files);
		});
	}

	test("the meta set loses only its $meta members", () => {
		const read = readTree(fileSet("meta"), YAML_PROFILE);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const back = writeTree(read.value.value, { profile: YAML_PROFILE, pathBudget: 4000 });
		expect(back.ok).toBe(true);
		if (!back.ok) return;
		expect([...back.value.keys()]).toEqual([...fileSet("meta").keys()]);
		for (const text of back.value.values()) expect(text).not.toContain("$meta");
	});

	test("a tree and the single document it came from read to the same distribution", () => {
		const read = readTree(fileSet("escape"), YAML_PROFILE);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const single = yaml.write(read.value.value);
		const again = yaml.read(single);
		expect(again.ok).toBe(true);
		if (!again.ok) return;
		expect(again.value).toEqual(read.value.value);
	});
});
