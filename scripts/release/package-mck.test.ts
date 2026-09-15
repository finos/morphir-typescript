// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildMckArtifact, checkKitRunReport, publishMckManifest, TYPESCRIPT_SPECIFIER, validatePackageFiles } from "./package-mck.ts";
import { parseStableVersion } from "./version.ts";

const root = path.resolve(import.meta.dir, "../..");
const repositoryVersion = parseStableVersion(JSON.parse(await readFile(path.join(root, "packages/mck/package.json"), "utf8")).version).text;
const repositoryArtifactFilename = `finos-morphir-mck-${repositoryVersion}.tgz`;

const exportsMap = { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } as const;
const binMap = { mck: "./dist/cli.js", "mck-adapter-typescript": "./dist/adapter.js" } as const;

function sourceManifest(): Record<string, unknown> {
	return {
		name: "@finos/morphir-mck",
		version: "0.0.0",
		private: false,
		type: "module",
		description: "The Morphir Compatibility Kit (MCK) driver: runs the kit against any binding through the adapter protocol and writes conformance reports.",
		license: "Apache-2.0",
		repository: {
			type: "git",
			url: "git+https://github.com/finos/morphir-typescript.git",
			directory: "packages/mck",
		},
		homepage: "https://github.com/finos/morphir-typescript#readme",
		bugs: "https://github.com/finos/morphir-typescript/issues",
		engines: { node: ">=20", bun: ">=1.2" },
		exports: structuredClone(exportsMap),
		bin: structuredClone(binMap),
		sideEffects: false,
		publishConfig: { access: "public" },
		scripts: { typecheck: "tsc -p tsconfig.json" },
		dependencies: { "@finos/morphir-ir": "workspace:*" },
	};
}

describe("publishMckManifest", () => {
	test("keeps exact public metadata and strips repository-only fields", () => {
		const source = sourceManifest();
		const result = publishMckManifest(source);

		expect(result).toEqual({
			name: "@finos/morphir-mck",
			version: "0.0.0",
			type: "module",
			description: source.description,
			license: "Apache-2.0",
			repository: source.repository,
			homepage: "https://github.com/finos/morphir-typescript#readme",
			bugs: "https://github.com/finos/morphir-typescript/issues",
			engines: { node: ">=20", bun: ">=1.2" },
			exports: exportsMap,
			bin: binMap,
			sideEffects: false,
			files: ["dist", "kit", "kit.lock.json", "protocol.schema.json", "protocol.example.json", "README.md", "LICENSE", "NOTICE"],
			dependencies: { "@finos/morphir-ir": "0.0.0" },
			publishConfig: { access: "public" },
		});
		expect(result).not.toHaveProperty("private");
		expect(result).not.toHaveProperty("scripts");
		expect(result).not.toHaveProperty("devDependencies");
	});

	test("does not mutate the source manifest or retain unknown workspace metadata", () => {
		const source = { ...sourceManifest(), workspaces: ["other"], packageManager: "bun@1.4.2", unexpected: true };
		const before = structuredClone(source);

		const result = publishMckManifest(source);

		expect(source).toEqual(before);
		expect(result).not.toHaveProperty("workspaces");
		expect(result).not.toHaveProperty("packageManager");
		expect(result).not.toHaveProperty("unexpected");
	});

	test("rewrites the workspace dependency to the exact suite version", () => {
		const source = { ...sourceManifest(), version: "1.2.3" };

		expect(publishMckManifest(source).dependencies).toEqual({ "@finos/morphir-ir": "1.2.3" });
	});

	test("rejects metadata that does not match the public package contract", () => {
		const wrongName = { ...sourceManifest(), name: "@finos/not-mck" };
		expect(() => publishMckManifest(wrongName)).toThrow("name");

		const stillPrivate = { ...sourceManifest(), private: true };
		expect(() => publishMckManifest(stillPrivate)).toThrow("public");

		const wrongEngines = { ...sourceManifest(), engines: { node: ">=18" } };
		expect(() => publishMckManifest(wrongEngines)).toThrow("engines");

		const wrongBin = { ...sourceManifest(), bin: { mck: "./src/cli.ts" } };
		expect(() => publishMckManifest(wrongBin)).toThrow("bin");

		const wrongDependencies = { ...sourceManifest(), dependencies: { "@finos/morphir-ir": "^0.0.1" } };
		expect(() => publishMckManifest(wrongDependencies)).toThrow("dependencies");
	});
});

describe("validatePackageFiles", () => {
	test("publishes the vendored kit verbatim but never the package sources", () => {
		const kitFile = "package/kit/spec/ir/mck/types.md";
		expect(() => validatePackageFiles([kitFile], new Set(), new Set([kitFile]))).not.toThrow();
		expect(() => validatePackageFiles(["package/kit.lock.json"], new Set(), new Set(["package/kit.lock.json"]))).not.toThrow();
		// The adapter protocol contract ships so an installed consumer can read it.
		for (const contract of ["package/protocol.schema.json", "package/protocol.example.json"]) {
			expect(() => validatePackageFiles([contract], new Set(), new Set([contract]))).not.toThrow();
		}

		for (const file of ["package/src/cli.ts", "package/kit/embedded.ts", "package/dist/cli.test.js", "package/tsconfig.json", "../outside"]) {
			expect(() => validatePackageFiles([file], new Set(), new Set([file]))).toThrow();
		}
		expect(() => validatePackageFiles(["package/dist/cli.js"], new Set(["package/dist/cli.js"]), new Set(["package/dist/cli.js"]))).toThrow("link");
	});
});

describe("TYPESCRIPT_SPECIFIER", () => {
	test("catches every import form that can name a repository source", () => {
		for (const source of [
			'import { Kit } from "../../ir/src/index.ts";',
			'export type { Kit } from "./kit.ts";',
			'declare const k: import("./kit.ts").Kit;',
			// A bare side-effect import: no `from`, no parentheses. tsc emits one
			// for a module imported only for its global declarations.
			'import "./globals.ts";',
			"import\t'./globals.ts';",
		]) {
			expect(source).toMatch(TYPESCRIPT_SPECIFIER);
		}
		for (const source of ['import { Kit } from "@finos/morphir-ir";', 'import "@finos/morphir-ir/v4";', 'const path = "kit/spec.ts";']) {
			expect(source).not.toMatch(TYPESCRIPT_SPECIFIER);
		}
	});
});

describe("checkKitRunReport", () => {
	function record(caseId: string, result: string): Record<string, unknown> {
		return { caseId, fenceIndex: 0, profile: "json", role: "canonical", result };
	}
	function report(records: readonly Record<string, unknown>[]): Record<string, unknown> {
		return { contractVersion: 1, binding: "morphir-typescript", language: "typescript", driverVersion: "0.0.1", kitVersion: "abc", records };
	}

	test("accepts a clean run with no failing records", () => {
		expect(() => checkKitRunReport(report([record("types-0001", "pass")]), "r.json")).not.toThrow();
		expect(() => checkKitRunReport(report([record("types-0001", "pass"), record("names-0001", "skipped")]), "r.json")).not.toThrow();
	});

	test("rejects a failing case the allowance does not name", () => {
		const extra = report([record("distributions-0004", "fail"), record("values-0007", "fail")]);

		expect(() => checkKitRunReport(extra, "r.json")).toThrow(/values-0007/);
		expect(() => checkKitRunReport(extra, "r.json")).toThrow("does not allow");
	});

	// The allowance holds the kit's known-bad fences until the resync corrects
	// them; a case in it passes up to its count and no further.
	test("accepts an allowed case up to its count", () => {
		expect(() => checkKitRunReport(report([record("distributions-0004", "fail"), record("distributions-0004", "fail")]), "r.json")).not.toThrow();
		expect(() =>
			checkKitRunReport(report([record("document-tree-0005", "fail"), record("document-tree-0005", "fail"), record("document-tree-0005", "fail")]), "r.json"),
		).not.toThrow();
	});

	test("rejects repeated failures of the same case, kit errors, another binding, and an empty run", () => {
		const tooMany = report([record("values-0007", "fail"), record("values-0007", "fail"), record("values-0007", "fail")]);
		expect(() => checkKitRunReport(tooMany, "r.json")).toThrow(/values-0007 \(3 failing record\(s\), at most 0 allowed\)/);

		expect(() => checkKitRunReport(report([record("types-0001", "kit-error")]), "r.json")).toThrow("kit-error");
		expect(() => checkKitRunReport({ ...report([record("types-0001", "pass")]), binding: "morphir-rust" }, "r.json")).toThrow("morphir-rust");
		expect(() => checkKitRunReport(report([]), "r.json")).toThrow("no records");
		expect(() => checkKitRunReport("not a report", "r.json")).toThrow("report object");
	});
});

// The artifact build shells out to `bun pm pack`, `tar`, `tsc`, and `node`, and
// installs the two tarballs into a temporary consumer. It is skipped where Bun
// cannot spawn itself, never in CI.
const canBuild = Bun.spawnSync([process.execPath, "--version"]).exitCode === 0;

describe.if(canBuild)("@finos/morphir-mck artifact", () => {
	let output: string;

	test("builds one clean tarball with Node shebangs, the vendored kit, and no sources", async () => {
		output = await mkdtemp(path.join(tmpdir(), "morphir-mck-artifact-test-"));
		const ir = await (await import("./package-ir.ts")).buildIrArtifact(root, output);
		const artifact = await buildMckArtifact(root, output, ir.tarball);

		expect(path.isAbsolute(artifact.tarball)).toBe(true);
		expect(path.basename(artifact.tarball)).toBe(repositoryArtifactFilename);
		expect(artifact.files).toEqual([...artifact.files].sort());
		for (const required of [
			"package/package.json",
			"package/README.md",
			"package/LICENSE",
			"package/NOTICE",
			"package/kit.lock.json",
			"package/protocol.schema.json",
			"package/protocol.example.json",
			"package/kit/spec/ir/mck/types.md",
			"package/dist/index.js",
			"package/dist/cli.js",
			"package/dist/adapter.js",
			"package/dist/index.d.ts",
			"package/dist/cli.d.ts",
			"package/dist/adapter.d.ts",
		]) {
			expect(artifact.files).toContain(required);
		}
		expect(artifact.files.some((file) => file.includes("/src/") && !file.startsWith("package/kit/"))).toBe(false);
		expect(artifact.files).not.toContain("package/kit/embedded.ts");
		expect(artifact.files.some((file) => file.includes(".test.") || file.includes("tsconfig") || file.includes("bun.lock"))).toBe(false);

		const cli = await Bun.$`tar -xOf ${artifact.tarball} package/dist/cli.js`.text();
		expect(cli.startsWith("#!/usr/bin/env node")).toBe(true);
		const adapter = await Bun.$`tar -xOf ${artifact.tarball} package/dist/adapter.js`.text();
		expect(adapter.startsWith("#!/usr/bin/env node")).toBe(true);

		const packedManifest = JSON.parse(await Bun.$`tar -xOf ${artifact.tarball} package/package.json`.text());
		expect(packedManifest).toEqual(publishMckManifest(JSON.parse(await readFile(path.join(root, "packages/mck/package.json"), "utf8"))));
		expect(packedManifest.dependencies).toEqual({ "@finos/morphir-ir": repositoryVersion });

		for (const declaration of artifact.files.filter((file) => file.endsWith(".d.ts"))) {
			const contents = await Bun.$`tar -xOf ${artifact.tarball} ${declaration}`.text();
			expect(contents).not.toMatch(TYPESCRIPT_SPECIFIER);
			expect(contents).not.toContain("ir/src/");
		}
		for (const sourceMap of artifact.files.filter((file) => file.endsWith(".map"))) {
			const contents = await Bun.$`tar -xOf ${artifact.tarball} ${sourceMap}`.text();
			expect(contents).not.toContain(root);
			const parsed = JSON.parse(contents) as { sources: string[] };
			expect(parsed.sources.every((source) => source.startsWith("morphir-mck:///") && !source.includes(".."))).toBe(true);
		}
	}, 300_000);

	afterAll(async () => {
		if (output !== undefined) await rm(output, { recursive: true, force: true });
	});
});
