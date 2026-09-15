// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the document tree's logical paths: classification, the physical
// boundary (extension in/out), and the module/definition path builders.
// Run with: bun test packages/ir/src/layout/paths.test.ts
import { describe, expect, test } from "bun:test";
import { JSON_PROFILE } from "../codec/profile.ts";
import { YAML_PROFILE } from "../codec/yaml/index.ts";
import { ModuleName, Name, PackageName, Path } from "../model/names.ts";
import { classify, definitionPath, fromPhysical, MANIFEST, moduleDir, modulePath, packageDir, toPhysical, VERSION_SLOT } from "./paths.ts";

function pkg(text: string): PackageName {
	const r = PackageName.parse(text);
	if (!r.ok) throw new Error(`bad package name in test: ${text}`);
	return r.value;
}
function mod(text: string): ModuleName {
	const r = ModuleName.parse(text);
	if (!r.ok) throw new Error(`bad module name in test: ${text}`);
	return r.value;
}

describe("classify", () => {
	test("manifest", () => {
		expect(classify(MANIFEST)).toEqual({ kind: "manifest" });
	});
	test("module under pkg", () => {
		expect(classify("pkg/a/b/module")).toEqual({ kind: "module", root: "pkg", dir: "a/b" });
	});
	test("module under deps", () => {
		expect(classify("deps/a/b/module")).toEqual({ kind: "module", root: "deps", dir: "a/b" });
	});
	test("type under pkg", () => {
		expect(classify("pkg/a/b/x.type")).toEqual({ kind: "type", root: "pkg", dir: "a/b", stem: "x" });
	});
	test("value under deps", () => {
		expect(classify("deps/a/b/x.value")).toEqual({ kind: "value", root: "deps", dir: "a/b", stem: "x" });
	});
	test("anything else is other", () => {
		for (const p of ["", "README", "pkg", "pkg/a", "other/thing", "pkg/a/b/x.unknown"]) {
			expect(classify(p)).toEqual({ kind: "other" });
		}
	});
});

describe("toPhysical / fromPhysical", () => {
	test("toPhysical appends the profile's extension", () => {
		expect(toPhysical("pkg/a/module", JSON_PROFILE)).toBe("pkg/a/module.json");
		expect(toPhysical("pkg/a/module", YAML_PROFILE)).toBe("pkg/a/module.yaml");
	});
	test("fromPhysical strips a known extension", () => {
		expect(fromPhysical("manifest.yaml")).toBe("manifest");
		expect(fromPhysical("pkg/a/module.json")).toBe("pkg/a/module");
		expect(fromPhysical("pkg/a/x.type.yml")).toBe("pkg/a/x.type");
	});
	test("fromPhysical normalizes backslashes to forward slashes", () => {
		expect(fromPhysical("pkg\\a\\module.json")).toBe("pkg/a/module");
	});
	test("fromPhysical returns null for an unknown extension", () => {
		expect(fromPhysical("README.md")).toBeNull();
		expect(fromPhysical("noextension")).toBeNull();
	});
});

describe("modulePath / definitionPath", () => {
	test("modulePath joins escaped package and module segments", () => {
		expect(modulePath("pkg", pkg("my-org-my-project"), mod("domain"))).toBe("pkg/my-org-my-project/domain/module");
	});
	test("modulePath escapes initialisms", () => {
		expect(modulePath("pkg", pkg("my-org"), mod("user-ID"))).toBe("pkg/my-org/user-_id/module");
	});
	test("modulePath under deps carries the version slot after the package path", () => {
		expect(modulePath("deps", pkg("my-org"), mod("domain"))).toBe("deps/my-org/@/domain/module");
	});
	test("definitionPath appends the stem and dotted kind", () => {
		expect(definitionPath("pkg", pkg("my-org"), mod("domain"), "customer", "type")).toBe("pkg/my-org/domain/customer.type");
		expect(definitionPath("deps", pkg("my-org"), mod("domain"), "customer", "value")).toBe("deps/my-org/@/domain/customer.value");
	});
});

describe("packageDir / moduleDir and the version slot (decision 0015)", () => {
	test("packageDir under pkg is just the escaped package path", () => {
		expect(packageDir("pkg", pkg("my-org"))).toBe("my-org");
	});
	test("packageDir under deps appends the bare version slot", () => {
		expect(packageDir("deps", pkg("my-org"))).toBe(`my-org/${VERSION_SLOT}`);
	});
	test("moduleDir under deps nests the module path after the version slot", () => {
		expect(moduleDir("deps", pkg("my-org"), mod("domain"))).toBe("my-org/@/domain");
	});
	test("a package and a longer one that starts with its path never share a deps/ prefix", () => {
		// `a`'s directory is `a/@`; `a/b`'s is `a/b/@`. Without the slot, a module
		// `b/c` of `a` and a module `c` of `a/b` would both live under `a/b/...`
		// and be indistinguishable; the slot makes the two directories disjoint.
		const a = moduleDir("deps", pkg("a"), mod("b/c"));
		const aB = moduleDir("deps", pkg("a/b"), mod("c"));
		expect(a).toBe("a/@/b/c");
		expect(aB).toBe("a/b/@/c");
		expect(a).not.toBe(aB);
		expect(a.startsWith(`${packageDir("deps", pkg("a/b"))}/`)).toBe(false);
		expect(aB.startsWith(`${packageDir("deps", pkg("a"))}/`)).toBe(false);
	});
});

describe("Path/Name reuse sanity", () => {
	test("Path.escaped is what modulePath relies on for initialism escaping", () => {
		const p = Path.parse("user-ID");
		expect(p.ok && Path.escaped(p.value)).toBe("user-_id");
		const n = Name.parse("user-ID");
		expect(n.ok && Name.fileStem(n.value)).toBe("user-_id");
	});
});
