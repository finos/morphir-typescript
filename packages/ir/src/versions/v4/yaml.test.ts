// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The v4 module's YAML surface: the `yaml` codec object, the `profiles` table,
// and the two profile-parameterized entry points the driver uses. The texts are
// the kit's own (types-0003, values-0001, distributions-0002), so a rule that
// drifts from the kit fails here as well as in the driver's round trip.
import { describe, expect, test } from "bun:test";
import { parseJson } from "../../codec/json/value.ts";
import { parseYaml, writeYaml, YAML_PROFILE } from "../../codec/yaml/index.ts";
import { json, type NodeValue, profiles, readNodeCheckedWith, writeNodeWith, yaml } from "./index.ts";

const TYPE_YAML = 'Reference: ["morphir/SDK:list#list", a]\n';
const TYPE_JSON = '{ "Reference": ["morphir/SDK:list#list", "a"] }';
const VALUE_YAML = "Literal:\n  IntegerLiteral: 42\n";
const VALUE_JSON = '{ "Literal": { "IntegerLiteral": 42 } }';
const DOCUMENT_YAML = "formatVersion: 4\ndistribution:\n  Library:\n    packageName: example\n    dependencies: {}\n    def:\n      modules: {}\n";
const DOCUMENT_JSON = '{ "formatVersion": 4, "distribution": { "Library": { "packageName": "example", "dependencies": {}, "def": { "modules": {} } } } }';

const node = (r: ReturnType<typeof yaml.readNode>): NodeValue => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

describe("the v4 yaml codec reads and writes the nodes the json codec does", () => {
	test("readNode agrees with the json codec on a Type and on a Value", () => {
		expect(yaml.readNode("Type", TYPE_YAML)).toEqual(json.readNode("Type", TYPE_JSON));
		expect(yaml.readNode("Value", VALUE_YAML)).toEqual(json.readNode("Value", VALUE_JSON));
	});

	test("writeNode emits the canonical YAML text with one trailing newline", () => {
		expect(yaml.writeNode(node(json.readNode("Type", TYPE_JSON)))).toBe(TYPE_YAML);
		expect(yaml.writeNode(node(json.readNode("Value", VALUE_JSON)))).toBe(VALUE_YAML);
	});

	test("readNodeChecked keeps the warnings and reports none for a canonical spelling", () => {
		const checked = yaml.readNodeChecked("Type", TYPE_YAML);
		if (!checked.ok) throw new Error(checked.error.message);
		expect(checked.value.warnings).toEqual([]);
		expect(checked.value.value).toEqual(node(json.readNode("Type", TYPE_JSON)));
	});

	test("a failed read reports a diagnostic rather than throwing", () => {
		const r = yaml.readNode("Type", "Reference: [\n");
		expect(r.ok).toBe(false);
	});
});

describe("the v4 yaml codec reads and writes whole documents", () => {
	test("read and readChecked agree with the json codec", () => {
		expect(yaml.read(DOCUMENT_YAML)).toEqual(json.read(DOCUMENT_JSON));
		const checked = yaml.readChecked(DOCUMENT_YAML);
		const fromJson = json.read(DOCUMENT_JSON);
		if (!checked.ok) throw new Error(checked.error.message);
		if (!fromJson.ok) throw new Error(fromJson.error.message);
		expect(checked.value.warnings).toEqual([]);
		expect(checked.value.value).toEqual(fromJson.value);
	});

	test("write round-trips the document back to its canonical text", () => {
		const file = yaml.read(DOCUMENT_YAML);
		if (!file.ok) throw new Error(file.error.message);
		expect(yaml.write(file.value)).toBe(DOCUMENT_YAML);
		expect(yaml.read(yaml.write(file.value))).toEqual(file);
	});
});

describe("the profile seam", () => {
	test("readNodeCheckedWith and writeNodeWith over profiles.yaml are the yaml codec", () => {
		expect(readNodeCheckedWith(profiles.yaml, "Type", TYPE_YAML)).toEqual(yaml.readNodeChecked("Type", TYPE_YAML));
		expect(writeNodeWith(profiles.yaml, node(json.readNode("Type", TYPE_JSON)))).toBe(yaml.writeNode(node(json.readNode("Type", TYPE_JSON))));
	});

	test("readNodeCheckedWith and writeNodeWith over profiles.json are the json codec", () => {
		expect(readNodeCheckedWith(profiles.json, "Type", TYPE_JSON)).toEqual(json.readNodeChecked("Type", TYPE_JSON));
		expect(writeNodeWith(profiles.json, node(json.readNode("Type", TYPE_JSON)))).toBe(json.writeNode(node(json.readNode("Type", TYPE_JSON))));
	});

	test("YAML_PROFILE is the reader and the writer under a name and an extension", () => {
		const parsed = parseJson(TYPE_JSON);
		if (!parsed.ok) throw new Error(parsed.error.message);
		expect(YAML_PROFILE.write(parsed.value)).toBe(writeYaml(parsed.value));
		expect(YAML_PROFILE.parse).toBe(parseYaml);
		expect(YAML_PROFILE.parse(TYPE_YAML)).toEqual(parseYaml(TYPE_YAML));
		expect(profiles.yaml).toBe(YAML_PROFILE);
		expect(profiles.yaml.name).toBe("yaml");
		expect(profiles.yaml.extension).toBe(".yaml");
		expect(profiles.json.name).toBe("json");
		expect(profiles.json.extension).toBe(".json");
	});
});
