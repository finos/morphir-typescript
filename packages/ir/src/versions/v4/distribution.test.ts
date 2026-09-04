// packages/ir/src/versions/v4/distribution.test.ts
// Hand cases for whole v4 documents: the root, the access-controlled entries,
// and the module nesting the kit fixes; the kit runner covers the rest.
// Run with: bun test packages/ir/src/versions/v4/distribution.test.ts
import { describe, expect, test } from "bun:test";
import { json } from "./index.ts";

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
			if (r.ok) expect(json.writeNode("AccessControlledTypeDefinition", r.value)).toBe(expected);
		}
	});
	test("a module with a documented type", () => {
		const s = '{ "formatVersion": 4, "distribution": { "Library": { "packageName": "my-org/my-project", "dependencies": {}, "def": { "modules": { "domain": { "Public": { "types": { "user-ID": { "Public": { "doc": "An id", "TypeAliasDefinition": { "typeParams": [], "typeExp": "morphir/SDK:string#string" } } } }, "values": {} } } } } } } }';
		const r = json.read(s);
		expect(r.ok ? "" : r.error.message).toBe("");
		if (r.ok) expect(json.write(r.value)).toBe(s);
	});
});
