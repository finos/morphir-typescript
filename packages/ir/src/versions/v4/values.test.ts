// packages/ir/src/versions/v4/values.test.ts
// Hand cases for v4 literal, pattern and value reading and canonical writing; the kit runner covers the rest.
// Run with: bun test packages/ir/src/versions/v4/values.test.ts
import { describe, expect, test } from "bun:test";
import { newRoot } from "../../codec/json/cursor.ts";
import { parseJson, writeJson } from "../../codec/json/value.ts";
import { readType } from "./read-types.ts";
import {
	readLiteral,
	readLiteralShorthand,
	readPattern,
	readValue,
	readValueDefinition,
	readValueSpecification,
	readValueSpecificationWithDoc,
} from "./read-values.ts";
import { writeType } from "./write-types.ts";
import {
	writeLiteral,
	writePattern,
	writeValue,
	writeValueDefinition,
	writeValueSpecification,
} from "./write-values.ts";

const json = (s: string) => { const r = parseJson(s); if (!r.ok) throw new Error(r.error.message); return r.value; };
const rtValue = (s: string, expected = s): void => {
	const r = readValue(newRoot(), json(s));
	expect(r.ok ? "" : r.error.message).toBe("");
	if (r.ok) expect(writeJson(writeValue(r.value))).toBe(expected);
};
const rtPattern = (s: string, expected = s): void => {
	const r = readPattern(newRoot(), json(s));
	expect(r.ok ? "" : r.error.message).toBe("");
	if (r.ok) expect(writeJson(writePattern(r.value))).toBe(expected);
};

describe("literals", () => {
	test("compact, expanded and legacy names", () => {
		for (const s of ['{ "IntegerLiteral": 42 }', '{ "IntegerLiteral": { "value": 42 } }', '{ "WholeNumberLiteral": 42 }']) {
			const r = readLiteral(newRoot(), json(s));
			expect(r.ok && writeJson(writeLiteral(r.value))).toBe('{ "IntegerLiteral": 42 }');
		}
		const d = readLiteral(newRoot(), json('{ "DecimalLiteral": "10.50" }'));
		expect(d.ok && writeJson(writeLiteral(d.value))).toBe('{ "DecimalLiteral": "10.50" }');
		const f = readLiteral(newRoot(), json('{ "FloatLiteral": 0.0 }'));
		expect(f.ok && writeJson(writeLiteral(f.value))).toBe('{ "FloatLiteral": 0.0 }');
	});
	test("a non-integer lexeme is not an IntegerLiteral", () => {
		expect(readLiteral(newRoot(), json('{ "IntegerLiteral": 4.5 }')).ok).toBe(false);
	});
	test("bool, char and string round-trip; a two-character CharLiteral does not", () => {
		for (const s of ['{ "BoolLiteral": true }', '{ "CharLiteral": "A" }', '{ "StringLiteral": "hello" }']) {
			const r = readLiteral(newRoot(), json(s));
			expect(r.ok && writeJson(writeLiteral(r.value))).toBe(s);
		}
		const bad = readLiteral(newRoot(), json('{ "CharLiteral": "AB" }'));
		expect(!bad.ok && bad.error.code).toBe("invalid_literal");
	});
	test("an unknown wrapper key is invalid_literal", () => {
		const r = readLiteral(newRoot(), json('{ "BigIntLiteral": 42 }'));
		expect(!r.ok && r.error.code).toBe("invalid_literal");
	});
	test("the shorthand reader types bare JSON scalars", () => {
		const cases: readonly (readonly [string, string])[] = [
			["true", '{ "BoolLiteral": true }'],
			["42", '{ "IntegerLiteral": 42 }'],
			["2.5", '{ "FloatLiteral": 2.5 }'],
			['"s"', '{ "StringLiteral": "s" }'],
			['{ "FloatLiteral": 3 }', '{ "FloatLiteral": 3.0 }'],
		];
		for (const [input, expected] of cases) {
			const r = readLiteralShorthand(newRoot(), json(input));
			expect(r.ok && writeJson(writeLiteral(r.value))).toBe(expected);
		}
	});
});

describe("values", () => {
	test("literal shorthands normalize to the typed canonical", () => {
		rtValue('{ "Literal": 42 }', '{ "Literal": { "IntegerLiteral": 42 } }');
		rtValue('{ "Literal": { "attributes": {}, "literal": { "IntegerLiteral": 42 } } }', '{ "Literal": { "IntegerLiteral": 42 } }');
		rtValue('{ "Literal": { "attributes": {}, "literal": 0 } }', '{ "Literal": { "IntegerLiteral": 0 } }');
		rtValue('{ "Literal": { "IntegerLiteral": { "value": 42 } } }', '{ "Literal": { "IntegerLiteral": 42 } }');
		rtValue('{ "Literal": { "WholeNumberLiteral": 42 } }', '{ "Literal": { "IntegerLiteral": 42 } }');
		rtValue('{ "Literal": 2.5 }', '{ "Literal": { "FloatLiteral": 2.5 } }');
		rtValue('{ "Literal": true }', '{ "Literal": { "BoolLiteral": true } }');
		rtValue('{ "Literal": "s" }', '{ "Literal": { "StringLiteral": "s" } }');
	});
	test("bare strings are variables or references", () => {
		rtValue('"x"', '{ "Variable": "x" }');
		rtValue('"morphir/SDK:basics#add"', '{ "Reference": "morphir/SDK:basics#add" }');
	});
	test("bare arrays, booleans and numbers are ambiguous", () => {
		for (const s of ["[1, 2, 3]", "true", "42", "2.5"]) {
			const r = readValue(newRoot(), json(s));
			expect(!r.ok && r.error.code).toBe("ambiguous_shorthand");
		}
	});
	test("member names are the schema's", () => {
		rtValue('{ "IfThenElse": { "condition": { "Literal": { "BoolLiteral": true } }, "then": { "Literal": { "IntegerLiteral": 1 } }, "else": { "Literal": { "IntegerLiteral": 2 } } } }');
		rtValue('{ "Field": { "target": { "Variable": "record" }, "name": "field-name" } }');
		const bad = readValue(newRoot(), json('{ "IfThenElse": { "condition": true, "thenBranch": 1, "elseBranch": 2 } }'));
		expect(!bad.ok && bad.error.code).toBe("unknown_member");
		const field = readValue(newRoot(), json('{ "Field": { "subject": { "Variable": "record" }, "fieldName": "field-name" } }'));
		expect(!field.ok && field.error.code).toBe("unknown_member");
	});
	test("an unknown wrapper key is unknown_node", () => {
		const r = readValue(newRoot(), json('{ "Comprehension": { "over": "xs" } }'));
		expect(!r.ok && r.error.code).toBe("unknown_node");
	});
	test("tuple and list forms", () => {
		rtValue('{ "Tuple": { "elements": [{ "Variable": "x" }] } }', '{ "Tuple": [{ "Variable": "x" }] }');
		rtValue('{ "List": { "items": [{ "Variable": "x" }] } }', '{ "List": [{ "Variable": "x" }] }');
		// kit values-0007, canonical and accepted, verbatim
		const tuple = '{ "Tuple": [{ "Variable": "x" }, { "Literal": { "IntegerLiteral": 1 } }] }';
		rtValue(tuple);
		rtValue('{ "Tuple": { "elements": [{ "Variable": "x" }, { "Literal": { "IntegerLiteral": 1 } }] } }', tuple);
		rtValue('{ "Unit": {} }');
	});
	test("the remaining wrappers round-trip in canonical form", () => {
		rtValue('{ "Apply": { "function": { "Reference": "morphir/SDK:basics#negate" }, "argument": { "Literal": { "IntegerLiteral": 1 } } } }');
		rtValue('{ "Constructor": "morphir/SDK:maybe#just" }');
		rtValue('{ "FieldFunction": "name" }');
		rtValue('{ "Record": { "name": { "Variable": "x" }, "age": { "Literal": { "IntegerLiteral": 25 } } } }');
		rtValue('{ "UpdateRecord": { "target": { "Variable": "record" }, "fields": { "name": { "Literal": { "StringLiteral": "new" } } } } }');
		rtValue('{ "Lambda": { "pattern": { "AsPattern": { "pattern": { "WildcardPattern": {} }, "name": "x" } }, "body": { "Variable": "x" } } }');
		rtValue('{ "Destructure": { "pattern": { "WildcardPattern": {} }, "value": { "Variable": "y" }, "in": { "Variable": "x" } } }');
		rtValue('{ "PatternMatch": { "value": { "Variable": "x" }, "cases": [{ "pattern": { "WildcardPattern": {} }, "body": { "Variable": "x" } }] } }');
		const definition = '{ "ExpressionBody": { "inputTypes": {}, "outputType": "morphir/SDK:basics#int", "body": { "Variable": "x" } } }';
		rtValue(`{ "LetDefinition": { "name": "x", "definition": ${definition}, "in": { "Variable": "x" } } }`);
		rtValue(`{ "LetRecursion": { "definitions": { "f": ${definition} }, "in": { "Variable": "f" } } }`);
	});
	test("hole, native, external", () => {
		rtValue('{ "Hole": { "reason": { "UnresolvedReference": { "target": "a/b:c#d" } } } }');
		rtValue('{ "Hole": { "reason": { "DeletedDuringRefactor": { "tx-id": "t1" } } } }');
		rtValue('{ "Hole": { "reason": { "TypeMismatch": { "expected": "int", "found": "string" } }, "expectedType": "morphir/SDK:basics#int" } }');
		rtValue('{ "Native": { "fqname": "morphir/SDK:basics#add", "nativeInfo": { "hint": { "Arithmetic": {} } } } }');
		rtValue('{ "Native": { "fqname": "morphir/SDK:list#map", "nativeInfo": { "hint": { "PlatformSpecific": { "platform": "wasm" } }, "description": "List map" } } }');
		rtValue('{ "External": { "externalName": "console.log", "targetPlatform": "javascript" } }');
	});
	test("value attributes produce and read the expanded form", () => {
		const source = '{ "source": { "startLine": 1, "startColumn": 2, "endLine": 3, "endColumn": 4 } }';
		rtValue(`{ "Variable": { "attributes": ${source}, "name": "x" } }`);
		rtValue(`{ "Reference": { "attributes": ${source}, "fqname": "morphir/SDK:basics#add" } }`);
		rtValue(`{ "Constructor": { "attributes": ${source}, "fqname": "morphir/SDK:maybe#just" } }`);
		rtValue(`{ "FieldFunction": { "attributes": ${source}, "name": "age" } }`);
		rtValue(`{ "Unit": { "attributes": ${source} } }`);
		rtValue(`{ "Tuple": { "attributes": ${source}, "elements": [{ "Variable": "x" }] } }`);
		rtValue(`{ "List": { "attributes": ${source}, "items": [{ "Variable": "x" }] } }`);
		rtValue(`{ "Literal": { "attributes": ${source}, "literal": { "IntegerLiteral": 1 } } }`);
		rtValue(`{ "Apply": { "attributes": ${source}, "function": { "Variable": "f" }, "argument": { "Variable": "x" } } }`);
	});
	test("a record field named attributes forces the expanded form", () => {
		rtValue(
			'{ "Record": { "attributes": {}, "fields": { "attributes": { "Variable": "x" } } } }',
			'{ "Record": { "attributes": {}, "fields": { "attributes": { "Variable": "x" } } } }',
		);
	});
	test("record expanded-form detection reads the whole member set", () => {
		// "attributes" beside another name is a field, so this is a two-field
		// record, and the writer expands it so it reads back the same way.
		rtValue(
			'{ "Record": { "a": { "Variable": "x" }, "attributes": { "Variable": "y" } } }',
			'{ "Record": { "attributes": {}, "fields": { "a": { "Variable": "x" }, "attributes": { "Variable": "y" } } } }',
		);
		// A lone "fields" member is the expanded form, so its payload must be a
		// field map.
		expect(readValue(newRoot(), json('{ "Record": { "fields": "x" } }')))
			.toMatchObject({ ok: false, error: { code: "invalid_type", cursor: "/Record/fields" } });
		rtValue('{ "Record": { "attributes": {}, "fields": { "fields": { "Variable": "x" } } } }');
	});
});

describe("patterns", () => {
	test("tuple pattern forms and literal pattern shorthand", () => {
		const canonical = '{ "TuplePattern": [{ "WildcardPattern": {} }, { "AsPattern": { "pattern": { "WildcardPattern": {} }, "name": "x" } }] }';
		for (const s of [canonical, '[{ "WildcardPattern": {} }, { "AsPattern": { "pattern": { "WildcardPattern": {} }, "name": "x" } }]', '{ "TuplePattern": { "patterns": [{ "WildcardPattern": {} }, { "AsPattern": { "pattern": { "WildcardPattern": {} }, "name": "x" } }] } }']) {
			const r = readPattern(newRoot(), json(s));
			expect(r.ok && writeJson(writePattern(r.value))).toBe(canonical);
		}
		const lp = readPattern(newRoot(), json('{ "LiteralPattern": 42 }'));
		expect(lp.ok && writeJson(writePattern(lp.value))).toBe('{ "LiteralPattern": { "IntegerLiteral": 42 } }');
	});
	test("the remaining pattern wrappers round-trip in canonical form", () => {
		rtPattern('{ "WildcardPattern": {} }');
		rtPattern('{ "EmptyListPattern": {} }');
		rtPattern('{ "UnitPattern": {} }');
		rtPattern('{ "HeadTailPattern": { "head": { "AsPattern": { "pattern": { "WildcardPattern": {} }, "name": "x" } }, "tail": { "AsPattern": { "pattern": { "WildcardPattern": {} }, "name": "xs" } } } }');
		rtPattern('{ "ConstructorPattern": { "fqname": "morphir/SDK:maybe#just", "patterns": [{ "WildcardPattern": {} }] } }');
		rtPattern('{ "LiteralPattern": { "StringLiteral": "hello" } }');
		rtPattern('{ "LiteralPattern": { "attributes": {}, "literal": 42 } }', '{ "LiteralPattern": { "IntegerLiteral": 42 } }');
	});
	test("every pattern wrapper accepts an expanded payload with attributes", () => {
		const source = '{ "source": { "startLine": 1, "startColumn": 2, "endLine": 3, "endColumn": 4 } }';
		rtPattern(`{ "WildcardPattern": { "attributes": ${source} } }`);
		rtPattern(`{ "TuplePattern": { "attributes": ${source}, "patterns": [{ "WildcardPattern": {} }] } }`);
		rtPattern(`{ "LiteralPattern": { "attributes": ${source}, "literal": { "IntegerLiteral": 1 } } }`);
		rtPattern(`{ "AsPattern": { "attributes": ${source}, "pattern": { "WildcardPattern": {} }, "name": "x" } }`);
	});
	test("an unknown pattern wrapper is unknown_node", () => {
		const r = readPattern(newRoot(), json('{ "RegexPattern": {} }'));
		expect(!r.ok && r.error.code).toBe("unknown_node");
	});
});

describe("value definitions and specifications", () => {
	test("expression body round-trips", () => {
		const s = '{ "ExpressionBody": { "inputTypes": { "x": "morphir/SDK:basics#int" }, "outputType": "morphir/SDK:basics#int", "body": { "Variable": "x" } } }';
		const r = readValueDefinition(newRoot(), json(s));
		expect(r.ok && writeJson(writeValueDefinition(r.value))).toBe(s);
	});
	test("native, external and incomplete bodies round-trip", () => {
		for (const s of [
			'{ "NativeBody": { "inputTypes": { "a": "morphir/SDK:basics#int" }, "outputType": "morphir/SDK:basics#int", "nativeInfo": { "hint": { "Arithmetic": {} } } } }',
			'{ "ExternalBody": { "inputTypes": { "msg": "morphir/SDK:string#string" }, "outputType": "morphir/SDK:basics#unit", "externalName": "console.log", "targetPlatform": "javascript" } }',
			'{ "IncompleteBody": { "inputTypes": {}, "outputType": "morphir/SDK:basics#int", "incompleteness": { "Draft": {} } } }',
			'{ "IncompleteBody": { "inputTypes": {}, "incompleteness": { "Hole": { "reason": { "UnresolvedReference": { "target": "a/b:c#d" } } } }, "partialBody": { "Variable": "x" } } }',
		]) {
			const r = readValueDefinition(newRoot(), json(s));
			expect(r.ok ? "" : r.error.message).toBe("");
			if (r.ok) expect(writeJson(writeValueDefinition(r.value))).toBe(s);
		}
	});
	test("inputTypes accepts the legacy pair array", () => {
		const r = readValueDefinition(newRoot(), json('{ "ExpressionBody": { "inputTypes": [["x", "morphir/SDK:basics#int"]], "outputType": "morphir/SDK:basics#int", "body": { "Variable": "x" } } }'));
		expect(r.ok && writeJson(writeValueDefinition(r.value)))
			.toBe('{ "ExpressionBody": { "inputTypes": { "x": "morphir/SDK:basics#int" }, "outputType": "morphir/SDK:basics#int", "body": { "Variable": "x" } } }');
	});
	test("value specification: object map and legacy pairs", () => {
		const canonical = '{ "inputs": { "a": "morphir/SDK:basics#int", "b": "morphir/SDK:basics#int" }, "output": "morphir/SDK:basics#int" }';
		for (const s of [canonical, '{ "inputs": [["a", "morphir/SDK:basics#int"], ["b", "morphir/SDK:basics#int"]], "output": "morphir/SDK:basics#int" }']) {
			const r = readValueSpecification(newRoot(), json(s));
			expect(r.ok && writeJson(writeValueSpecification(r.value))).toBe(canonical);
		}
		const noInputs = readValueSpecification(newRoot(), json('{ "output": "morphir/SDK:basics#int" }'));
		expect(noInputs.ok && writeJson(writeValueSpecification(noInputs.value))).toBe('{ "output": "morphir/SDK:basics#int" }');
	});
	test("doc on a specification is read out of band and never written back", () => {
		const s = '{ "inputs": {}, "output": "morphir/SDK:string#string", "doc": "Returns a greeting" }';
		const r = readValueSpecificationWithDoc(newRoot(), json(s));
		expect(r.ok && r.value.doc).toBe("Returns a greeting");
		expect(r.ok && writeJson(writeValueSpecification(r.value.spec))).toBe('{ "output": "morphir/SDK:string#string" }');
	});
});

describe("record types with a field named attributes", () => {
	test("the type writer expands so the reader round-trips", () => {
		const r = readType(newRoot(), json('{ "Record": { "attributes": {}, "fields": { "attributes": "morphir/SDK:basics#int" } } }'));
		expect(r.ok && writeJson(writeType(r.value)))
			.toBe('{ "Record": { "attributes": {}, "fields": { "attributes": "morphir/SDK:basics#int" } } }');
	});
});
