// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for reading a document tree (S7.2): the kit's three `file` sets read
// to the same IRFile as the case's canonical document, each shape error the
// tree can carry is reported with the logical path on its cursor, and the
// diagnostics and warnings a file reader produced come back re-cursored onto
// the file they came from.
// Run with: bun test packages/ir/src/layout/read-tree.test.ts
import { describe, expect, test } from "bun:test";
import { YAML_PROFILE } from "../codec/yaml/index.ts";
import { yaml } from "../versions/v4/index.ts";
import { canonicalYaml, fileSet } from "./kit-fixtures.test-helper.ts";
import { readTree } from "./read-tree.ts";
import { writeTree } from "./write-tree.ts";

function expectIRFile(text: string) {
	const r = yaml.read(text);
	if (!r.ok) throw new Error(`fixture does not read: ${r.error.code} ${r.error.message}`);
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

function okOf(files: ReadonlyMap<string, string>) {
	const r = read(files);
	if (!r.ok) throw new Error(`expected the tree to read: ${r.error.code} ${r.error.cursor} ${r.error.message}`);
	return r.value;
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
			const r = okOf(files);
			expect(r.value).toEqual(expectIRFile(canonicalYaml(id)));
			expect(r.warnings).toEqual([]);
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

	// S7.2 step 4: under `pkg/` and `deps/` there is nothing but modules, so a
	// path the grammar does not recognize is an error rather than something to
	// skip past.
	test("a file under pkg/ the path grammar does not recognize", () => {
		const e = errorOf(escapeTree((f) => f.set("pkg/notes", "formatVersion: 4\n")));
		expect(e.code).toBe("invalid_distribution_shape");
		expect(e.cursor).toBe("pkg/notes#/");
		expect(e.message).toContain("belongs to no module");
	});

	test("a file outside pkg/ and deps/ is ignored", () => {
		const r = okOf(escapeTree((f) => f.set("notes", "anything at all")));
		expect(r.value).toEqual(expectIRFile(canonicalYaml("document-tree-0003")));
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

// --------------------------------------------------------- re-cursoring

describe("a file's own diagnostics come back under the file's logical path", () => {
	test("an error inside the distribution manifest keeps its pointer", () => {
		// 63 is one below the smallest budget a tree may declare, so the manifest
		// reader fails at /pathBudget and the layout prefixes the file.
		const e = errorOf(escapeTree((f) => f.set("manifest", (f.get("manifest") as string).replace("pathBudget: 4000", "pathBudget: 63"))));
		expect(e.cursor).toBe("manifest#/pathBudget");
		expect(e.code).toBe("invalid_type");
	});

	test("a legacy spelling inside a node file warns under that file's path", () => {
		const r = okOf(
			escapeTree((f) => {
				const legacy = [
					"formatVersion: 4",
					"name: user-ID",
					"def:",
					"  Public:",
					"    doc: The user's identifier",
					"    TypeAliasDefinition:",
					"      typeParams: []",
					"      typeExp:",
					"        Function:",
					"          arg: morphir/SDK:string#string",
					"          returnType: morphir/SDK:string#string",
					"",
				].join("\n");
				f.set(TYPE_FILE, legacy);
			}),
		);
		expect(r.warnings).toHaveLength(1);
		const w = r.warnings[0];
		expect(w?.code).toBe("legacy_spelling");
		expect(w?.cursor.startsWith(`${TYPE_FILE}#/`)).toBe(true);
		expect(w?.cursor).toContain("/arg");
		expect(w?.message).toContain("parameterType");
	});
});

// ------------------------------------------------------------ hybrid modules

describe("readTree reads inline entries as well as listed names", () => {
	const HYBRID = new Map<string, string>([
		["manifest", "formatVersion: 4\ndistribution: Library\npackage: example\npathBudget: 4000\n"],
		[
			"pkg/example/main/module",
			[
				"formatVersion: 4",
				"path: main",
				"types: [user-ID]",
				"values:",
				"  run:",
				"    Public:",
				"      ExpressionBody:",
				"        inputTypes: {}",
				"        outputType: morphir/SDK:basics#unit",
				"        body:",
				"          Unit: {}",
				"",
			].join("\n"),
		],
		[
			"pkg/example/main/user-_id.type",
			[
				"formatVersion: 4",
				"name: user-ID",
				"def:",
				"  Public:",
				"    TypeAliasDefinition:",
				"      typeParams: []",
				"      typeExp: morphir/SDK:string#string",
				"",
			].join("\n"),
		],
	]);

	test("a definitions module with listed types and inline values", () => {
		const r = okOf(HYBRID);
		expect(r.value).toEqual(
			expectIRFile(
				[
					"formatVersion: 4",
					"distribution:",
					"  Library:",
					"    packageName: example",
					"    dependencies: {}",
					"    def:",
					"      modules:",
					"        main:",
					"          Public:",
					"            types:",
					"              user-ID:",
					"                Public:",
					"                  TypeAliasDefinition:",
					"                    typeParams: []",
					"                    typeExp: morphir/SDK:string#string",
					"            values:",
					"              run:",
					"                Public:",
					"                  ExpressionBody:",
					"                    inputTypes: {}",
					"                    outputType: morphir/SDK:basics#unit",
					"                    body:",
					"                      Unit: {}",
					"",
				].join("\n"),
			),
		);
	});

	test("a Specs module written entirely inline", () => {
		const files = new Map<string, string>([
			["manifest", "formatVersion: 4\ndistribution: Specs\npackage: example\npathBudget: 4000\n"],
			["pkg/example/main/module", ["formatVersion: 4", "path: main", "types:", "  int:", "    OpaqueTypeSpecification: {}", "values: {}", ""].join("\n")],
		]);
		const r = okOf(files);
		expect(r.value).toEqual(
			expectIRFile(
				[
					"formatVersion: 4",
					"distribution:",
					"  Specs:",
					"    packageName: example",
					"    dependencies: {}",
					"    spec:",
					"      modules:",
					"        main:",
					"          types:",
					"            int:",
					"              OpaqueTypeSpecification: {}",
					"          values: {}",
					"",
				].join("\n"),
			),
		);
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
		const r = okOf(files);
		expect(r.value).toEqual(
			expectIRFile(
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
			),
		);
	});

	test("a dependency file under a package the manifest does not list is unclaimed", () => {
		const stray = new Map(files);
		stray.set("deps/other/pkg/mod/module", "formatVersion: 4\npath: mod\ntypes: []\nvalues: []\n");
		const e = errorOf(stray);
		expect(e.code).toBe("invalid_distribution_shape");
		expect(e.message).toContain("belongs to no module");
	});

	test("a specification where a Library dependency would need one is fine, a definition is not", () => {
		const wrong = new Map(files);
		wrong.set(
			"deps/morphir/_sdk/basics/int.type",
			[
				"formatVersion: 4",
				"name: int",
				"def:",
				"  Public:",
				"    TypeAliasDefinition:",
				"      typeParams: []",
				"      typeExp: morphir/SDK:string#string",
				"",
			].join("\n"),
		);
		const e = errorOf(wrong);
		expect(e.code).toBe("invalid_distribution_shape");
		expect(e.cursor).toBe("deps/morphir/_sdk/basics/int.type#/");
		expect(e.message).toContain("specification file");
	});
});

// ---------------------------------------------------- an Application's deps

// An application links its dependencies statically, so `deps/` holds package
// definitions there where every other kind holds specifications (S7.3a). That
// is the one branch the kit has no case for.
const APPLICATION = new Map<string, string>([
	[
		"manifest",
		"formatVersion: 4\ndistribution: Application\npackage: example\npathBudget: 4000\ndependencies: [dep/pkg]\nentryPoints:\n  start:\n    target: example:main#run\n    kind: main\n",
	],
	["pkg/example/main/module", "formatVersion: 4\npath: main\ntypes: []\nvalues: [run]\n"],
	[
		"pkg/example/main/run.value",
		[
			"formatVersion: 4",
			"name: run",
			"def:",
			"  Public:",
			"    ExpressionBody:",
			"      inputTypes: {}",
			"      outputType: morphir/SDK:basics#unit",
			"      body:",
			"        Unit: {}",
			"",
		].join("\n"),
	],
	["deps/dep/pkg/mod/module", "formatVersion: 4\npath: mod\ntypes: [thing]\nvalues: []\n"],
	[
		"deps/dep/pkg/mod/thing.type",
		[
			"formatVersion: 4",
			"name: thing",
			"def:",
			"  Public:",
			"    TypeAliasDefinition:",
			"      typeParams: []",
			"      typeExp: morphir/SDK:string#string",
			"",
		].join("\n"),
	],
]);

const APPLICATION_DOCUMENT = [
	"formatVersion: 4",
	"distribution:",
	"  Application:",
	"    packageName: example",
	"    dependencies:",
	"      dep/pkg:",
	"        modules:",
	"          mod:",
	"            Public:",
	"              types:",
	"                thing:",
	"                  Public:",
	"                    TypeAliasDefinition:",
	"                      typeParams: []",
	"                      typeExp: morphir/SDK:string#string",
	"              values: {}",
	"    def:",
	"      modules:",
	"        main:",
	"          Public:",
	"            types: {}",
	"            values:",
	"              run:",
	"                Public:",
	"                  ExpressionBody:",
	"                    inputTypes: {}",
	"                    outputType: morphir/SDK:basics#unit",
	"                    body:",
	"                      Unit: {}",
	"    entryPoints:",
	"      start:",
	"        target: example:main#run",
	"        kind: main",
	"",
].join("\n");

describe("an Application's deps/ holds package definitions", () => {
	test("definition files under deps/ read into dependencies as a PackageDefinition", () => {
		const r = okOf(APPLICATION);
		expect(r.value).toEqual(expectIRFile(APPLICATION_DOCUMENT));
		const d = r.value.distribution;
		expect(d.kind).toBe("Application");
		if (d.kind !== "Application") return;
		expect(d.dependencies).toHaveLength(1);
		expect(d.dependencies[0]?.value.modules[0]?.value.access).toBe("Public");
	});

	test("the same distribution writes back to the same tree", () => {
		const back = writeTree(expectIRFile(APPLICATION_DOCUMENT), { profile: YAML_PROFILE, pathBudget: 4000 });
		expect(back.ok).toBe(true);
		if (!back.ok) return;
		expect(new Map(back.value)).toEqual(APPLICATION);
	});

	test("a specification file under an Application's deps/ is rejected", () => {
		const wrong = new Map(APPLICATION);
		wrong.set("deps/dep/pkg/mod/thing.type", "formatVersion: 4\nname: thing\nspec:\n  OpaqueTypeSpecification: {}\n");
		const e = errorOf(wrong);
		expect(e.code).toBe("invalid_distribution_shape");
		expect(e.cursor).toBe("deps/dep/pkg/mod/thing.type#/");
		expect(e.message).toContain("definition file");
	});
});
