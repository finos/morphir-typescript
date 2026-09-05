// packages/ir/src/versions/v4/distribution.test.ts
// Hand cases for whole v4 documents: the root, the access-controlled entries,
// and the module nesting the kit fixes; the kit runner covers the rest.
// Run with: bun test packages/ir/src/versions/v4/distribution.test.ts
import { describe, expect, test } from "bun:test";
import { root } from "../../codec/json/cursor.ts";
import { type JsonValue, parseJson, writeJson } from "../../codec/json/value.ts";
import { json, readNode } from "./index.ts";
import { readModuleSpecification } from "./read-definitions.ts";
import { writeModuleSpecification } from "./write-definitions.ts";

const parse = (s: string): JsonValue => { const r = parseJson(s); if (!r.ok) throw new Error(r.error.message); return r.value; };

describe("json.read / json.write", () => {
	test("empty library round-trips and accepts either root order", () => {
		const canonical = '{ "formatVersion": 4, "distribution": { "Library": { "packageName": "example", "dependencies": {}, "def": { "modules": {} } } } }';
		for (const s of [canonical, '{ "distribution": { "Library": { "packageName": "example" } }, "formatVersion": "4.0.0" }']) {
			const r = json.read(s);
			expect(r.ok ? "" : r.error.message).toBe("");
			if (r.ok) expect(json.write(r.value)).toBe(canonical);
		}
	});
	test("a v3 tagged-array distribution is invalid_distribution_shape", () => {
		const r = json.read('{ "formatVersion": 4, "distribution": ["Library", "example/v4-test", {}, { "modules": [] }] }');
		expect(!r.ok && r.error.code).toBe("invalid_distribution_shape");
	});
	test("4.1.0 is unsupported_format_version_revision; 5 is unsupported major", () => {
		expect(json.read('{ "formatVersion": "4.1.0", "distribution": { "Library": { "packageName": "x" } } }')).toMatchObject({ ok: false, error: { code: "unsupported_format_version_revision" } });
		expect(json.read('{ "formatVersion": 5, "distribution": { "Library": { "packageName": "x" } } }')).toMatchObject({ ok: false, error: { code: "unsupported_format_version_major" } });
	});
	test("three access spellings normalize to the tag form", () => {
		const def = '"TypeAliasDefinition": { "typeParams": [], "typeExp": "morphir/SDK:string#string" }';
		const expected = `{ "Public": { ${def} } }`;
		for (const s of [`{ "Public": { ${def} } }`, `{ "access": "Public", ${def} }`, `{ "access": "Public", "value": { ${def} } }`, `{ "pub": { ${def} } }`]) {
			const r = json.readNode("AccessControlledTypeDefinition", s);
			expect(r.ok ? "" : r.error.message).toBe("");
			if (r.ok) expect(json.writeNode(r.value)).toBe(expected);
		}
	});
	test("the node reader checks the version against the v4 support table", () => {
		// 3 is a format family this module does not read, even though the
		// contract's reference table in format-version.ts still lists 3.0.0.
		expect(readNode("FormatVersion", "3")).toMatchObject({ ok: false, error: { code: "unsupported_format_version_major" } });
		expect(readNode("FormatVersion", "4")).toMatchObject({ ok: true });
	});
	test("a documented value specification reads flat or nested and writes flat", () => {
		const spec = '"inputs": {}, "output": "morphir/SDK:string#string"';
		const canonical = '{ "types": {}, "values": { "greet": { "output": "morphir/SDK:string#string", "doc": "Hi" } } }';
		const flat = `{ "types": {}, "values": { "greet": { ${spec}, "doc": "Hi" } } }`;
		const nested = `{ "types": {}, "values": { "greet": { "doc": "Hi", "value": { ${spec} } } } }`;
		const models = [flat, nested].map((s) => {
			const r = readModuleSpecification(root, parse(s));
			expect(r.ok ? "" : r.error.message).toBe("");
			return r.ok ? r.value : null;
		});
		expect(models[0]).toEqual(models[1]);
		for (const m of models) if (m !== null) expect(writeJson(writeModuleSpecification(m))).toBe(canonical);
	});
	test("a module with a documented type", () => {
		const s = '{ "formatVersion": 4, "distribution": { "Library": { "packageName": "my-org/my-project", "dependencies": {}, "def": { "modules": { "domain": { "Public": { "types": { "user-ID": { "Public": { "doc": "An id", "TypeAliasDefinition": { "typeParams": [], "typeExp": "morphir/SDK:string#string" } } } }, "values": {} } } } } } } }';
		const r = json.read(s);
		expect(r.ok ? "" : r.error.message).toBe("");
		if (r.ok) expect(json.write(r.value)).toBe(s);
	});
});
