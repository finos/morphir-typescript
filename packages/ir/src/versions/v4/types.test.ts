// packages/ir/src/versions/v4/types.test.ts
// Hand cases for v4 type reading and canonical writing; the kit runner covers the rest.
// Run with: bun test packages/ir/src/versions/v4/types.test.ts
import { describe, expect, test } from "bun:test";
import { at, newRoot } from "../../codec/json/cursor.ts";
import { type JsonValue, parseJson, writeJson } from "../../codec/json/value.ts";
import { readNodeChecked, writeNode } from "./index.ts";
import { readType, readTypeDefinition, readTypeSpecification } from "./read-types.ts";
import { writeType, writeTypeDefinition, writeTypeSpecification } from "./write-types.ts";

const json = (s: string) => { const r = parseJson(s); if (!r.ok) throw new Error(r.error.message); return r.value; };
const roundTrip = (s: string, expected = s): void => {
	const r = readType(newRoot(), json(s));
	expect(r.ok).toBe(true);
	if (r.ok) expect(writeJson(writeType(r.value))).toBe(expected);
};

describe("readType/writeType", () => {
	test("canonical spellings round-trip", () => {
		roundTrip('"a"');
		roundTrip('"morphir/SDK:basics#int"');
		roundTrip('{ "Reference": ["morphir/SDK:list#list", "a"] }');
		roundTrip('{ "Tuple": ["morphir/SDK:basics#int", "morphir/SDK:string#string"] }');
		roundTrip('{ "Record": { "fields": { "name": "morphir/SDK:string#string", "age": "morphir/SDK:basics#int" } } }');
		roundTrip('{ "ExtensibleRecord": { "variable": "r", "fields": { "email": "morphir/SDK:string#string" } } }');
		roundTrip('{ "Function": { "parameterType": "morphir/SDK:basics#int", "returnType": "morphir/SDK:string#string" } }');
		roundTrip('{ "Unit": {} }');
	});
	test("accepted spellings normalize to canonical", () => {
		roundTrip('{ "Reference": "morphir/SDK:basics#int" }', '"morphir/SDK:basics#int"');
		roundTrip('{ "Reference": { "fqname": "morphir/SDK:list#list", "args": ["a"] } }', '{ "Reference": ["morphir/SDK:list#list", "a"] }');
		roundTrip('["morphir/SDK:basics#int", "a"]', '{ "Tuple": ["morphir/SDK:basics#int", "a"] }');
		roundTrip('{ "Tuple": { "elements": ["a", "b"] } }', '{ "Tuple": ["a", "b"] }');
	});
	test("a bare array is a Tuple, never a Reference", () => {
		const r = readType(newRoot(), json('["morphir/SDK:list#list", "a"]'));
		expect(r.ok && r.value.kind).toBe("Tuple");
	});
	test("renamed members are unknown_member, located in the source", () => {
		// "arg" and "argumentType" are window spellings and are accepted; a name
		// the window does not cover is still unknown_member where it was written.
		const r = readType(newRoot(), json('{ "Function": { "argType": "a", "returnType": "b" } }'));
		expect(!r.ok && r.error.code).toBe("unknown_member");
		expect(!r.ok && r.error.cursor).toBe("/Function/argType");
		expect(!r.ok && r.error.line).not.toBeNull();
		expect(!r.ok && r.error.column).not.toBeNull();
	});
	test("deep nesting is a diagnostic, not a thrown stack overflow", () => {
		const text = "[".repeat(20000) + "]".repeat(20000);
		const parsed = parseJson(text);
		const r = parsed.ok ? readType(newRoot(), parsed.value) : parsed;
		expect(r).toMatchObject({ ok: false, error: { code: "nesting_too_deep" } });
	});
	test("a tree built in memory is bounded by the cursor guard", () => {
		let deep: JsonValue = [];
		for (let i = 0; i < 2000; i += 1) deep = [deep];
		// The guard reads the cursor's own depth, so a nested read starts where
		// its caller left off; from the root it trips at MAX_DEPTH.
		expect(readType(newRoot(), deep)).toMatchObject({ ok: false, error: { code: "nesting_too_deep" } });
		expect(at(newRoot(), "x").depth).toBe(1);
	});
	test("attributes produce and read the expanded form", () => {
		const s = '{ "Variable": { "attributes": { "source": { "startLine": 1, "startColumn": 2, "endLine": 3, "endColumn": 4 } }, "name": "a" } }';
		roundTrip(s);
	});
});

describe("record payload detection", () => {
	test("a member set that is not exactly {fields} or {attributes, fields} is a field map", () => {
		// "attributes" beside another name is a field called "attributes", not the
		// canonical payload, so this is a two-field record in the legacy spelling.
		const r = readType(newRoot(), json('{ "Record": { "a": "morphir/SDK:basics#int", "attributes": "morphir/SDK:string#string" } }'));
		expect(r.ok && r.value.kind === "Record" && r.value.fields.length).toBe(2);
		const canonical = '{ "Record": { "fields": { "a": "morphir/SDK:basics#int", "attributes": "morphir/SDK:string#string" } } }';
		expect(r.ok && writeJson(writeType(r.value))).toBe(canonical);
		roundTrip(canonical);
	});
	test("a lone fields member is the canonical payload, so a non-object fails there", () => {
		const r = readType(newRoot(), json('{ "Record": { "fields": "morphir/SDK:basics#int" } }'));
		expect(r).toMatchObject({ ok: false, error: { code: "invalid_type", cursor: "/Record/fields" } });
	});
	test("a record whose only field is called fields round-trips", () => {
		roundTrip('{ "Record": { "fields": { "fields": "morphir/SDK:basics#int" } } }');
	});
});

describe("specifications and definitions", () => {
	test("opaque spec canonical and legacy", () => {
		for (const s of ['{ "OpaqueTypeSpecification": {} }', '["OpaqueTypeSpecification", []]']) {
			const r = readTypeSpecification(newRoot(), json(s));
			expect(r.ok && writeJson(writeTypeSpecification(r.value))).toBe('{ "OpaqueTypeSpecification": {} }');
		}
	});
	test("custom type definition with constructors", () => {
		const s = '{ "CustomTypeDefinition": { "typeParams": ["a"], "access": "Public", "constructors": { "just": [["value", "a"]], "nothing": [] } } }';
		const r = readTypeDefinition(newRoot(), json(s));
		expect(r.ok && writeJson(writeTypeDefinition(r.value))).toBe(s);
	});
	test("derived spec", () => {
		const s = '{ "DerivedTypeSpecification": { "typeParams": [], "baseType": "morphir/SDK:string#string", "fromBaseType": "my-org/sdk:local-date#from-string", "toBaseType": "my-org/sdk:local-date#to-string" } }';
		const r = readTypeSpecification(newRoot(), json(s));
		expect(r.ok && writeJson(writeTypeSpecification(r.value))).toBe(s);
	});
});

describe("decisions 0004, 0005, 0007", () => {
	test("Record writes fields and reads the direct map with a warning", () => {
		roundTrip('{ "Record": { "fields": { "name": "morphir/SDK:string#string" } } }');
		const r = readNodeChecked("Type", '{ "Record": { "name": "morphir/SDK:string#string" } }');
		expect(r.ok && r.value.warnings.map((w) => w.code)).toEqual(["legacy_spelling"]);
		expect(r.ok && writeNode(r.value.value)).toBe('{ "Record": { "fields": { "name": "morphir/SDK:string#string" } } }');
	});
	test("a record whose only field is called fields is canonical, not legacy", () => {
		const r = readNodeChecked("Type", '{ "Record": { "fields": { "fields": "a" } } }');
		expect(r.ok && r.value.warnings).toEqual([]);
		// readNodeChecked answers with the whole NodeValue union, so the node name
		// is checked before the type's own members are.
		const t = r.ok && r.value.value.node === "Type" ? r.value.value.value : null;
		expect(t !== null && t.kind === "Record" && t.fields.length).toBe(1);
	});
	test("Function reads parameterType, argumentType, and arg/result", () => {
		roundTrip('{ "Function": { "parameterType": "a", "returnType": "b" } }');
		for (const legacy of ['{ "Function": { "argumentType": "a", "returnType": "b" } }', '{ "Function": { "arg": "a", "result": "b" } }']) {
			const r = readNodeChecked("Type", legacy);
			expect(r.ok && r.value.warnings.length).toBeGreaterThan(0);
			expect(r.ok && writeNode(r.value.value)).toBe('{ "Function": { "parameterType": "a", "returnType": "b" } }');
		}
		const both = readNodeChecked("Type", '{ "Function": { "parameterType": "a", "argumentType": "a", "returnType": "b" } }');
		expect(!both.ok && both.error.code).toBe("unknown_member");
	});
	test("attrs is read as attributes with a warning", () => {
		const r = readNodeChecked("Type", '{ "Variable": { "attrs": {}, "name": "a" } }');
		expect(r.ok && r.value.warnings.map((w) => w.code)).toEqual(["legacy_spelling"]);
		expect(r.ok && writeNode(r.value.value)).toBe('"a"');
	});
});
