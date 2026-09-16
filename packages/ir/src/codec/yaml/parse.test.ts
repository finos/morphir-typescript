// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the YAML profile's strict reader (the YAML profile page's "Reader
// restrictions" and "Scalar resolution" sections, docs/spec/ir/schemas/v4/yaml-profile.md
// in finos/morphir).
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
const j = (text: string) => {
	const r = parseJson(text);
	if (!r.ok) throw new Error(r.error.message);
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
	test("a lexeme JSON already accepts passes through unchanged, exponent case included", () => {
		expect(value("1.5E3")).toEqual({ kind: "number", text: "1.5E3" });
		expect(value("42")).toEqual({ kind: "number", text: "42" });
	});
	test("octal, hex and non-finite numbers are rejected", () => {
		expect(fail("0o17")).toMatchObject({ code: "invalid_literal", stage: "syntax" });
		expect(fail("0x1F")).toMatchObject({ code: "invalid_literal" });
		expect(fail(".inf")).toMatchObject({ code: "invalid_literal", message: "non-finite numbers are not part of the profile" });
		expect(fail("-.inf").code).toBe("invalid_literal");
		expect(fail(".nan").code).toBe("invalid_literal");
	});
	test("leading zeros are rejected", () => {
		expect(fail("017")).toMatchObject({ code: "invalid_literal", message: "leading zeros are not part of the profile" });
		expect(fail("007").code).toBe("invalid_literal");
		expect(fail("-00").code).toBe("invalid_literal");
		expect(fail("00.5")).toMatchObject({ code: "invalid_literal", message: "leading zeros are not part of the profile" });
		expect(value("0")).toEqual({ kind: "number", text: "0" });
		expect(value("0.5")).toEqual({ kind: "number", text: "0.5" });
		expect(value("-0")).toEqual({ kind: "number", text: "-0" });
		expect(value("0e3")).toEqual({ kind: "number", text: "0e3" });
	});
});

describe("parseYaml structures", () => {
	test("mappings keep member order and sequences keep item order; equal to parseJson", () => {
		const y = value("formatVersion: 4\ndistribution:\n  Library:\n    packageName: example\n    dependencies: {}\n    def:\n      modules: {}\n");
		expect(y).toEqual(j('{ "formatVersion": 4, "distribution": { "Library": { "packageName": "example", "dependencies": {}, "def": { "modules": {} } } } }'));
	});
	test("flow collections", () => {
		expect(value('Reference: ["morphir/SDK:list#list", a]')).toEqual(j('{ "Reference": ["morphir/SDK:list#list", "a"] }'));
		expect(value("types: [user, user-ID]\nvalues: []\n")).toEqual(j('{ "types": ["user", "user-ID"], "values": [] }'));
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
	test("a %TAG directive is rejected even when it only redefines a default handle", () => {
		expect(fail("%TAG !! tag:example.com,2000:\n---\na: 1\n")).toMatchObject({
			code: "unsupported_yaml_feature",
			message: "directives are not part of the profile",
		});
		expect(fail("%TAG !e! tag:e,2000:\n---\na: 1\n")).toMatchObject({
			code: "unsupported_yaml_feature",
			message: "directives are not part of the profile",
		});
	});
	test("a %YAML directive is rejected with the directives message", () => {
		expect(fail("%YAML 1.2\n---\na: 1\n")).toMatchObject({ code: "unsupported_yaml_feature", message: "directives are not part of the profile" });
	});
	test("a plain scalar containing a literal % is unaffected", () => {
		expect(value("a: 100%\n")).toEqual(j('{ "a": "100%" }'));
	});
	test("a bare document marker and a quoted %TAG are not directives", () => {
		expect(value("---\na: 1\n")).toEqual(j('{ "a": 1 }'));
		expect(value('name: "%TAG"\n')).toEqual(j('{ "name": "%TAG" }'));
	});
	test("non-string keys", () => {
		expect(fail("1: a\n")).toMatchObject({ code: "invalid_type", message: "mapping keys must be strings", cursor: "/" });
		expect(fail("? [a]\n: b\n").code).toBe("invalid_type");
	});
	test("an alias used as a mapping key is rejected as an unsupported feature, not a non-string key", () => {
		// The explicit-key form lets the alias key be visited before its anchor
		// is defined later in the same document, so this exercises the key path
		// rather than the anchor-at-definition rejection covered above.
		expect(fail("? *x\n: 1\na: &x k\n")).toMatchObject({ code: "unsupported_yaml_feature", message: "anchors and aliases are not part of the profile" });
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
