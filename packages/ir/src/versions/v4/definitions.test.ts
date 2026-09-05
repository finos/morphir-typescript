// packages/ir/src/versions/v4/definitions.test.ts
// Hand cases for v4 documentation placement (decision 0010); the kit runner covers the rest.
// Run with: bun test packages/ir/src/versions/v4/definitions.test.ts
import { describe, expect, test } from "bun:test";
import { readNodeChecked, writeNode } from "./index.ts";

describe("decision 0010", () => {
	test("nested {doc, value} warns; flattened is canonical", () => {
		const nested = readNodeChecked("AccessControlledTypeDefinition", '{ "Public": { "doc": "d", "value": { "TypeAliasDefinition": { "typeParams": [], "typeExp": "a" } } } }');
		expect(nested.ok && nested.value.warnings.map((w) => w.code)).toEqual(["legacy_spelling"]);
		expect(nested.ok && writeNode(nested.value.value)).toBe('{ "Public": { "doc": "d", "TypeAliasDefinition": { "typeParams": [], "typeExp": "a" } } }');
	});
	test("a value specification's doc is written first", () => {
		const flat = readNodeChecked("ModuleSpecification", '{ "types": {}, "values": { "add": { "inputs": { "a": "b" }, "output": "b", "doc": "d" } } }');
		expect(flat.ok && flat.value.warnings).toEqual([]);
		expect(flat.ok && writeNode(flat.value.value)).toBe('{ "types": {}, "values": { "add": { "doc": "d", "inputs": { "a": "b" }, "output": "b" } } }');
		const nested = readNodeChecked("ModuleSpecification", '{ "types": {}, "values": { "add": { "doc": "d", "value": { "output": "b" } } } }');
		expect(nested.ok && nested.value.warnings.map((w) => w.code)).toEqual(["legacy_spelling"]);
	});
});
