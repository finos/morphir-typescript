// packages/ir/src/versions/v4/types.test.ts
// Hand cases for v4 type reading and canonical writing; the kit runner covers the rest.
// Run with: bun test packages/ir/src/versions/v4/types.test.ts
import { describe, expect, test } from "bun:test";
import { at, root } from "../../codec/json/cursor.ts";
import { type JsonValue, parseJson, writeJson } from "../../codec/json/value.ts";
import { readType, readTypeDefinition, readTypeSpecification } from "./read-types.ts";
import { writeType, writeTypeDefinition, writeTypeSpecification } from "./write-types.ts";

const json = (s: string) => { const r = parseJson(s); if (!r.ok) throw new Error(r.error.message); return r.value; };
const roundTrip = (s: string, expected = s): void => {
	const r = readType(root, json(s));
	expect(r.ok).toBe(true);
	if (r.ok) expect(writeJson(writeType(r.value))).toBe(expected);
};

describe("readType/writeType", () => {
	test("canonical spellings round-trip", () => {
		roundTrip('"a"');
		roundTrip('"morphir/SDK:basics#int"');
		roundTrip('{ "Reference": ["morphir/SDK:list#list", "a"] }');
		roundTrip('{ "Tuple": ["morphir/SDK:basics#int", "morphir/SDK:string#string"] }');
		roundTrip('{ "Record": { "name": "morphir/SDK:string#string", "age": "morphir/SDK:basics#int" } }');
		roundTrip('{ "ExtensibleRecord": { "variable": "r", "fields": { "email": "morphir/SDK:string#string" } } }');
		roundTrip('{ "Function": { "argumentType": "morphir/SDK:basics#int", "returnType": "morphir/SDK:string#string" } }');
		roundTrip('{ "Unit": {} }');
	});
	test("accepted spellings normalize to canonical", () => {
		roundTrip('{ "Reference": "morphir/SDK:basics#int" }', '"morphir/SDK:basics#int"');
		roundTrip('{ "Reference": { "fqname": "morphir/SDK:list#list", "args": ["a"] } }', '{ "Reference": ["morphir/SDK:list#list", "a"] }');
		roundTrip('["morphir/SDK:basics#int", "a"]', '{ "Tuple": ["morphir/SDK:basics#int", "a"] }');
		roundTrip('{ "Tuple": { "elements": ["a", "b"] } }', '{ "Tuple": ["a", "b"] }');
	});
	test("a bare array is a Tuple, never a Reference", () => {
		const r = readType(root, json('["morphir/SDK:list#list", "a"]'));
		expect(r.ok && r.value.kind).toBe("Tuple");
	});
	test("renamed members are unknown_member", () => {
		const r = readType(root, json('{ "Function": { "arg": "a", "result": "b" } }'));
		expect(!r.ok && r.error.code).toBe("unknown_member");
		expect(!r.ok && r.error.cursor).toBe("/Function/arg");
	});
	test("deep nesting is a diagnostic, not a thrown stack overflow", () => {
		const text = "[".repeat(20000) + "]".repeat(20000);
		const parsed = parseJson(text);
		const r = parsed.ok ? readType(root, parsed.value) : parsed;
		expect(r).toMatchObject({ ok: false, error: { code: "nesting_too_deep" } });
	});
	test("a tree built in memory is bounded by the cursor guard", () => {
		let deep: JsonValue = [];
		for (let i = 0; i < 2000; i += 1) deep = [deep];
		// The guard reads the cursor's own depth, so a nested read starts where
		// its caller left off; from the root it trips at MAX_DEPTH.
		expect(readType(root, deep)).toMatchObject({ ok: false, error: { code: "nesting_too_deep" } });
		expect(at(root, "x").depth).toBe(1);
	});
	test("attributes produce and read the expanded form", () => {
		const s = '{ "Variable": { "attributes": { "source": { "startLine": 1, "startColumn": 2, "endLine": 3, "endColumn": 4 } }, "name": "a" } }';
		roundTrip(s);
	});
});

describe("specifications and definitions", () => {
	test("opaque spec canonical and legacy", () => {
		for (const s of ['{ "OpaqueTypeSpecification": {} }', '["OpaqueTypeSpecification", []]']) {
			const r = readTypeSpecification(root, json(s));
			expect(r.ok && writeJson(writeTypeSpecification(r.value))).toBe('{ "OpaqueTypeSpecification": {} }');
		}
	});
	test("custom type definition with constructors", () => {
		const s = '{ "CustomTypeDefinition": { "typeParams": ["a"], "access": "Public", "constructors": { "just": [["value", "a"]], "nothing": [] } } }';
		const r = readTypeDefinition(root, json(s));
		expect(r.ok && writeJson(writeTypeDefinition(r.value))).toBe(s);
	});
	test("derived spec", () => {
		const s = '{ "DerivedTypeSpecification": { "typeParams": [], "baseType": "morphir/SDK:string#string", "fromBaseType": "my-org/sdk:local-date#from-string", "toBaseType": "my-org/sdk:local-date#to-string" } }';
		const r = readTypeSpecification(root, json(s));
		expect(r.ok && writeJson(writeTypeSpecification(r.value))).toBe(s);
	});
});
