// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the in-process Testee: decodes, legacy-spelling warnings, strip
// behavior, diagnostics for bad requests, path agreement, and the two
// unsupported operations this binding does not implement yet.
import { describe, expect, test } from "bun:test";
import { IN_PROCESS_CAPABILITIES, inProcessTestee, resolveNode } from "./in-process.ts";

const t = inProcessTestee();
const decode = (node: string, input: string, extra: Partial<{ strip: boolean; path: "current" | "pinned"; profile: "json" | "yaml"; version: number }> = {}) =>
	t.decode({ op: "decode", version: 4, profile: "json", path: "current", strip: true, node, input, ...extra });

describe("inProcessTestee", () => {
	test("capabilities", async () => {
		expect(await t.capabilities()).toEqual(IN_PROCESS_CAPABILITIES);
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
	test("unknown node names, unsupported versions, and yaml are diagnostics, not throws", async () => {
		expect(await decode("Frob", "{}")).toMatchObject({ ok: false, diagnostic: { code: "unknown_node" } });
		expect(await decode("Type", "{}", { version: 3 })).toMatchObject({ ok: false, diagnostic: { code: "unsupported_version" } });
		expect(await decode("Type", "a: 1", { profile: "yaml" })).toMatchObject({ ok: false, diagnostic: { code: "unsupported_profile" } });
	});
	test("current and pinned paths agree", async () => {
		const input = '{ "Tuple": ["a", "b"] }';
		expect(await decode("Type", input, { path: "current" })).toEqual(await decode("Type", input, { path: "pinned" }));
	});
	test("readTree and writeTree answer unsupported_layout", async () => {
		expect(await t.readTree({ op: "readTree", version: 4, profile: "json", path: "current", strip: true, node: "IRFile", files: [] })).toMatchObject({
			ok: false,
			diagnostic: { code: "unsupported_layout" },
		});
		expect(await t.writeTree({ op: "writeTree", version: 4, path: "current", policy: { profile: "json", pathBudget: 4000 }, input: "{}" })).toMatchObject({
			ok: false,
			diagnostic: { code: "unsupported_layout" },
		});
	});
	test("resolveNode honours the kit's aliases", () => {
		expect(resolveNode("Distribution")).toBe("IRFile");
		expect(resolveNode("Type")).toBe("Type");
		expect(resolveNode("Nope")).toBeNull();
	});
});
