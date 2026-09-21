// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildMckArtifact, canonicalSourceMap, publishMckManifest, TYPESCRIPT_SPECIFIER, validatePackageFiles } from "./package-mck.ts";
import { parseStableVersion } from "./version.ts";

const root = path.resolve(import.meta.dir, "../..");
const repositoryVersion = parseStableVersion(JSON.parse(await readFile(path.join(root, "packages/mck/package.json"), "utf8")).version).text;
const repositoryArtifactFilename = `finos-morphir-mck-${repositoryVersion}.tgz`;

const exportsMap = { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } as const;
const binMap = { "mck-adapter-typescript": "./dist/adapter.js" } as const;

function sourceManifest(): Record<string, unknown> {
	return {
		name: "@finos/morphir-mck",
		version: "0.0.0",
		private: false,
		type: "module",
		description: "Morphir package implementation helpers and TypeScript adapters. Compatibility runs through the native Morphir CLI.",
		license: "Apache-2.0",
		repository: {
			type: "git",
			url: "git+https://github.com/finos/morphir-typescript.git",
			directory: "packages/mck",
		},
		homepage: "https://github.com/finos/morphir-typescript#readme",
		bugs: "https://github.com/finos/morphir-typescript/issues",
		engines: { node: ">=24", bun: ">=1.2" },
		exports: structuredClone(exportsMap),
		bin: structuredClone(binMap),
		sideEffects: false,
		publishConfig: { access: "public" },
		scripts: { typecheck: "tsc -p tsconfig.json" },
		dependencies: { "@finos/morphir-ir": "workspace:*", "@noble/curves": "2.4.0", ajv: "8.20.0" },
	};
}

describe("canonicalSourceMap", () => {
	test("maps a package source to its stable virtual package path", () => {
		const packageRoot = path.join(root, "packages/mck");
		const mapFile = path.join(root, "stage/dist/index.js.map");
		const input = JSON.stringify({
			version: 3,
			file: "index.js",
			sources: [path.relative(path.dirname(mapFile), path.join(packageRoot, "src/index.ts"))],
			mappings: "AAAA",
		});
		expect(JSON.parse(canonicalSourceMap(input, mapFile, packageRoot))).toEqual({
			version: 3,
			file: "index.js",
			sources: ["morphir-mck:///src/index.ts"],
			mappings: "AAAA",
		});
	});

	test("still rejects a source outside both the package and node_modules", () => {
		const packageRoot = path.join(root, "packages/mck");
		const mapFile = path.join(root, "stage/dist/index.js.map");
		expect(() => canonicalSourceMap('{"version":3,"sources":["../../scripts/release/cli.ts"],"mappings":""}', mapFile, packageRoot)).toThrow(
			"outside packages/mck",
		);
	});
});

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
			engines: { node: ">=24", bun: ">=1.2" },
			exports: exportsMap,
			bin: binMap,
			sideEffects: false,
			files: [
				"dist",
				"protocol.schema.json",
				"protocol.example.json",
				"package-protocol.schema.json",
				"package-report.schema.json",
				"package-resolution-protocol.schema.json",
				"package-resolution-report.schema.json",
				"README.md",
				"LICENSE",
				"NOTICE",
			],
			dependencies: { "@finos/morphir-ir": "0.0.0", "@noble/curves": "2.4.0", ajv: "8.20.0" },
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

		expect(publishMckManifest(source).dependencies).toEqual({ "@finos/morphir-ir": "1.2.3", "@noble/curves": "2.4.0", ajv: "8.20.0" });
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
		const missingRuntimeValidator = { ...sourceManifest(), dependencies: { "@finos/morphir-ir": "workspace:*" }, devDependencies: { ajv: "8.20.0" } };
		expect(() => publishMckManifest(missingRuntimeValidator)).toThrow("dependencies");
	});
});

describe("validatePackageFiles", () => {
	test("rejects retired kit files but ships adapter contracts", () => {
		const kitFile = "package/kit/spec/ir/mck/types.md";
		expect(() => validatePackageFiles([kitFile], new Set(), new Set([kitFile]))).toThrow();
		expect(() => validatePackageFiles(["package/kit.lock.json"], new Set(), new Set(["package/kit.lock.json"]))).toThrow();
		// The adapter protocol contract ships so an installed consumer can read it.
		for (const contract of [
			"package/protocol.schema.json",
			"package/protocol.example.json",
			"package/package-protocol.schema.json",
			"package/package-report.schema.json",
			"package/package-resolution-protocol.schema.json",
			"package/package-resolution-report.schema.json",
		]) {
			expect(() => validatePackageFiles([contract], new Set(), new Set([contract]))).not.toThrow();
		}

		for (const file of [
			"package/src/cli.ts",
			"package/kit/embedded.ts",
			"package/dist/cli.js",
			"package/dist/cli.test.js",
			"package/tsconfig.json",
			"../outside",
		]) {
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

// The artifact build shells out to `bun pm pack`, `tar`, `tsc`, and `node`, and
// installs the two tarballs into a temporary consumer. It is skipped where Bun
// cannot spawn itself, never in CI.
const canBuild = Bun.spawnSync([process.execPath, "--version"]).exitCode === 0;

describe.if(canBuild)("@finos/morphir-mck artifact", () => {
	let output: string;

	test("builds one clean library and adapter tarball with no compatibility runner", async () => {
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
			"package/protocol.schema.json",
			"package/protocol.example.json",
			"package/package-protocol.schema.json",
			"package/package-report.schema.json",
			"package/package-resolution-protocol.schema.json",
			"package/package-resolution-report.schema.json",
			"package/dist/index.js",
			"package/dist/adapter.js",
			"package/dist/index.d.ts",
			"package/dist/adapter.d.ts",
		]) {
			expect(artifact.files).toContain(required);
		}
		expect(artifact.files.some((file) => file.includes("/src/") && !file.startsWith("package/kit/"))).toBe(false);
		expect(artifact.files.some((file) => file.startsWith("package/kit/") || file === "package/kit.lock.json")).toBe(false);
		expect(artifact.files.some((file) => file.includes(".test.") || file.includes("tsconfig") || file.includes("bun.lock"))).toBe(false);

		expect(artifact.files.some((file) => file.includes("/cli."))).toBe(false);
		const adapter = await Bun.$`tar -xOf ${artifact.tarball} package/dist/adapter.js`.text();
		expect(adapter.startsWith("#!/usr/bin/env node")).toBe(true);

		const packedManifest = JSON.parse(await Bun.$`tar -xOf ${artifact.tarball} package/package.json`.text());
		expect(packedManifest).toEqual(publishMckManifest(JSON.parse(await readFile(path.join(root, "packages/mck/package.json"), "utf8"))));
		expect(packedManifest.dependencies).toEqual({ "@finos/morphir-ir": repositoryVersion, "@noble/curves": "2.4.0", ajv: "8.20.0" });

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
