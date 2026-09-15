// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the YAML profile's strict reader (spec S4).
import { describe, expect, test } from "bun:test";
import { parseJson } from "../json/value.ts";
import { parseYaml } from "./parse.ts";

const fail = (text: string) => {
	const r = parseYaml(text);
	if (r.ok) throw new Error(`expected failure for ${JSON.stringify(text)}`);
	return r.error;
};
const value = (text: string) => {
	const r = parseYaml(text);
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

describe("parseYaml scalars", () => {
	test("plain scalars resolve like YAML 1.2 core minus the profile's exclusions", () => {
		expect(value("true")).toBe(true);
		expect(value("null")).toBeNull();
		expect(value("~")).toBeNull();
		expect(value("42")).toEqual({ kind: "number", text: "42" });
		expect(value("-7")).toEqual({ kind: "number", text: "-7" });
		expect(value("1.5e3")).toEqual({ kind: "number", text: "1.5e3" });
		expect(value("a")).toBe("a");
		expect(value("user-ID")).toBe("user-ID");
		expect(value("2026-01-15")).toBe("2026-01-15");
		expect(value("yes")).toBe("yes");
	});
	test("quoted and block scalars are always strings", () => {
		expect(value('"42"')).toBe("42");
		expect(value("'true'")).toBe("true");
		expect(value("|\n  line one\n  line two\n")).toBe("line one\nline two\n");
		expect(value(">\n  folded\n  text\n")).toBe("folded text\n");
	});
	test("float lexemes JSON would refuse are rewritten to the shortest JSON form", () => {
		expect(value(".5")).toEqual({ kind: "number", text: "0.5" });
		expect(value("5.")).toEqual({ kind: "number", text: "5.0" });
		expect(value("+1")).toEqual({ kind: "number", text: "1" });
	});
	test("octal, hex and non-finite numbers are rejected", () => {
		expect(fail("0o17")).toMatchObject({ code: "invalid_literal", stage: "syntax" });
		expect(fail("0x1F")).toMatchObject({ code: "invalid_literal" });
		expect(fail(".inf")).toMatchObject({ code: "invalid_literal", message: "non-finite numbers are not part of the profile" });
		expect(fail("-.inf").code).toBe("invalid_literal");
		expect(fail(".nan").code).toBe("invalid_literal");
	});
});

describe("parseYaml structures", () => {
	test("mappings keep member order and sequences keep item order; equal to parseJson", () => {
		const y = value("formatVersion: 4\ndistribution:\n  Library:\n    packageName: example\n    dependencies: {}\n    def:\n      modules: {}\n");
		const j = parseJson('{ "formatVersion": 4, "distribution": { "Library": { "packageName": "example", "dependencies": {}, "def": { "modules": {} } } } }');
		expect(j.ok && y).toEqual(j.ok ? j.value : null);
	});
	test("flow collections", () => {
		expect(value('Reference: ["morphir/SDK:list#list", a]')).toEqual(value('{ "Reference": ["morphir/SDK:list#list", "a"] }'));
		expect(value("types: [user, user-ID]\nvalues: []\n")).toEqual(value('{ "types": ["user", "user-ID"], "values": [] }'));
	});
	test("comments are ignored", () => {
		expect(value("# leading\na: 1 # trailing\n")).toEqual(value("a: 1"));
	});
});

describe("parseYaml rejections", () => {
	test("zero or several documents", () => {
		expect(fail("")).toMatchObject({ code: "invalid_yaml", message: "expected exactly one document" });
		expect(fail("a: 1\n---\nb: 2\n")).toMatchObject({ code: "invalid_yaml" });
	});
	test("duplicate keys", () => {
		expect(fail("a: 1\na: 2\n")).toMatchObject({ code: "duplicate_member", cursor: "/a", line: 2, column: 1 });
	});
	test("anchors, aliases, tags, merge keys, directives", () => {
		expect(fail("a: &x 1\nb: *x\n")).toMatchObject({ code: "unsupported_yaml_feature", message: "anchors and aliases are not part of the profile" });
		expect(fail("a: !!str 1\n")).toMatchObject({ code: "unsupported_yaml_feature", message: "tags are not part of the profile" });
		expect(fail("a: !custom 1\n").code).toBe("unsupported_yaml_feature");
		expect(fail("base: {x: 1}\nchild:\n  <<: {y: 2}\n")).toMatchObject({ code: "unsupported_yaml_feature", message: "merge keys are not part of the profile" });
		expect(fail("%YAML 1.2\n---\na: 1\n").code).toBe("unsupported_yaml_feature");
	});
	test("non-string keys", () => {
		expect(fail("1: a\n")).toMatchObject({ code: "invalid_type", message: "mapping keys must be strings", cursor: "/" });
		expect(fail("? [a]\n: b\n").code).toBe("invalid_type");
	});
	test("parser errors carry a location", () => {
		const e = fail("a: [1, 2\n");
		expect(e.code).toBe("invalid_yaml");
		expect(e.line).toBeGreaterThan(0);
	});
	test("cursors point at the offending node", () => {
		expect(fail("a:\n  b: [1, 0x2]\n").cursor).toBe("/a/b/1");
	});
});
