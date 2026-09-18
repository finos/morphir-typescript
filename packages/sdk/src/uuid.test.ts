// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { Just, Nothing } from "./maybe.ts";
import { Err, map, Ok } from "./result.ts";
import * as UUID from "./uuid.ts";

function uuid(s: string): UUID.UUID {
	const parsed = UUID.parse(s);
	if (parsed.kind === "Err") throw new Error(`not a UUID: ${s} (${parsed.error})`);
	return parsed.value;
}

describe("UUID", () => {
	describe("namespace tests", () => {
		test("dns namespace test", () => {
			expect(UUID.toString(UUID.dnsNamespace)).toBe("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
		});
		test("url namespace test", () => {
			expect(UUID.toString(UUID.urlNamespace)).toBe("6ba7b811-9dad-11d1-80b4-00c04fd430c8");
		});
		test("oid namespace test", () => {
			expect(UUID.toString(UUID.oidNamespace)).toBe("6ba7b812-9dad-11d1-80b4-00c04fd430c8");
		});
		test("x500 namespace test", () => {
			expect(UUID.toString(UUID.x500Namespace)).toBe("6ba7b814-9dad-11d1-80b4-00c04fd430c8");
		});
	});

	describe("empty uuid tests", () => {
		test("empty string to string", () => {
			expect(UUID.nilString).toBe("00000000-0000-0000-0000-000000000000");
		});
		test("test is nil string", () => {
			expect(UUID.isNilString(UUID.nilString)).toBe(true);
		});
		test("isNilString accepts the same formats as parse", () => {
			expect(UUID.isNilString("{00000000-0000-0000-0000-000000000000}")).toBe(true);
			expect(UUID.isNilString("urn:uuid:00000000000000000000000000000000")).toBe(true);
			expect(UUID.isNilString("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(false);
			expect(UUID.isNilString("0000")).toBe(false);
			expect(UUID.isNilString("")).toBe(false);
		});
	});

	describe("fromString tests", () => {
		test("from string basic uuid", () => {
			expect(UUID.fromString("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toEqual(Just(UUID.dnsNamespace));
		});
		test("from string invalid uuid", () => {
			expect(UUID.fromString("c72c207b-0847-386d-bdbc-2e5def81cg81")).toBe(Nothing);
		});
		test("fromString incorrect length", () => {
			expect(UUID.fromString("6ba7b811-9dad-11d1-80b4-00c04fd430d80")).toBe(Nothing);
		});
	});

	describe("parse tests", () => {
		test("parse basic uuid", () => {
			expect(UUID.parse("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toEqual(Ok(UUID.dnsNamespace));
		});
		test("parse invalid uuid", () => {
			expect(UUID.parse("c72c207b-0847-386d-bdbc-2e5def81cg81")).toEqual(Err("WrongFormat"));
			expect(UUID.parse("12345678-9abc-4567-89ab-cdefghijklmn")).toEqual(Err("WrongFormat"));
		});
		test("parse incorrect length", () => {
			expect(UUID.parse("6ba7b811-9dad-11d1-80b4-00c04fd430d80")).toEqual(Err("WrongLength"));
			expect(UUID.parse("c72c207b-0847-386d-bdbc-2e5def81cf811")).toEqual(Err("WrongLength"));
			expect(UUID.parse("")).toEqual(Err("WrongLength"));
		});
		test("parse uuid version mapping", () => {
			expect(map(UUID.version, UUID.parse("c72c207b-0847-386d-bdbc-2e5def81cf81"))).toEqual(Ok(3));
		});
		test("the length is examined before the format", () => {
			expect(UUID.parse("zz")).toEqual(Err("WrongLength"));
		});
		test("parse unsupported variant", () => {
			expect(UUID.parse("urn:uuid:12345678-9abc-4567-c234-abcd12345678")).toEqual(Err("UnsupportedVariant"));
			expect(UUID.parse("12345678-9abc-4567-7234-abcd12345678")).toEqual(Err("UnsupportedVariant"));
		});
		test("parse nil", () => {
			expect(UUID.parse("{00000000-0000-0000-0000-000000000000}")).toEqual(Err("IsNil"));
		});
		test("parse no version", () => {
			expect(UUID.parse("6ba7b814-9dad-91d1-80b4-00c04fd430c8")).toEqual(Err("NoVersion"));
			expect(UUID.parse("6ba7b814-9dad-f1d1-80b4-00c04fd430c8")).toEqual(Err("NoVersion"));
		});
		test("the version is examined before the variant", () => {
			expect(UUID.parse("6ba7b814-9dad-91d1-c0b4-00c04fd430c8")).toEqual(Err("NoVersion"));
		});
		test("parse accepts upper case, URN, GUID and compact formats, and additional white space and hyphens", () => {
			const expected = Ok(UUID.dnsNamespace);
			expect(UUID.parse("6BA7B810-9DAD-11D1-80B4-00C04FD430C8")).toEqual(expected);
			expect(UUID.parse("urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toEqual(expected);
			expect(UUID.parse("URN:UUID:6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toEqual(expected);
			expect(UUID.parse("{6ba7b810-9dad-11d1-80b4-00c04fd430c8}")).toEqual(expected);
			expect(UUID.parse("6ba7b8109dad11d180b400c04fd430c8")).toEqual(expected);
			expect(UUID.parse(" 6ba7b810 - 9dad-11d1-80b4\t00c04fd430c8\n")).toEqual(expected);
			expect(UUID.parse("6-b-a-7-b-8109dad11d180b400c04fd430c8--")).toEqual(expected);
		});
		test("the result is the canonical lower-case text", () => {
			expect(UUID.toString(uuid("{6BA7B8109DAD11D180B400C04FD430C8}"))).toBe("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
		});
		test("versions 1 to 8 are accepted", () => {
			for (const v of [1, 2, 3, 4, 5, 6, 7, 8]) {
				expect(map(UUID.version, UUID.parse(`6ba7b814-9dad-${v}1d1-80b4-00c04fd430c8`))).toEqual(Ok(v));
			}
		});
	});

	describe("forName tests", () => {
		test("forName dnsNamespace test", () => {
			expect(UUID.toString(UUID.forName("foo", UUID.dnsNamespace))).toBe("b84ed8ed-a7b1-502f-83f6-90132e68adef");
		});
		test("forName urlNamespace test", () => {
			expect(UUID.toString(UUID.forName("foo", UUID.urlNamespace))).toBe("7da78284-2f14-5e7f-95e1-baaa9027c26f");
		});
		test("forName oidNamespace test", () => {
			expect(UUID.toString(UUID.forName("foo", UUID.oidNamespace))).toBe("bca95adb-b5f1-564f-96a7-6355c52d1fa7");
		});
		test("forName x500Namespace test", () => {
			expect(UUID.toString(UUID.forName("foo", UUID.x500Namespace))).toBe("a2dfac7d-e8aa-556e-b751-a37169330d23");
		});
		test("known version 5 vectors", () => {
			expect(UUID.toString(UUID.forName("www.example.com", UUID.dnsNamespace))).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
			expect(UUID.toString(UUID.forName("python.org", UUID.dnsNamespace))).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
			expect(UUID.toString(UUID.forName("", UUID.dnsNamespace))).toBe("4ebd0208-8328-5d69-8c44-ec50939c0967");
		});
		test("the name is encoded as UTF-8", () => {
			expect(UUID.toString(UUID.forName("https://finos.org/mörphir/✓", UUID.urlNamespace))).toBe("1646c8f5-96a0-58bc-ada0-7a2015fdb77c");
		});
		test("a result can be a namespace (the TSFoster/elm-uuid examples)", () => {
			const apiNamespace = UUID.forName("https://api.example.com/v2/", UUID.dnsNamespace);
			expect(UUID.toString(apiNamespace)).toBe("bad122ad-b5b6-527c-b544-4406328d8b13");
			expect(UUID.toString(UUID.forName("Widget", apiNamespace))).toBe("7b0db628-d793-550b-a883-937a276f4908");
		});
		test("the result is version 5, and parse accepts it", () => {
			const made = UUID.forName("foo", UUID.dnsNamespace);
			expect(UUID.version(made)).toBe(5);
			expect(UUID.parse(UUID.toString(made))).toEqual(Ok(made));
		});
	});

	describe("version", () => {
		test("the namespaces are version 1", () => {
			expect(UUID.version(UUID.dnsNamespace)).toBe(1);
		});
		test("version 4", () => {
			expect(UUID.version(uuid("e1631449-6321-4a58-920c-5440029b092e"))).toBe(4);
		});
	});

	describe("compare", () => {
		test("orders as the 128-bit number does", () => {
			expect(UUID.compare(UUID.dnsNamespace, UUID.dnsNamespace)).toBe("EQ");
			expect(UUID.compare(UUID.dnsNamespace, UUID.urlNamespace)).toBe("LT");
			expect(UUID.compare(UUID.x500Namespace, UUID.oidNamespace)).toBe("GT");
			expect(UUID.compare(uuid("0fffffff-ffff-4fff-bfff-ffffffffffff"), uuid("a0000000-0000-4000-8000-000000000000"))).toBe("LT");
			expect(UUID.compare(uuid("f0000000-0000-4000-8000-000000000000"), uuid("7fffffff-ffff-4fff-bfff-ffffffffffff"))).toBe("GT");
		});
	});
});
