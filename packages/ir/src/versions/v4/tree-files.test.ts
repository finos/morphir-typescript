// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The four document-tree file kinds as ordinary v4 nodes. The texts are the
// compatibility kit's own (document-tree-0001 through 0005), so a rule that
// drifts from the kit fails here as well as in the driver's round trip.
import { describe, expect, test } from "bun:test";
import { newRoot } from "../../codec/json/cursor.ts";
import { parseJson } from "../../codec/json/value.ts";
import { Name } from "../../model/names.ts";
import { json, type NodeValue, nodeKindOf, stripNode, yaml } from "./index.ts";
import { readModuleManifestFile } from "./read-tree-files.ts";

const MANIFEST = '{ "formatVersion": 4, "distribution": "Library", "package": "my-org/my-project", "pathBudget": 4000 }';
const MODULE = '{ "formatVersion": 4, "path": "my-org/domain", "types": ["user", "user-ID"], "values": ["get-user"] }';
const MODULE_LEGACY = '{ "formatVersion": 4, "module": "my-org/domain", "types": ["user", "user-ID"], "values": ["get-user"] }';

// The kit's document-tree-0003 and document-tree-0004 node files, verbatim.
const TYPE_FILE_YAML = `formatVersion: 4
name: user-ID
def:
  Public:
    doc: The user's identifier
    TypeAliasDefinition:
      typeParams: []
      typeExp: morphir/SDK:string#string
`;
const TRUNCATED_TYPE_FILE_YAML = `formatVersion: 4
name: customer-relationship-management-record
def:
  Public:
    TypeAliasDefinition:
      typeParams: []
      typeExp: morphir/SDK:string#string
`;

// The kit's document-tree-0005 files, verbatim, and what they come back as
// once the reserved $meta is dropped.
const META_MANIFEST_YAML = `formatVersion: 4
distribution: Library
package: my-org/my-project
pathBudget: 4000
$meta:
  generator: example
`;
const META_MANIFEST_WRITTEN = `formatVersion: 4
distribution: Library
package: my-org/my-project
pathBudget: 4000
`;
const META_MODULE_YAML = `formatVersion: 4
path: domain
types: []
values: []
$meta:
  generator: example
`;
const META_MODULE_WRITTEN = `formatVersion: 4
path: domain
types: []
values: []
`;

// An expanded type expression that carries attributes, so stripNode has
// something to clear: cleared, a Variable is written as its bare name.
const ATTRIBUTED_VARIABLE = '{ "Variable": { "attributes": { "source": { "startLine": 1, "startColumn": 1, "endLine": 1, "endColumn": 2 } }, "name": "a" } }';

const node = (r: ReturnType<typeof json.readNode>): NodeValue => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

const codeOf = (r: ReturnType<typeof json.readNode>): string => (r.ok ? "ok" : r.error.code);

describe("the distribution manifest file", () => {
	test("the kit's canonical manifest round-trips byte for byte", () => {
		expect(json.writeNode(node(json.readNode("DistributionManifestFile", MANIFEST)))).toBe(MANIFEST);
	});

	test("dependencies and entryPoints are optional and default to empty", () => {
		const v = node(json.readNode("DistributionManifestFile", MANIFEST));
		if (v.node !== "DistributionManifestFile") throw new Error("wrong node");
		expect(v.value.distribution).toBe("Library");
		expect(v.value.pathBudget).toBe(4000);
		expect(v.value.dependencies).toEqual([]);
		expect(v.value.entryPoints).toEqual([]);
		expect(nodeKindOf(v)).toBe("DistributionManifestFile");
	});

	test("dependencies are package names and are written back when non-empty", () => {
		const text = '{ "formatVersion": 4, "distribution": "Library", "package": "my-org/my-project", "pathBudget": 4000, "dependencies": ["morphir/SDK"] }';
		expect(json.writeNode(node(json.readNode("DistributionManifestFile", text)))).toBe(text);
	});

	test("an Application manifest carries entryPoints", () => {
		const text =
			'{ "formatVersion": 4, "distribution": "Application", "package": "my-org/app", "pathBudget": 4000, "entryPoints": { "main": { "target": "my-org/app:main#run", "kind": "main" } } }';
		expect(json.writeNode(node(json.readNode("DistributionManifestFile", text)))).toBe(text);
	});

	test("entryPoints on a Library manifest is unknown_member", () => {
		const text =
			'{ "formatVersion": 4, "distribution": "Library", "package": "p", "pathBudget": 4000, "entryPoints": { "main": { "target": "p:m#run", "kind": "main" } } }';
		expect(codeOf(json.readNode("DistributionManifestFile", text))).toBe("unknown_member");
	});

	test("a top-level $meta member is read and never written", () => {
		const text = '{ "formatVersion": 4, "distribution": "Library", "package": "p", "pathBudget": 4000, "$meta": { "x": 1 } }';
		expect(json.writeNode(node(json.readNode("DistributionManifestFile", text)))).toBe(
			'{ "formatVersion": 4, "distribution": "Library", "package": "p", "pathBudget": 4000 }',
		);
	});

	test("the kit's document-tree-0005 manifest drops its $meta", () => {
		const r = yaml.readNode("DistributionManifestFile", META_MANIFEST_YAML);
		if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
		expect(yaml.writeNode(r.value)).toBe(META_MANIFEST_WRITTEN);
	});

	test("version, created and layout are read and discarded", () => {
		const text =
			'{ "formatVersion": 4, "distribution": "Library", "package": "p", "pathBudget": 4000, "version": "1.2.3", "created": "2026-01-01", "layout": "tree" }';
		expect(json.writeNode(node(json.readNode("DistributionManifestFile", text)))).toBe(
			'{ "formatVersion": 4, "distribution": "Library", "package": "p", "pathBudget": 4000 }',
		);
	});

	test("a pathBudget under 64 is invalid_type", () => {
		const text = '{ "formatVersion": 4, "distribution": "Library", "package": "p", "pathBudget": 63 }';
		expect(json.readNode("DistributionManifestFile", text)).toMatchObject({
			ok: false,
			error: { code: "invalid_type", cursor: "/pathBudget", message: "pathBudget must be an integer of at least 64" },
		});
	});

	test("a non-integer pathBudget is invalid_type", () => {
		const text = '{ "formatVersion": 4, "distribution": "Library", "package": "p", "pathBudget": 4000.5 }';
		expect(json.readNode("DistributionManifestFile", text)).toMatchObject({
			ok: false,
			error: { code: "invalid_type", message: "pathBudget must be an integer of at least 64" },
		});
	});

	test("an unknown distribution kind is invalid_distribution_shape", () => {
		const text = '{ "formatVersion": 4, "distribution": "Bundle", "package": "p", "pathBudget": 4000 }';
		expect(codeOf(json.readNode("DistributionManifestFile", text))).toBe("invalid_distribution_shape");
	});

	test("an unsupported format version is refused", () => {
		const text = '{ "formatVersion": 3, "distribution": "Library", "package": "p", "pathBudget": 4000 }';
		expect(json.readNode("DistributionManifestFile", text).ok).toBe(false);
	});

	test("an Application with no entry points writes no entryPoints member", () => {
		const text = '{ "formatVersion": 4, "distribution": "Application", "package": "my-org/app", "pathBudget": 4000 }';
		expect(json.writeNode(node(json.readNode("DistributionManifestFile", text)))).toBe(text);
	});
});

describe("the module manifest file", () => {
	test("the kit's canonical module manifest round-trips byte for byte", () => {
		expect(json.writeNode(node(json.readNode("ModuleManifestFile", MODULE)))).toBe(MODULE);
	});

	test('"module" is accepted, written back as "path", and warns about nothing', () => {
		const checked = json.readNodeChecked("ModuleManifestFile", MODULE_LEGACY);
		if (!checked.ok) throw new Error(checked.error.message);
		expect(checked.value.warnings).toEqual([]);
		expect(json.writeNode(checked.value.value)).toBe(MODULE);
	});

	test('"path" and "module" together is unknown_member', () => {
		const text = '{ "formatVersion": 4, "path": "domain", "module": "domain" }';
		expect(json.readNode("ModuleManifestFile", text)).toMatchObject({
			ok: false,
			error: { code: "unknown_member", cursor: "/module", message: "module is the legacy spelling of path; write only one" },
		});
	});

	test("neither is missing_member", () => {
		expect(codeOf(json.readNode("ModuleManifestFile", '{ "formatVersion": 4 }'))).toBe("missing_member");
	});

	test("absent types and values are the empty names style", () => {
		const v = node(json.readNode("ModuleManifestFile", '{ "formatVersion": 4, "path": "domain" }'));
		if (v.node !== "ModuleManifestFile") throw new Error("wrong node");
		expect(v.value.types).toEqual({ style: "names", names: [] });
		expect(v.value.values).toEqual({ style: "names", names: [] });
		expect(v.value.access).toBe("Public");
		expect(json.writeNode(v)).toBe('{ "formatVersion": 4, "path": "domain", "types": [], "values": [] }');
	});

	test("access Private round-trips and Public is never written", () => {
		const priv = '{ "formatVersion": 4, "path": "domain", "access": "Private", "types": [], "values": [] }';
		expect(json.writeNode(node(json.readNode("ModuleManifestFile", priv)))).toBe(priv);
		const pub = '{ "formatVersion": 4, "path": "domain", "access": "Public", "types": [], "values": [] }';
		expect(json.writeNode(node(json.readNode("ModuleManifestFile", pub)))).toBe('{ "formatVersion": 4, "path": "domain", "types": [], "values": [] }');
	});

	test("a doc array is joined with newlines", () => {
		const text = '{ "formatVersion": 4, "path": "domain", "doc": ["one", "two"], "types": [], "values": [] }';
		expect(json.writeNode(node(json.readNode("ModuleManifestFile", text)))).toBe(
			'{ "formatVersion": 4, "path": "domain", "doc": "one\\ntwo", "types": [], "values": [] }',
		);
	});

	test("a top-level $meta member is read and never written", () => {
		const text = '{ "formatVersion": 4, "path": "domain", "types": [], "values": [], "$meta": { "generator": "example" } }';
		expect(json.writeNode(node(json.readNode("ModuleManifestFile", text)))).toBe('{ "formatVersion": 4, "path": "domain", "types": [], "values": [] }');
	});

	test("the kit's document-tree-0005 module manifest drops its $meta", () => {
		const r = yaml.readNode("ModuleManifestFile", META_MODULE_YAML);
		if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
		expect(yaml.writeNode(r.value)).toBe(META_MODULE_WRITTEN);
	});

	test("fileNames maps a listed name to its escaped stem and round-trips", () => {
		const text =
			'{ "formatVersion": 4, "path": "domain", "types": ["customer-relationship-management-record"], "values": [], "fileNames": { "customer-relationship-management-record": "customer-relati__44a101f8" } }';
		expect(json.writeNode(node(json.readNode("ModuleManifestFile", text)))).toBe(text);
	});

	test("a fileNames key that is not listed under types or values is invalid_distribution_shape", () => {
		const text = '{ "formatVersion": 4, "path": "domain", "types": ["user"], "values": [], "fileNames": { "other": "other" } }';
		expect(json.readNode("ModuleManifestFile", text)).toMatchObject({
			ok: false,
			error: { code: "invalid_distribution_shape", cursor: "/fileNames/other", message: "fileNames key not listed in types or values" },
		});
	});

	test("a fileNames stem that is not an escaped stem is invalid_name", () => {
		const text = '{ "formatVersion": 4, "path": "domain", "types": ["user"], "values": [], "fileNames": { "user": "User Name" } }';
		expect(codeOf(json.readNode("ModuleManifestFile", text))).toBe("invalid_name");
	});

	test("a types object reads as definitions by default and round-trips", () => {
		const text =
			'{ "formatVersion": 4, "path": "domain", "types": { "user": { "Public": { "TypeAliasDefinition": { "typeParams": [], "typeExp": "morphir/SDK:string#string" } } } }, "values": [] }';
		const v = node(json.readNode("ModuleManifestFile", text));
		if (v.node !== "ModuleManifestFile") throw new Error("wrong node");
		expect(v.value.types.style).toBe("definitions");
		expect(json.writeNode(v)).toBe(text);
	});

	test('a types object reads as specifications under expect: "specifications"', () => {
		const text = '{ "formatVersion": 4, "path": "domain", "types": { "user": { "OpaqueTypeSpecification": {} } }, "values": [] }';
		const parsed = parseJson(text);
		if (!parsed.ok) throw new Error(parsed.error.message);
		const r = readModuleManifestFile(parsed.value, newRoot(), { expect: "specifications" });
		if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
		expect(r.value.types.style).toBe("specifications");
		expect(json.writeNode({ node: "ModuleManifestFile", value: r.value })).toBe(text);
	});

	test('an access-controlled entry under expect: "specifications" is invalid_distribution_shape', () => {
		const text =
			'{ "formatVersion": 4, "path": "domain", "types": { "user": { "Public": { "TypeAliasDefinition": { "typeParams": [], "typeExp": "morphir/SDK:string#string" } } } }, "values": [] }';
		const parsed = parseJson(text);
		if (!parsed.ok) throw new Error(parsed.error.message);
		expect(readModuleManifestFile(parsed.value, newRoot(), { expect: "specifications" })).toMatchObject({
			ok: false,
			error: { code: "invalid_distribution_shape", cursor: "/types/user", message: "expected a specification, found an access-controlled definition" },
		});
	});

	test('an "access" spelled entry under expect: "specifications" is caught too', () => {
		const text = '{ "formatVersion": 4, "path": "domain", "types": { "user": { "access": "Public", "OpaqueTypeSpecification": {} } }, "values": [] }';
		const parsed = parseJson(text);
		if (!parsed.ok) throw new Error(parsed.error.message);
		expect(readModuleManifestFile(parsed.value, newRoot(), { expect: "specifications" })).toMatchObject({
			ok: false,
			error: { code: "invalid_distribution_shape", cursor: "/types/user" },
		});
	});

	test("names style keeps the canonical spelling of every name", () => {
		const v = node(json.readNode("ModuleManifestFile", MODULE));
		if (v.node !== "ModuleManifestFile") throw new Error("wrong node");
		if (v.value.types.style !== "names") throw new Error("wrong style");
		expect(v.value.types.names.map((n) => Name.canonical(n))).toEqual(["user", "user-ID"]);
		expect(nodeKindOf(v)).toBe("ModuleManifestFile");
	});
});

describe("the type and value definition files", () => {
	test("the kit's type file reads through the yaml profile and reports its variant", () => {
		const r = yaml.readNode("TypeDefinitionFile", TYPE_FILE_YAML);
		if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
		expect(nodeKindOf(r.value)).toBe("TypeAliasDefinition");
		expect(yaml.writeNode(r.value)).toBe(TYPE_FILE_YAML);
	});

	test("the kit's truncated-stem type file round-trips through the yaml profile", () => {
		const r = yaml.readNode("TypeDefinitionFile", TRUNCATED_TYPE_FILE_YAML);
		if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
		expect(yaml.writeNode(r.value)).toBe(TRUNCATED_TYPE_FILE_YAML);
	});

	test("a type file with a spec round-trips", () => {
		const text = '{ "formatVersion": 4, "name": "user", "spec": { "OpaqueTypeSpecification": {} } }';
		expect(json.writeNode(node(json.readNode("TypeDefinitionFile", text)))).toBe(text);
	});

	test("def and spec together is invalid_distribution_shape", () => {
		const text =
			'{ "formatVersion": 4, "name": "user", "def": { "Public": { "TypeAliasDefinition": { "typeParams": [], "typeExp": "morphir/SDK:string#string" } } }, "spec": { "OpaqueTypeSpecification": {} } }';
		expect(codeOf(json.readNode("TypeDefinitionFile", text))).toBe("invalid_distribution_shape");
	});

	test("neither def nor spec is invalid_distribution_shape", () => {
		expect(codeOf(json.readNode("TypeDefinitionFile", '{ "formatVersion": 4, "name": "user" }'))).toBe("invalid_distribution_shape");
	});

	test("a top-level $meta member is read and never written", () => {
		const text = '{ "formatVersion": 4, "name": "user", "spec": { "OpaqueTypeSpecification": {} }, "$meta": { "x": 1 } }';
		expect(json.writeNode(node(json.readNode("TypeDefinitionFile", text)))).toBe(
			'{ "formatVersion": 4, "name": "user", "spec": { "OpaqueTypeSpecification": {} } }',
		);
	});

	test("a value file with a def round-trips and reports its variant", () => {
		const text =
			'{ "formatVersion": 4, "name": "get-user", "def": { "Public": { "ExpressionBody": { "inputTypes": {}, "outputType": "morphir/SDK:basics#int", "body": { "Literal": { "IntegerLiteral": 42 } } } } } }';
		const v = node(json.readNode("ValueDefinitionFile", text));
		expect(nodeKindOf(v)).toBe("ExpressionBody");
		expect(json.writeNode(v)).toBe(text);
	});

	test("a value file with a spec round-trips", () => {
		const text = '{ "formatVersion": 4, "name": "get-user", "spec": { "output": "morphir/SDK:basics#int" } }';
		expect(json.writeNode(node(json.readNode("ValueDefinitionFile", text)))).toBe(text);
	});

	test("def and spec together on a value file is invalid_distribution_shape", () => {
		const text = '{ "formatVersion": 4, "name": "x", "def": { "Public": {} }, "spec": { "output": "morphir/SDK:basics#int" } }';
		expect(codeOf(json.readNode("ValueDefinitionFile", text))).toBe("invalid_distribution_shape");
	});

	test("a spec-bodied value file has no variant of its own to report", () => {
		const text = '{ "formatVersion": 4, "name": "get-user", "spec": { "output": "morphir/SDK:basics#int" } }';
		expect(nodeKindOf(node(json.readNode("ValueDefinitionFile", text)))).toBe("ValueSpecification");
	});
});

// A file that does not say which format it is in is missing the version, not
// missing a member: all four kinds answer what readIRFile answers for a
// single-file document.
describe("a file with no formatVersion", () => {
	const cases: readonly (readonly [string, string])[] = [
		["DistributionManifestFile", '{ "distribution": "Library", "package": "p", "pathBudget": 4000 }'],
		["ModuleManifestFile", '{ "path": "domain", "types": [], "values": [] }'],
		["TypeDefinitionFile", '{ "name": "user", "spec": { "OpaqueTypeSpecification": {} } }'],
		["ValueDefinitionFile", '{ "name": "get-user", "spec": { "output": "morphir/SDK:basics#int" } }'],
	];
	for (const [kind, text] of cases) {
		test(`${kind} reports missing_format_version`, () => {
			expect(codeOf(json.readNode(kind as "DistributionManifestFile", text))).toBe("missing_format_version");
		});
	}
});

describe("stripNode clears the attributes the tree files carry", () => {
	const stripped = (kind: "ModuleManifestFile" | "TypeDefinitionFile" | "ValueDefinitionFile", text: string): string =>
		json.writeNode(stripNode(node(json.readNode(kind, text))));

	test("a definitions-style module manifest clears its type and value attributes", () => {
		const text = `{ "formatVersion": 4, "path": "domain", "types": { "user": { "Public": { "TypeAliasDefinition": { "typeParams": [], "typeExp": ${ATTRIBUTED_VARIABLE} } } } }, "values": [] }`;
		expect(stripped("ModuleManifestFile", text)).toBe(
			'{ "formatVersion": 4, "path": "domain", "types": { "user": { "Public": { "TypeAliasDefinition": { "typeParams": [], "typeExp": "a" } } } }, "values": [] }',
		);
	});

	test("a specifications-style module manifest clears them too", () => {
		const text = `{ "formatVersion": 4, "path": "domain", "types": { "user": { "TypeAliasSpecification": { "typeParams": [], "typeExp": ${ATTRIBUTED_VARIABLE} } } }, "values": [] }`;
		const parsed = parseJson(text);
		if (!parsed.ok) throw new Error(parsed.error.message);
		const r = readModuleManifestFile(parsed.value, newRoot(), { expect: "specifications" });
		if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
		expect(json.writeNode(stripNode({ node: "ModuleManifestFile", value: r.value }))).toBe(
			'{ "formatVersion": 4, "path": "domain", "types": { "user": { "TypeAliasSpecification": { "typeParams": [], "typeExp": "a" } } }, "values": [] }',
		);
	});

	test("a names-style module manifest comes back unchanged", () => {
		const v = node(json.readNode("ModuleManifestFile", MODULE));
		expect(stripNode(v)).toEqual(v);
		expect(json.writeNode(stripNode(v))).toBe(MODULE);
	});

	test("a def-bodied type file clears its type attributes", () => {
		const text = `{ "formatVersion": 4, "name": "user", "def": { "Public": { "TypeAliasDefinition": { "typeParams": [], "typeExp": ${ATTRIBUTED_VARIABLE} } } } }`;
		expect(stripped("TypeDefinitionFile", text)).toBe(
			'{ "formatVersion": 4, "name": "user", "def": { "Public": { "TypeAliasDefinition": { "typeParams": [], "typeExp": "a" } } } }',
		);
	});

	test("a spec-bodied type file clears its type attributes", () => {
		const text = `{ "formatVersion": 4, "name": "user", "spec": { "TypeAliasSpecification": { "typeParams": [], "typeExp": ${ATTRIBUTED_VARIABLE} } } }`;
		expect(stripped("TypeDefinitionFile", text)).toBe(
			'{ "formatVersion": 4, "name": "user", "spec": { "TypeAliasSpecification": { "typeParams": [], "typeExp": "a" } } }',
		);
	});

	test("a def-bodied value file clears its attributes", () => {
		const text = `{ "formatVersion": 4, "name": "get-user", "def": { "Public": { "ExpressionBody": { "inputTypes": {}, "outputType": ${ATTRIBUTED_VARIABLE}, "body": { "Literal": { "IntegerLiteral": 42 } } } } } }`;
		expect(stripped("ValueDefinitionFile", text)).toBe(
			'{ "formatVersion": 4, "name": "get-user", "def": { "Public": { "ExpressionBody": { "inputTypes": {}, "outputType": "a", "body": { "Literal": { "IntegerLiteral": 42 } } } } } }',
		);
	});

	test("a spec-bodied value file clears its attributes", () => {
		const text = `{ "formatVersion": 4, "name": "get-user", "spec": { "output": ${ATTRIBUTED_VARIABLE} } }`;
		expect(stripped("ValueDefinitionFile", text)).toBe('{ "formatVersion": 4, "name": "get-user", "spec": { "output": "a" } }');
	});

	test("a distribution manifest has nothing to clear", () => {
		const v = node(json.readNode("DistributionManifestFile", MANIFEST));
		expect(stripNode(v)).toBe(v);
	});
});
