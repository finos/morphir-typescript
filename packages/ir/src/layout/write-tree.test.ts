// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for writing a document tree (S7.3): the kit's `file` sets are the
// bytes, the path budget decides the stems and the `fileNames` map, a Private
// module says so, and the profile is the only thing that decides the text.
// Run with: bun test packages/ir/src/layout/write-tree.test.ts
import { describe, expect, test } from "bun:test";
import { JSON_PROFILE } from "../codec/profile.ts";
import { YAML_PROFILE } from "../codec/yaml/index.ts";
import type { IRFile } from "../model/index.ts";
import type { TA, VA } from "../versions/v4/attributes.ts";
import { yaml } from "../versions/v4/index.ts";
import { canonicalYaml, fileSet } from "./kit-fixtures.test-helper.ts";
import { writeTree } from "./write-tree.ts";

function distributionOf(id: string): IRFile<TA, VA> {
	const r = yaml.read(canonicalYaml(id));
	if (!r.ok) throw new Error(`the kit's canonical does not read: ${r.error.code} ${r.error.message}`);
	return r.value;
}

function fileOf(text: string): IRFile<TA, VA> {
	const r = yaml.read(text);
	if (!r.ok) throw new Error(`fixture does not read: ${r.error.code} ${r.error.message}`);
	return r.value;
}

function written(file: IRFile<TA, VA>, pathBudget: number, profile = YAML_PROFILE): Map<string, string> {
	const r = writeTree(file, { profile, pathBudget });
	if (!r.ok) throw new Error(`writeTree failed: ${r.error.code} ${r.error.message}`);
	return new Map(r.value);
}

describe("writeTree reproduces the kit's file sets", () => {
	test("document-tree-0003 writes the escape set byte for byte", () => {
		expect(written(distributionOf("document-tree-0003"), 4000)).toEqual(fileSet("escape"));
	});

	test("document-tree-0004 writes the truncate set at budget 64", () => {
		const out = written(distributionOf("document-tree-0004"), 64);
		expect(out).toEqual(fileSet("truncate"));
		expect([...out.keys()]).toContain("pkg/my-org/my-project/domain/customer-relati__44a101f8.type");
		expect(out.get("pkg/my-org/my-project/domain/module")).toContain("customer-relationship-management-record: customer-relati__44a101f8");
	});

	test("the manifest comes first, then each module's manifest, its types, then its values", () => {
		expect([...written(distributionOf("document-tree-0003"), 4000).keys()]).toEqual([
			"manifest",
			"pkg/my-org/my-project/domain/module",
			"pkg/my-org/my-project/domain/user-_id.type",
		]);
	});
});

describe("writeTree and the module manifest", () => {
	const privateModule = fileOf(
		[
			"formatVersion: 4",
			"distribution:",
			"  Library:",
			"    packageName: my-org/my-project",
			"    dependencies: {}",
			"    def:",
			"      modules:",
			"        domain:",
			"          Private:",
			"            types: {}",
			"            values: {}",
			"",
		].join("\n"),
	);

	test("a Private module writes access: Private", () => {
		const out = written(privateModule, 4000);
		expect(out.get("pkg/my-org/my-project/domain/module")).toBe("formatVersion: 4\npath: domain\naccess: Private\ntypes: []\nvalues: []\n");
	});

	test("a Public module writes no access member", () => {
		const out = written(distributionOf("document-tree-0005"), 4000);
		expect(out.get("pkg/my-org/my-project/domain/module")).not.toContain("access");
	});
});

describe("writeTree and the path budget", () => {
	test("a budget the module directory itself does not fit fails", () => {
		const r = writeTree(distributionOf("document-tree-0003"), { profile: YAML_PROFILE, pathBudget: 64 });
		expect(r.ok).toBe(true);
		const tight = writeTree(distributionOf("document-tree-0003"), { profile: YAML_PROFILE, pathBudget: 20 });
		expect(tight.ok).toBe(false);
		if (tight.ok) return;
		expect(tight.error.code).toBe("invalid_distribution_shape");
		expect(tight.error.message).toContain("20");
	});

	test("a budget too small for any stem fails", () => {
		const r = writeTree(distributionOf("document-tree-0004"), { profile: YAML_PROFILE, pathBudget: 48 });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.code).toBe("invalid_distribution_shape");
	});
});

describe("writeTree under the JSON profile", () => {
	const file = distributionOf("document-tree-0003");

	test("the logical paths carry no extension and the bodies are JSON", () => {
		const out = written(file, 4000, JSON_PROFILE);
		expect([...out.keys()]).toEqual(["manifest", "pkg/my-org/my-project/domain/module", "pkg/my-org/my-project/domain/user-_id.type"]);
		expect(out.get("manifest")).toBe('{ "formatVersion": 4, "distribution": "Library", "package": "my-org/my-project", "pathBudget": 4000 }');
		expect(out.get("pkg/my-org/my-project/domain/module")).toBe('{ "formatVersion": 4, "path": "domain", "types": ["user-ID"], "values": [] }');
	});

	test("the two profiles lay the same tree out, and only the text differs", () => {
		const asJson = written(file, 4000, JSON_PROFILE);
		const asYaml = written(file, 4000);
		expect([...asJson.keys()]).toEqual([...asYaml.keys()]);
		for (const [logical, text] of asJson) {
			expect(logical).not.toContain(".json");
			expect(JSON_PROFILE.parse(text).ok).toBe(true);
			expect(text).not.toBe(asYaml.get(logical));
		}
	});
});
