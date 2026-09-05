// packages/ir/src/versions/v4/attributes.test.ts
// Hand cases for the v4 attribute records: opaque payloads are carried through
// unread and unrounded, and source locations are strict integers.
// Run with: bun test packages/ir/src/versions/v4/attributes.test.ts
import { describe, expect, test } from "bun:test";
import { newRoot } from "../../codec/json/cursor.ts";
import { type JsonValue, parseJson, writeJson } from "../../codec/json/value.ts";
import { readTypeAttributes, writeTypeAttributes } from "./attributes.ts";

const json = (s: string): JsonValue => { const r = parseJson(s); if (!r.ok) throw new Error(r.error.message); return r.value; };

describe("readTypeAttributes/writeTypeAttributes", () => {
	test("opaque payload numbers survive byte for byte", () => {
		// Neither of these survives a trip through a double: the first is past
		// 2^53 and the second would come back as 1.5.
		const s = '{ "constraints": { "c": 12345678901234567890, "d": 1.50 } }';
		const r = readTypeAttributes(newRoot(), json(s));
		expect(r.ok ? "" : r.error.message).toBe("");
		if (!r.ok) return;
		const written = writeTypeAttributes(r.value);
		expect(written === null ? "" : writeJson(written)).toBe(s);
	});
	test("an object that looks like a number stays an object", () => {
		// The payload is the codec's own value tree, so a plain object can never
		// imitate a number lexeme: this comes back as an object, and the writer
		// never splices a non-numeric text into the output.
		const s = '{ "constraints": { "x": { "kind": "number", "text": "hello" } } }';
		const r = readTypeAttributes(newRoot(), json(s));
		expect(r.ok ? "" : r.error.message).toBe("");
		if (!r.ok) return;
		const written = writeTypeAttributes(r.value);
		const text = written === null ? "" : writeJson(written);
		expect(text).toBe(s);
		expect(text).toContain('"kind": "number"');
		expect(parseJson(text).ok).toBe(true);
	});
	test("source locations are strict integers", () => {
		const s = '{ "source": { "startLine": 1, "startColumn": 2, "endLine": 3, "endColumn": 4 } }';
		const r = readTypeAttributes(newRoot(), json(s));
		expect(r.ok && r.value.source).toEqual({ startLine: 1, startColumn: 2, endLine: 3, endColumn: 4 });
		const bad = readTypeAttributes(newRoot(), json('{ "source": { "startLine": 1.5, "startColumn": 2, "endLine": 3, "endColumn": 4 } }'));
		expect(bad).toMatchObject({ ok: false, error: { code: "invalid_type", cursor: "/source/startLine" } });
	});
});
