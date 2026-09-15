// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for reading a document tree (S7.2): the kit's three `file` sets read
// to the same IRFile as the case's canonical document, and each shape error
// the tree can carry is reported with the logical path on its cursor.
// Run with: bun test packages/ir/src/layout/read-tree.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { YAML_PROFILE } from "../codec/yaml/index.ts";
import { yaml } from "../versions/v4/index.ts";
import { readTree } from "./read-tree.ts";

// ------------------------------------------------------------- the kit text

const KIT = path.resolve(import.meta.dir, "../../../mck/kit/spec/ir/mck/document-tree.md");
const KIT_TEXT = readFileSync(KIT, "utf8");

const FILE_FENCE = /^```yaml file path=(\S+) set=(\S+)\r?\n([\s\S]*?)^```$/gm;

/** The `file` fences of one set, as the map readTree takes. */
function fileSet(set: string): Map<string, string> {
	const out = new Map<string, string>();
	FILE_FENCE.lastIndex = 0;
	for (const m of KIT_TEXT.matchAll(FILE_FENCE)) {
		if (m[2] === set) out.set(m[1] as string, m[3] as string);
	}
	return out;
}

/** The `yaml canonical` fence of one case, which the set must read to. */
function canonicalYaml(id: string): string {
	const start = KIT_TEXT.indexOf(`## ${id}:`);
	const after = KIT_TEXT.indexOf("\n## ", start + 1);
	const body = KIT_TEXT.slice(start, after === -1 ? KIT_TEXT.length : after);
	const m = /^```yaml canonical\r?\n([\s\S]*?)^```$/m.exec(body);
	if (m === null) throw new Error(`no yaml canonical fence in ${id}`);
	return m[1] as string;
}

function expectIRFile(text: string) {
	const r = yaml.read(text);
	if (!r.ok) throw new Error(`the kit's canonical does not read: ${r.error.code} ${r.error.message}`);
	return r.value;
}

function read(files: ReadonlyMap<string, string>) {
	return readTree(files, YAML_PROFILE);
}

function errorOf(files: ReadonlyMap<string, string>) {
	const r = read(files);
	if (r.ok) throw new Error("expected the tree to be rejected");
	return r.error;
}

// ----------------------------------------------------------- the kit's sets

describe("readTree over the kit's file sets", () => {
	const cases: readonly (readonly [string, string])[] = [
		["escape", "document-tree-0003"],
		["truncate", "document-tree-0004"],
		["meta", "document-tree-0005"],
	];

	for (const [set, id] of cases) {
		test(`the ${set} set reads to ${id}'s distribution`, () => {
			const files = fileSet(set);
			expect(files.size).toBeGreaterThan(1);
			const r = read(files);
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			expect(r.value.value).toEqual(expectIRFile(canonicalYaml(id)));
			expect(r.value.warnings).toEqual([]);
		});
	}
});

// ------------------------------------------------------------- error rows

const MODULE = "pkg/my-org/my-project/domain/module";
const TYPE_FILE = "pkg/my-org/my-project/domain/user-_id.type";

function escapeTree(edits: (files: Map<string, string>) => void): Map<string, string> {
	const files = fileSet("escape");
	edits(files);
	return files;
}

describe("readTree rejects a tree it cannot make a distribution of", () => {
	test("a tree with no manifest", () => {
		const e = errorOf(escapeTree((f) => f.delete("manifest")));
		expect(e.code).toBe("missing_member");
		expect(e.cursor).toBe("manifest");
	});

	test("a module manifest whose path is not its directory", () => {
		const e = errorOf(
			escapeTree((f) => {
				f.set(MODULE, (f.get(MODULE) as string).replace("path: domain", "path: elsewhere"));
			}),
		);
		expect(e.code).toBe("invalid_distribution_shape");
		expect(e.cursor).toBe(`${MODULE}#/path`);
	});

	test("a definition file whose name is not the name the module listed", () => {
		const e = errorOf(
			escapeTree((f) => {
				f.set(TYPE_FILE, (f.get(TYPE_FILE) as string).replace("name: user-ID", "name: other"));
			}),
		);
		expect(e.code).toBe("invalid_distribution_shape");
		expect(e.cursor).toBe(`${TYPE_FILE}#/name`);
	});

	test("a file no module manifest claims", () => {
		const stray = "pkg/my-org/my-project/domain/stray.type";
		const e = errorOf(
			escapeTree((f) => {
				f.set(
					stray,
					"formatVersion: 4\nname: stray\ndef:\n  Public:\n    TypeAliasDefinition:\n      typeParams: []\n      typeExp: morphir/SDK:string#string\n",
				);
			}),
		);
		expect(e.code).toBe("invalid_distribution_shape");
		expect(e.cursor).toBe(`${stray}#/`);
		expect(e.message).toContain("belongs to no module");
	});

	test("a definition file where a Specs tree wants a specification", () => {
		const e = errorOf(
			escapeTree((f) => {
				f.set("manifest", (f.get("manifest") as string).replace("distribution: Library", "distribution: Specs"));
			}),
		);
		expect(e.code).toBe("invalid_distribution_shape");
		expect(e.cursor).toBe(`${TYPE_FILE}#/`);
		expect(e.message).toContain("specification file");
	});

	test("a name the module listed with no file to read it from", () => {
		const e = errorOf(escapeTree((f) => f.delete(TYPE_FILE)));
		expect(e.code).toBe("missing_member");
		expect(e.cursor).toBe(TYPE_FILE);
	});

	test("a directory of definition files with no module manifest", () => {
		const e = errorOf(escapeTree((f) => f.delete(MODULE)));
		expect(e.code).toBe("invalid_distribution_shape");
		expect(e.message).toContain("belongs to no module");
	});
});

// ------------------------------------------------------------ dependencies

describe("readTree assembles deps/ into the distribution's dependencies", () => {
	const files = new Map<string, string>([
		["manifest", "formatVersion: 4\ndistribution: Library\npackage: my-org/my-project\npathBudget: 4000\ndependencies: [morphir/SDK]\n"],
		["deps/morphir/_sdk/basics/module", "formatVersion: 4\npath: basics\ntypes: [int]\nvalues: []\n"],
		["deps/morphir/_sdk/basics/int.type", "formatVersion: 4\nname: int\nspec:\n  OpaqueTypeSpecification: {}\n"],
	]);

	test("a dependency's specification files read into dependencies", () => {
		const r = read(files);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const expected = expectIRFile(
			[
				"formatVersion: 4",
				"distribution:",
				"  Library:",
				"    packageName: my-org/my-project",
				"    dependencies:",
				"      morphir/SDK:",
				"        modules:",
				"          basics:",
				"            types:",
				"              int:",
				"                OpaqueTypeSpecification: {}",
				"            values: {}",
				"    def:",
				"      modules: {}",
				"",
			].join("\n"),
		);
		expect(r.value.value).toEqual(expected);
	});

	test("a dependency file under a package the manifest does not list is unclaimed", () => {
		const stray = new Map(files);
		stray.set("deps/other/pkg/mod/module", "formatVersion: 4\npath: mod\ntypes: []\nvalues: []\n");
		const e = errorOf(stray);
		expect(e.code).toBe("invalid_distribution_shape");
		expect(e.message).toContain("belongs to no module");
	});
});
