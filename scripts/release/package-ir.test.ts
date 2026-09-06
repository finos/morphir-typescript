// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runReleaseCli } from "./cli.ts";
import { buildIrArtifact, publishManifest, validatePackageFiles } from "./package-ir.ts";

const root = path.resolve(import.meta.dir, "../..");

const exportsMap = {
	".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
	"./model": { types: "./dist/model/index.d.ts", import: "./dist/model/index.js" },
	"./v4": { types: "./dist/versions/v4/index.d.ts", import: "./dist/versions/v4/index.js" },
	"./codec/json": { types: "./dist/codec/json/value.d.ts", import: "./dist/codec/json/value.js" },
} as const;

function sourceManifest(): Record<string, unknown> {
	return {
		name: "@finos/morphir-ir",
		version: "0.0.0",
		private: false,
		type: "module",
		description: "The Morphir IR reference model and codecs: one generic semantic model, pinned version modules, JSON readers and canonical writers.",
		license: "Apache-2.0",
		repository: {
			type: "git",
			url: "git+https://github.com/finos/morphir-typescript.git",
			directory: "packages/ir",
		},
		homepage: "https://github.com/finos/morphir-typescript#readme",
		bugs: "https://github.com/finos/morphir-typescript/issues",
		engines: { node: ">=20", bun: ">=1.2" },
		exports: structuredClone(exportsMap),
		sideEffects: false,
		publishConfig: { access: "public" },
		scripts: { typecheck: "tsc -p tsconfig.json" },
		devDependencies: { "@finos/morphir-mck": "workspace:*" },
	};
}

describe("publishManifest", () => {
	test("keeps exact public metadata and strips repository-only fields", () => {
		const source = sourceManifest();
		const result = publishManifest(source);

		expect(result).toEqual({
			name: "@finos/morphir-ir",
			version: "0.0.0",
			type: "module",
			description: source.description,
			license: "Apache-2.0",
			repository: source.repository,
			homepage: "https://github.com/finos/morphir-typescript#readme",
			bugs: "https://github.com/finos/morphir-typescript/issues",
			engines: { node: ">=20", bun: ">=1.2" },
			exports: exportsMap,
			sideEffects: false,
			files: ["dist", "README.md", "LICENSE", "NOTICE"],
			publishConfig: { access: "public" },
		});
		expect(result).not.toHaveProperty("private");
		expect(result).not.toHaveProperty("scripts");
		expect(result).not.toHaveProperty("devDependencies");
	});

	test("does not mutate the source manifest or retain unknown workspace metadata", () => {
		const source = { ...sourceManifest(), workspaces: ["other"], packageManager: "bun@1.4.2", unexpected: true };
		const before = structuredClone(source);

		const result = publishManifest(source);

		expect(source).toEqual(before);
		expect(result).not.toHaveProperty("workspaces");
		expect(result).not.toHaveProperty("packageManager");
		expect(result).not.toHaveProperty("unexpected");
	});

	test("rejects metadata or exports that do not match the public package contract", () => {
		const source = sourceManifest();
		source.name = "@finos/not-ir";
		expect(() => publishManifest(source)).toThrow("name");

		const wrongExports = sourceManifest();
		wrongExports.exports = { ".": exportsMap["."] };
		expect(() => publishManifest(wrongExports)).toThrow("exports");
	});
});

describe("validatePackageFiles", () => {
	test("rejects repository files, links, traversal, and unexpected file types", () => {
		for (const file of ["package/src/index.ts", "package/dist/index.test.js", "package/tsconfig.json", "../outside", "package/dist/index.css"]) {
			expect(() => validatePackageFiles([file])).toThrow();
		}
		expect(() => validatePackageFiles(["package/dist/index.js"], new Set(["package/dist/index.js"]))).toThrow("link");
	});

	test("rejects an extra JavaScript file even though its extension is publishable", () => {
		const expected = new Set(["package/dist/index.js"]);
		expect(() => validatePackageFiles(["package/dist/index.js", "package/dist/extra.js"], new Set(), expected)).toThrow("unexpected package file");
	});
});

describe("@finos/morphir-ir artifact", () => {
	let output: string;
	let artifact: Awaited<ReturnType<typeof buildIrArtifact>>;

	test("builds one clean tarball and smoke-tests all four installed exports", async () => {
		output = await mkdtemp(path.join(tmpdir(), "morphir-ir-artifact-test-"));
		artifact = await buildIrArtifact(root, output);

		expect(path.isAbsolute(artifact.tarball)).toBe(true);
		expect(path.basename(artifact.tarball)).toBe("finos-morphir-ir-0.0.0.tgz");
		expect(artifact.files).toEqual([...artifact.files].sort());
		for (const required of [
			"package/package.json",
			"package/README.md",
			"package/LICENSE",
			"package/NOTICE",
			"package/dist/index.js",
			"package/dist/model/index.js",
			"package/dist/versions/v4/index.js",
			"package/dist/codec/json/value.js",
			"package/dist/index.d.ts",
			"package/dist/model/index.d.ts",
			"package/dist/versions/v4/index.d.ts",
			"package/dist/codec/json/value.d.ts",
		]) {
			expect(artifact.files).toContain(required);
		}
		expect(artifact.files.some((file) => file.includes("/src/") || file.includes(".test.") || file.includes("tsconfig") || file.includes("bun.lock"))).toBe(
			false,
		);

		const packedManifest = JSON.parse(await Bun.$`tar -xOf ${artifact.tarball} package/package.json`.text());
		expect(packedManifest).toEqual(publishManifest(JSON.parse(await readFile(path.join(root, "packages/ir/package.json"), "utf8"))));
		for (const declaration of artifact.files.filter((file) => file.endsWith(".d.ts"))) {
			const contents = await Bun.$`tar -xOf ${artifact.tarball} ${declaration}`.text();
			expect(contents).not.toMatch(/(?:from\s+|import\s*\()["'][^"']*\.ts["']/);
		}
	}, 60_000);

	afterAll(async () => {
		if (output !== undefined) await rm(output, { recursive: true, force: true });
	});
});

describe("artifact CLI", () => {
	test("resolves one output directory, builds it, and prints the exact tarball", async () => {
		const calls: [string, string][] = [];
		const output: string[] = [];
		const tarball = path.join(root, ".dev/out/cli/finos-morphir-ir-0.0.0.tgz");

		await runReleaseCli(["artifact", ".dev/out/cli"], {
			root,
			stdout: (line) => output.push(line),
			buildArtifact: async (buildRoot, artifactOutput) => {
				calls.push([buildRoot, artifactOutput]);
				return { tarball, files: [] };
			},
		});

		expect(calls).toEqual([[root, path.join(root, ".dev/out/cli")]]);
		expect(output).toEqual([tarball]);
	});

	test("rejects a missing output directory or extra arguments", async () => {
		await expect(runReleaseCli(["artifact"], { root })).rejects.toThrow("Usage:");
		await expect(runReleaseCli(["artifact", "out", "extra"], { root })).rejects.toThrow("Usage:");
	});
});
