// packages/ir/src/codec/json/value.test.ts
// Run with: bun test packages/ir/src/codec/json/value.test.ts
import { describe, expect, test } from "bun:test";
import { isInteger, jsonNumber, jsonObject, parseJson, writeJson } from "./value.ts";

describe("parseJson", () => {
	test("keeps number lexemes and member order", () => {
		const r = parseJson('{ "b": 1e10, "a": -0.50, "n": null, "s": "x\\ny" }');
		expect(r.ok).toBe(true);
		if (r.ok && typeof r.value === "object" && r.value !== null && "kind" in r.value && r.value.kind === "object") {
			expect([...r.value.members.keys()]).toEqual(["b", "a", "n", "s"]);
			expect(r.value.members.get("b")).toEqual({ kind: "number", text: "1e10" });
			expect(r.value.members.get("a")).toEqual({ kind: "number", text: "-0.50" });
			expect(r.value.members.get("s")).toBe("x\ny");
		}
	});
	test("rejects duplicate members with a cursor", () => {
		const r = parseJson('{ "a": 1, "a": 2 }');
		expect(r.ok).toBe(false);
		if (!r.ok) { expect(r.error.code).toBe("duplicate_member"); expect(r.error.cursor).toBe("/a"); }
	});
	test("reports syntax errors with line and column", () => {
		const r = parseJson('{\n  "a": tru }');
		expect(r.ok).toBe(false);
		if (!r.ok) { expect(r.error.code).toBe("invalid_json"); expect(r.error.line).toBe(2); }
	});
	test("rejects trailing content and non-finite numbers", () => {
		expect(parseJson("1 2").ok).toBe(false);
		expect(parseJson("NaN").ok).toBe(false);
	});
	test("bounds nesting instead of exhausting the stack", () => {
		const r = parseJson("[".repeat(20000) + "]".repeat(20000));
		expect(r).toMatchObject({ ok: false, error: { code: "nesting_too_deep" } });
	});
});

describe("writeJson", () => {
	test("canonical one-line style", () => {
		const v = jsonObject([["Reference", ["morphir/SDK:list#list", "a"]], ["n", jsonNumber("42")], ["e", jsonObject([])], ["l", []]]);
		expect(writeJson(v)).toBe('{ "Reference": ["morphir/SDK:list#list", "a"], "n": 42, "e": {}, "l": [] }');
	});
	test("round-trips through parse", () => {
		const text = '{ "a": [1, 2.5, "s", true, null], "b": { "c": {} } }';
		const r = parseJson(text);
		expect(r.ok && writeJson(r.value)).toBe(text);
	});
	test("isInteger", () => {
		expect(isInteger(jsonNumber("42"))).toBe(true);
		expect(isInteger(jsonNumber("-7"))).toBe(true);
		expect(isInteger(jsonNumber("4.0"))).toBe(false);
		expect(isInteger(jsonNumber("1e3"))).toBe(false);
	});
});
