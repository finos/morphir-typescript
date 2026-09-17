// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Single file ⇄ document tree ⇄ single file. A distribution written as a tree
// and read back is the same distribution, in either profile; a tree read into
// a distribution and written back is the same tree. The kit's `Distribution`
// cases and the published complete example are the corpus.
// Run with: bun test packages/ir/src/layout/roundtrip.test.ts
import { describe, expect, test } from "bun:test";
import { JSON_PROFILE, type ProfileCodec } from "../codec/profile.ts";
import { YAML_PROFILE } from "../codec/yaml/index.ts";
import type { IRFile } from "../model/index.ts";
import type { TA, VA } from "../versions/v4/attributes.ts";
import { json, yaml } from "../versions/v4/index.ts";
import { completeExample, distributionCanonicals, fileSet } from "./kit-fixtures.test-helper.ts";
import { readTree } from "./read-tree.ts";
import { writeTree } from "./write-tree.ts";

interface Case {
	readonly id: string;
	readonly file: IRFile<TA, VA>;
}

function parsed(id: string, text: string): Case {
	const r = json.read(text);
	if (!r.ok) throw new Error(`${id} does not read: ${r.error.code} ${r.error.message}`);
	return { id, file: r.value };
}

const CASES: readonly Case[] = [...distributionCanonicals().map(([id, text]) => parsed(id, text)), parsed("complete-example", completeExample())];

const PROFILES: readonly (readonly [string, ProfileCodec])[] = [
	["json", JSON_PROFILE],
	["yaml", YAML_PROFILE],
];

describe("a distribution written as a tree and read back is the same distribution", () => {
	// document-tree-0004 and -0005 are the kit's other two Distribution cases;
	// they carry only a YAML canonical, so they are exercised from their `file`
	// sets below instead.
	test("the corpus is every kit Distribution case with a JSON canonical, plus the complete example", () => {
		expect(CASES.map((c) => c.id)).toEqual([
			"distributions-0002",
			"distributions-0004",
			"distributions-0005",
			"distributions-0006",
			"distributions-0007",
			"distributions-0010",
			"document-tree-0006",
			"document-tree-0007",
			"document-tree-0008",
			"document-tree-0009",
			"versions-0004",
			"versions-0005",
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
