// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the in-process Testee: decodes in both profiles, legacy-spelling
// warnings, strip behavior, diagnostics for bad requests, path agreement, and
// the document tree read and written back.
import { describe, expect, test } from "bun:test";
import { SUPPORT_TABLE_TEXT } from "../../../ir/src/versions/v4/read-distribution.ts";
import { IN_PROCESS_CAPABILITIES, inProcessTestee, resolveNode } from "./in-process.ts";

const t = inProcessTestee();
const decode = (node: string, input: string, extra: Partial<{ strip: boolean; path: "current" | "pinned"; profile: "json" | "yaml"; version: number }> = {}) =>
	t.decode({ op: "decode", version: 4, profile: "json", path: "current", strip: true, node, input, ...extra });

describe("inProcessTestee", () => {
	test("capabilities", async () => {
		expect(await t.capabilities()).toEqual(IN_PROCESS_CAPABILITIES);
	});
	// The capabilities reply repeats the table literal rather than importing it:
	// `read-distribution.ts` is not one of the IR entry points the packaging step
	// rewrites, so `in-process.ts` may not name it. This test is what keeps the
	// copy honest — the reader and the claim must say the same releases.
	test("capabilities declares the same support table the v4 reader enforces", async () => {
		expect((await t.capabilities()).formatVersions).toBe(SUPPORT_TABLE_TEXT);
	});
	test("capabilities declares every node kind and alias it decodes", async () => {
		const caps = await t.capabilities();
		expect(caps.nodes).toContain("Type");
		expect(caps.nodes).toContain("IRFile");
		expect(caps.nodes).toContain("Distribution"); // the kit alias for IRFile
		expect(caps.nodes).toContain("DistributionManifestFile");
		expect(caps.profiles).toEqual(["json", "yaml"]);
		expect(caps.layouts).toEqual(["single", "tree"]);
	});
	test("decodes a Type and returns its canonical JSON, kind, and no warnings", async () => {
		const r = await decode("Type", '{ "Reference": { "fqname": "morphir/SDK:list#list", "args": ["a"] } }');
		expect(r).toEqual({ ok: true, kind: "Reference", canonical: { json: '{ "Reference": ["morphir/SDK:list#list", "a"] }' }, warnings: [] });
	});
	test("reports legacy spellings as warnings with cursors", async () => {
		const r = await decode("Type", '{ "Function": { "arg": "a", "returnType": "b" } }');
		expect(r.ok).toBeTrue();
		if (r.ok) expect(r.warnings).toEqual([{ code: "legacy_spelling", cursor: "/Function/arg" }]);
	});
	test("strip=false keeps attributes in the canonical", async () => {
		const stripped = await decode("Value", '{ "Unit": { "attributes": { "extensions": { "doc": "x" } } } }', { strip: true });
		const kept = await decode("Value", '{ "Unit": { "attributes": { "extensions": { "doc": "x" } } } }', { strip: false });
		expect(stripped).not.toEqual(kept);
	});
	test("returns the reader's diagnostic on a rejected spelling", async () => {
		const r = await decode("Type", '{ "Variable": { "attributes": {}, "attrs": {}, "name": "a" } }');
		expect(r).toMatchObject({ ok: false, diagnostic: { code: "unknown_member", stage: "normalization", cursor: "/Variable/attrs" } });
	});
	test("unknown node names and unsupported versions are diagnostics, not throws", async () => {
		expect(await decode("Frob", "{}")).toMatchObject({ ok: false, diagnostic: { code: "unknown_node" } });
		expect(await decode("Type", "{}", { version: 3 })).toMatchObject({ ok: false, diagnostic: { code: "unsupported_version" } });
	});
	test("decodes a yaml Type and answers the yaml canonical, not the json one", async () => {
		const r = await decode("Type", 'Reference: ["morphir/SDK:list#list", a]\n', { profile: "yaml" });
		expect(r).toEqual({ ok: true, kind: "Reference", canonical: { yaml: 'Reference: ["morphir/SDK:list#list", a]\n' }, warnings: [] });
	});
	test("a yaml syntax error is the profile's diagnostic, not a throw", async () => {
		expect(await decode("Type", "&a *b\n", { profile: "yaml" })).toMatchObject({ ok: false, diagnostic: { stage: "syntax" } });
	});
	test("current and pinned paths agree", async () => {
		const input = '{ "Tuple": ["a", "b"] }';
		expect(await decode("Type", input, { path: "current" })).toEqual(await decode("Type", input, { path: "pinned" }));
	});
	// document-tree-0003's `escape` set and its canonical fence, verbatim: the
	// tree and the single document are two spellings of one distribution, so a
	// read of the set must answer exactly what a decode of the canonical does.
	const ESCAPE_SET: readonly { path: string; content: string }[] = [
		{ path: "manifest", content: ["formatVersion: 4", "distribution: Library", "package: my-org/my-project", "pathBudget: 4000", ""].join("\n") },
		{
			path: "pkg/my-org/my-project/domain/module",
			content: ["formatVersion: 4", "path: domain", "types: [user-ID]", "values: []", ""].join("\n"),
		},
		{
			path: "pkg/my-org/my-project/domain/user-_id.type",
			content: [
				"formatVersion: 4",
				"name: user-ID",
				"def:",
				"  Public:",
				"    doc: The user's identifier",
				"    TypeAliasDefinition:",
				"      typeParams: []",
				"      typeExp: morphir/SDK:string#string",
				"",
			].join("\n"),
		},
	];
	const ESCAPE_CANONICAL = [
		"formatVersion: 4",
		"distribution:",
		"  Library:",
		"    packageName: my-org/my-project",
		"    dependencies: {}",
		"    def:",
		"      modules:",
		"        domain:",
		"          Public:",
		"            types:",
		"              user-ID:",
		"                Public:",
		"                  doc: The user's identifier",
		"                  TypeAliasDefinition:",
		"                    typeParams: []",
		"                    typeExp: morphir/SDK:string#string",
		"            values: {}",
		"",
	].join("\n");

	test("readTree answers the same canonical a decode of the single document does", async () => {
		const tree = await t.readTree({ op: "readTree", version: 4, profile: "yaml", path: "current", strip: true, node: "Distribution", files: ESCAPE_SET });
		expect(tree).toEqual({ ok: true, kind: "Library", canonical: { yaml: ESCAPE_CANONICAL }, warnings: [] });
		expect(tree).toEqual(await decode("Distribution", ESCAPE_CANONICAL, { profile: "yaml" }));
	});
	test("writeTree reproduces the set the canonical was read from", async () => {
		const w = await t.writeTree({
			op: "writeTree",
			version: 4,
			path: "current",
			policy: { profile: "yaml", pathBudget: 4000 },
			input: ESCAPE_CANONICAL,
		});
		expect(w.ok).toBeTrue();
		if (w.ok) expect([...w.files].sort((a, b) => a.path.localeCompare(b.path))).toEqual([...ESCAPE_SET].sort((a, b) => a.path.localeCompare(b.path)));
	});
	test("a tree missing its manifest is the reader's diagnostic, not unsupported_layout", async () => {
		expect(await t.readTree({ op: "readTree", version: 4, profile: "json", path: "current", strip: true, node: "IRFile", files: [] })).toMatchObject({
			ok: false,
			diagnostic: { code: "missing_member", cursor: "manifest" },
		});
	});
	test("writeTree reports an unreadable input as a diagnostic", async () => {
		expect(await t.writeTree({ op: "writeTree", version: 4, path: "current", policy: { profile: "json", pathBudget: 4000 }, input: "{}" })).toMatchObject({
			ok: false,
		});
	});
	test("the tree operations agree on current and pinned", async () => {
		const req = { op: "readTree", version: 4, profile: "yaml", strip: true, node: "Distribution", files: ESCAPE_SET } as const;
		expect(await t.readTree({ ...req, path: "current" })).toEqual(await t.readTree({ ...req, path: "pinned" }));
	});
	test("resolveNode honours the kit's aliases", () => {
		expect(resolveNode("Distribution")).toBe("IRFile");
		expect(resolveNode("Type")).toBe("Type");
		expect(resolveNode("Nope")).toBeNull();
	});
});
