// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runReleaseCli } from "./cli.ts";
import { buildIrArtifact, canonicalSourceMap, promoteVerifiedArtifact, publishManifest, runCommand, validatePackageFiles } from "./package-ir.ts";
import { parseStableVersion } from "./version.ts";

const root = path.resolve(import.meta.dir, "../..");
const repositoryVersion = parseStableVersion(JSON.parse(await readFile(path.join(root, "packages/ir/package.json"), "utf8")).version).text;
const repositoryArtifactFilename = `finos-morphir-ir-${repositoryVersion}.tgz`;

const exportsMap = {
	".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
	"./model": { types: "./dist/model/index.d.ts", import: "./dist/model/index.js" },
	"./v4": { types: "./dist/versions/v4/index.d.ts", import: "./dist/versions/v4/index.js" },
	"./codec/json": { types: "./dist/codec/json/value.d.ts", import: "./dist/codec/json/value.js" },
	"./codec/yaml": { types: "./dist/codec/yaml/index.d.ts", import: "./dist/codec/yaml/index.js" },
	"./layout": { types: "./dist/layout/index.d.ts", import: "./dist/layout/index.js" },
	"./layout/node": { types: "./dist/layout/node.d.ts", import: "./dist/layout/node.js" },
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
		dependencies: { yaml: "2.9.1" },
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
			dependencies: { yaml: "2.9.1" },
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

describe("canonicalSourceMap", () => {
	test("replaces checkout-dependent sources with stable virtual package paths", () => {
		const sourceRoot = path.join(root, "packages/ir/src");
		const mapFile = path.join(tmpdir(), "stage/dist/index.js.map");
		const originalSource = path.join(sourceRoot, "index.ts");
		const input = JSON.stringify({
			version: 3,
			file: "index.js",
			sources: [path.relative(path.dirname(mapFile), originalSource)],
			sourcesContent: ["export {};"],
			mappings: "AAAA",
		});

		expect(JSON.parse(canonicalSourceMap(input, mapFile, sourceRoot))).toEqual({
			version: 3,
			file: "index.js",
			sources: ["morphir-ir:///src/index.ts"],
			sourcesContent: ["export {};"],
			mappings: "AAAA",
		});
	});

	test("rejects a source that resolves outside packages/ir/src", () => {
		const sourceRoot = path.join(root, "packages/ir/src");
		const mapFile = path.join(root, "dist/index.js.map");
		expect(() => canonicalSourceMap('{"version":3,"sources":["../secrets.ts"],"mappings":""}', mapFile, sourceRoot)).toThrow("outside packages/ir/src");
	});

	test("rejects a source symlink that escapes packages/ir/src", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "morphir-ir-map-test-"));
		try {
			const sourceRoot = path.join(directory, "packages/ir/src");
			const mapFile = path.join(directory, "dist/index.js.map");
			const outside = path.join(directory, "outside.ts");
			await mkdir(sourceRoot, { recursive: true });
			await writeFile(outside, "export {};\n");
			await symlink(outside, path.join(sourceRoot, "escaped.ts"));
			const source = path.relative(path.dirname(mapFile), path.join(sourceRoot, "escaped.ts"));

			expect(() => canonicalSourceMap(JSON.stringify({ version: 3, sources: [source], mappings: "" }), mapFile, sourceRoot)).toThrow("outside packages/ir/src");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});

describe("runCommand", () => {
	test("reports bounded stdout and stderr when a command fails", async () => {
		const program = 'process.stdout.write("OUT" + "x".repeat(20_000)); process.stderr.write("ERR" + "y".repeat(20_000)); process.exit(7)';
		let failure: Error | undefined;
		try {
			await runCommand([process.execPath, "--eval", program], root);
		} catch (error) {
			failure = error as Error;
		}

		expect(failure?.message).toContain("exit code 7");
		expect(failure?.message).toContain("stdout:\nOUT");
		expect(failure?.message).toContain("stderr:\nERR");
		expect(failure?.message).toContain("truncated");
		expect(failure?.message.length).toBeLessThan(10_000);
	});
});

describe("promoteVerifiedArtifact", () => {
	test("preserves an existing artifact when verification fails", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "morphir-ir-promote-test-"));
		try {
			const staged = path.join(directory, "staged.tgz");
			const final = path.join(directory, "out/artifact.tgz");
			await Bun.write(staged, "unverified");
			await Bun.write(final, "verified");

			await expect(
				promoteVerifiedArtifact(staged, final, async () => {
					throw new Error("verification failed");
				}),
			).rejects.toThrow("verification failed");

			expect(await readFile(final, "utf8")).toBe("verified");
			expect(await readdir(path.dirname(final))).toEqual(["artifact.tgz"]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("atomically replaces the destination only after verification", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "morphir-ir-promote-test-"));
		try {
			const staged = path.join(directory, "staged.tgz");
			const final = path.join(directory, "out/artifact.tgz");
			await writeFile(staged, "new");
			await Bun.write(final, "old");
			let sawOldDestination = false;

			await promoteVerifiedArtifact(staged, final, async () => {
				sawOldDestination = (await readFile(final, "utf8")) === "old";
			});

			expect(sawOldDestination).toBe(true);
			expect(await readFile(final, "utf8")).toBe("new");
			expect(await readdir(path.dirname(final))).toEqual(["artifact.tgz"]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});

describe("@finos/morphir-ir artifact", () => {
	let output: string;
	let artifact: Awaited<ReturnType<typeof buildIrArtifact>>;

	test("builds one clean tarball and smoke-tests all seven installed exports", async () => {
		output = await mkdtemp(path.join(tmpdir(), "morphir-ir-artifact-test-"));
		artifact = await buildIrArtifact(root, output);

		expect(path.isAbsolute(artifact.tarball)).toBe(true);
		expect(path.basename(artifact.tarball)).toBe(repositoryArtifactFilename);
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
			"package/dist/codec/yaml/index.js",
			"package/dist/layout/index.js",
			"package/dist/layout/node.js",
			"package/dist/index.d.ts",
			"package/dist/model/index.d.ts",
			"package/dist/versions/v4/index.d.ts",
			"package/dist/codec/json/value.d.ts",
			"package/dist/codec/yaml/index.d.ts",
			"package/dist/layout/index.d.ts",
			"package/dist/layout/node.d.ts",
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
		const sourceMaps = new Map<string, string>();
		for (const sourceMap of artifact.files.filter((file) => file.endsWith(".map"))) {
			const contents = await Bun.$`tar -xOf ${artifact.tarball} ${sourceMap}`.text();
			sourceMaps.set(sourceMap, contents);
			expect(contents).not.toContain(root);
			const parsed = JSON.parse(contents) as { sources: string[] };
			expect(parsed.sources.every((source) => source.startsWith("morphir-ir:///src/") && !source.includes(".."))).toBe(true);
		}

		const rebuilt = await buildIrArtifact(root, output);
		for (const [sourceMap, contents] of sourceMaps) {
			expect(await Bun.$`tar -xOf ${rebuilt.tarball} ${sourceMap}`.text()).toBe(contents);
		}
	}, 60_000);

	afterAll(async () => {
		if (output !== undefined) await rm(output, { recursive: true, force: true });
	});
});

test("builds the artifact through a symlinked repository root", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "morphir-ir-symlink-build-test-"));
	try {
		const linkedRoot = path.join(directory, "repository");
		await symlink(root, linkedRoot, "dir");
		const artifact = await buildIrArtifact(linkedRoot, path.join(directory, "out"));
		expect(path.basename(artifact.tarball)).toBe(repositoryArtifactFilename);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 60_000);

describe("artifact CLI", () => {
	test("resolves one output directory, builds both packages, and prints the exact tarballs", async () => {
		const calls: [string, string][] = [];
		const mckCalls: [string, string, string][] = [];
		const output: string[] = [];
		const tarball = path.join(root, ".dev/out/cli", repositoryArtifactFilename);
		const mckTarball = path.join(root, ".dev/out/cli", "finos-morphir-mck-0.0.0.tgz");

		await runReleaseCli(["artifact", ".dev/out/cli"], {
			root,
			stdout: (line) => output.push(line),
			buildArtifact: async (buildRoot, artifactOutput) => {
				calls.push([buildRoot, artifactOutput]);
				return { tarball, files: [] };
			},
			buildMckArtifact: async (buildRoot, artifactOutput, irTarball) => {
				mckCalls.push([buildRoot, artifactOutput, irTarball]);
				return { tarball: mckTarball, files: [] };
			},
		});

		expect(calls).toEqual([[root, path.join(root, ".dev/out/cli")]]);
		expect(mckCalls).toEqual([[root, path.join(root, ".dev/out/cli"), tarball]]);
		expect(output).toEqual([tarball, mckTarball]);
	});

	test("rejects a missing output directory or extra arguments", async () => {
		await expect(runReleaseCli(["artifact"], { root })).rejects.toThrow("Usage:");
		await expect(runReleaseCli(["artifact", "out", "extra"], { root })).rejects.toThrow("Usage:");
	});
});
