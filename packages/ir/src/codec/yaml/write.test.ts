// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the YAML profile's canonical writer (spec S5). The kit's YAML
// canonical fences are the authority for these bytes; where a rule below
// differs from the plan's first sketch, the fence that decided it is named.
import { describe, expect, test } from "bun:test";
import { parseJson } from "../json/value.ts";
import { writeYaml } from "./write.ts";

const w = (text: string) => {
	const r = parseJson(text);
	if (!r.ok) throw new Error(r.error.message);
	return writeYaml(r.value);
};

describe("writeYaml", () => {
	test("scalar roots", () => {
		expect(w('"a"')).toBe("a\n");
		expect(w("4")).toBe("4\n");
		// kit types-0002: a `:` not followed by a space and a `#` not preceded by
		// one are not indicators, so an FQName is a plain scalar outside flow.
		expect(w('"morphir/SDK:basics#int"')).toBe("morphir/SDK:basics#int\n");
	});
	test("block mappings, two-space indentation, order preserved, empty mapping inline", () => {
		expect(w('{ "formatVersion": 4, "distribution": { "Library": { "packageName": "example", "dependencies": {}, "def": { "modules": {} } } } }')).toBe(
			"formatVersion: 4\ndistribution:\n  Library:\n    packageName: example\n    dependencies: {}\n    def:\n      modules: {}\n",
		);
	});
	test("flow sequences when no item is a mapping, block sequences otherwise, empty sequence inline", () => {
		expect(w('{ "Reference": ["morphir/SDK:list#list", "a"] }')).toBe('Reference: ["morphir/SDK:list#list", a]\n');
		expect(w('{ "types": ["user", "user-ID"], "values": [] }')).toBe("types: [user, user-ID]\nvalues: []\n");
		expect(w('{ "items": [{ "a": 1 }, { "b": [1, 2] }] }')).toBe("items:\n  - a: 1\n  - b: [1, 2]\n");
		// kit definitions-0003 writes `just: [[value, a]]`: a sequence of
		// sequences of scalars stays in flow.
		expect(w("[1, [2, 3]]")).toBe("[1, [2, 3]]\n");
		expect(w('{ "constructors": { "just": [["value", "a"]], "nothing": [] } }')).toBe("constructors:\n  just: [[value, a]]\n  nothing: []\n");
		expect(w('{ "k": [[{ "a": 1 }]] }')).toBe("k:\n  - - a: 1\n");
	});
	test("quoting: plain unless meaning would change or syntax appears", () => {
		expect(w('{ "k": "true" }')).toBe('k: "true"\n');
		expect(w('{ "k": "42" }')).toBe('k: "42"\n');
		expect(w('{ "k": "" }')).toBe('k: ""\n');
		expect(w('{ "k": "a: b" }')).toBe('k: "a: b"\n');
		expect(w('{ "k": "a #b" }')).toBe('k: "a #b"\n');
		expect(w('{ "k": "-x" }')).toBe('k: "-x"\n');
		expect(w('{ "k": "x:" }')).toBe('k: "x:"\n');
		expect(w('{ "k": "line\\nbreak" }')).toBe('k: "line\\nbreak"\n');
		expect(w('{ "k": "2026-01-15" }')).toBe("k: 2026-01-15\n");
		expect(w('{ "k": "user-ID" }')).toBe("k: user-ID\n");
		expect(w('{ "$meta": 1 }')).toBe("$meta: 1\n");
		expect(w('{ "k": ["a,b", "c"] }')).toBe('k: ["a,b", c]\n');
		expect(w('{ "k": ["morphir/SDK:list#list"] }')).toBe('k: ["morphir/SDK:list#list"]\n');
		// kit definitions-0008: a `:` inside a block mapping value stays plain.
		expect(w('{ "externalName": "math:abs" }')).toBe("externalName: math:abs\n");
		expect(w('{ "morphir/SDK": { "modules": {} } }')).toBe("morphir/SDK:\n  modules: {}\n");
	});
	test("numbers keep their lexeme; booleans and null", () => {
		expect(w('{ "a": 1.50, "b": true, "c": null, "d": -0.0 }')).toBe("a: 1.50\nb: true\nc: null\nd: -0.0\n");
	});
	test("nested block sequence of mappings inside a mapping", () => {
		expect(w('{ "externals": [{ "targetPlatform": "jvm", "externalName": "x" }] }')).toBe("externals:\n  - targetPlatform: jvm\n    externalName: x\n");
	});
});
