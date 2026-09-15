// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	archiveFiles,
	canonicalizeSourceMaps,
	canonicalSourceMapper,
	isRecord,
	type JsonRecord,
	type PackageIdentity,
	packageFileValidator,
	packStagedPackage,
	promoteVerifiedArtifact,
	rewriteDeclarationImports,
	runCommand,
	verifyExtractedFiles,
} from "./package-common.ts";
import { parseStableVersion } from "./version.ts";

export { promoteVerifiedArtifact, runCommand };

const ENTRYPOINTS = ["index.ts", "model/index.ts", "versions/v4/index.ts", "codec/json/value.ts"] as const;

const IDENTITY: PackageIdentity = { scheme: "morphir-ir", sourceLabel: "packages/ir/src", virtualDirectory: "src" };

export const canonicalSourceMap = canonicalSourceMapper(IDENTITY);

const DESCRIPTION = "The Morphir IR reference model and codecs: one generic semantic model, pinned version modules, JSON readers and canonical writers.";
const REPOSITORY = {
	type: "git",
	url: "git+https://github.com/finos/morphir-typescript.git",
	directory: "packages/ir",
} as const;
const EXPORTS = {
	".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
	"./model": { types: "./dist/model/index.d.ts", import: "./dist/model/index.js" },
	"./v4": { types: "./dist/versions/v4/index.d.ts", import: "./dist/versions/v4/index.js" },
	"./codec/json": { types: "./dist/codec/json/value.d.ts", import: "./dist/codec/json/value.js" },
} as const;
// The one runtime dependency: the YAML profile's reader parses through it. It
// is external to the bundle and declared in the published manifest, as the mck
// package declares its dependency on this one — a bundled copy would put a
// second `yaml` in a consumer's graph and would drag that package's paths into
// our source maps.
const DEPENDENCIES = { yaml: "2.9.1" } as const;
const ROOT_FILES = ["package/package.json", "package/README.md", "package/LICENSE", "package/NOTICE"] as const;
const REQUIRED_FILES = [
	...ROOT_FILES,
	"package/dist/index.js",
	"package/dist/index.js.map",
	"package/dist/model/index.js",
	"package/dist/model/index.js.map",
	"package/dist/versions/v4/index.js",
	"package/dist/versions/v4/index.js.map",
	"package/dist/codec/json/value.js",
	"package/dist/codec/json/value.js.map",
	"package/dist/index.d.ts",
	"package/dist/model/index.d.ts",
	"package/dist/versions/v4/index.d.ts",
	"package/dist/codec/json/value.d.ts",
] as const;

function expectExact(value: unknown, expected: unknown, field: string): void {
	if (!isDeepStrictEqual(value, expected)) throw new Error(`@finos/morphir-ir ${field} does not match the publishing contract`);
}

export function publishManifest(source: JsonRecord): JsonRecord & { readonly exports: typeof EXPORTS } {
	expectExact(source.name, "@finos/morphir-ir", "name");
	if (typeof source.version !== "string") throw new Error("@finos/morphir-ir version must be a stable semantic version");
	parseStableVersion(source.version);
	if (source.private !== undefined && source.private !== false) throw new Error("@finos/morphir-ir must be public");
	expectExact(source.type, "module", "type");
	expectExact(source.description, DESCRIPTION, "description");
	expectExact(source.license, "Apache-2.0", "license");
	expectExact(source.repository, REPOSITORY, "repository");
	expectExact(source.homepage, "https://github.com/finos/morphir-typescript#readme", "homepage");
	expectExact(source.bugs, "https://github.com/finos/morphir-typescript/issues", "bugs");
	expectExact(source.engines, { node: ">=20", bun: ">=1.2" }, "engines");
	expectExact(source.exports, EXPORTS, "exports");
	expectExact(source.sideEffects, false, "sideEffects");
	expectExact(source.publishConfig, { access: "public" }, "publishConfig");
	expectExact(source.dependencies, DEPENDENCIES, "dependencies");

	return {
		name: source.name,
		version: source.version,
		type: source.type,
		description: source.description,
		license: source.license,
		repository: structuredClone(REPOSITORY),
		homepage: source.homepage,
		bugs: source.bugs,
		engines: { node: ">=20", bun: ">=1.2" },
		exports: structuredClone(EXPORTS),
		sideEffects: false,
		files: ["dist", "README.md", "LICENSE", "NOTICE"],
		dependencies: structuredClone(DEPENDENCIES),
		publishConfig: { access: "public" },
	};
}

export const validatePackageFiles = packageFileValidator({ rootFiles: [...ROOT_FILES], defaultExpected: new Set(REQUIRED_FILES) });

function parseManifest(source: string): JsonRecord {
	const parsed: unknown = JSON.parse(source);
	if (!isRecord(parsed)) throw new Error("packages/ir/package.json must contain an object");
	return parsed;
}

// Kept in step with tsconfig.build.json's exclude: a source file the build
// leaves out has no declaration in the archive to expect.
const NOT_PUBLISHED = (name: string): boolean => name.endsWith(".test.ts") || name.endsWith(".test-helper.ts");

async function expectedArchiveFiles(packageRoot: string): Promise<ReadonlySet<string>> {
	const expected = new Set<string>(REQUIRED_FILES);
	const sourceRoot = path.join(packageRoot, "src");
	async function visit(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) await visit(absolute);
			else if (entry.isFile() && entry.name.endsWith(".ts") && !NOT_PUBLISHED(entry.name)) {
				const relative = path.relative(sourceRoot, absolute).split(path.sep).join("/").replace(/\.ts$/, ".d.ts");
				expected.add(`package/dist/${relative}`);
				expected.add(`package/dist/${relative}.map`);
			}
		}
	}
	await visit(sourceRoot);
	return expected;
}

async function smokeTest(tarball: string, compiler: string): Promise<void> {
	const consumer = await mkdtemp(path.join(tmpdir(), "morphir-ir-consumer-"));
	try {
		await Bun.write(path.join(consumer, "package.json"), '{"name":"morphir-ir-artifact-consumer","private":true,"type":"module"}\n');
		await runCommand([process.execPath, "add", "--offline", "--no-save", "--ignore-scripts", "--backend=copyfile", tarball], consumer);
		const specifiers = ["@finos/morphir-ir", "@finos/morphir-ir/model", "@finos/morphir-ir/v4", "@finos/morphir-ir/codec/json"];
		const program = `const specifiers = ${JSON.stringify(specifiers)}; for (const specifier of specifiers) { const resolved = import.meta.resolve(specifier); if (!resolved.includes('/node_modules/@finos/morphir-ir/')) throw new Error('resolved outside installed package: ' + resolved); await import(specifier); }`;
		await runCommand([process.execPath, "--eval", program], consumer);
		const nodeProgram = `if (process.versions.node.split('.')[0] !== '20') throw new Error('expected Node 20, received ' + process.versions.node); ${program}`;
		await runCommand(["node", "--input-type=module", "--eval", nodeProgram], consumer);
		await Bun.write(
			path.join(consumer, "index.ts"),
			[
				'import * as ir from "@finos/morphir-ir";',
				'import * as model from "@finos/morphir-ir/model";',
				'import * as v4 from "@finos/morphir-ir/v4";',
				'import * as json from "@finos/morphir-ir/codec/json";',
				"void [ir, model, v4, json];",
				"",
			].join("\n"),
		);
		await runCommand([compiler, "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "index.ts"], consumer);
	} finally {
		await rm(consumer, { recursive: true, force: true });
	}
}

export async function buildIrArtifact(root: string, outputDirectory: string): Promise<{ readonly tarball: string; readonly files: readonly string[] }> {
	const absoluteRoot = path.resolve(root);
	const output = path.resolve(outputDirectory);
	const packageRoot = path.join(absoluteRoot, "packages/ir");
	const source = parseManifest(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	const manifest = publishManifest(source);
	const version = manifest.version as string;
	const work = await mkdtemp(path.join(tmpdir(), "morphir-ir-pack-"));
	const stage = path.join(work, "package");
	const dist = path.join(stage, "dist");
	try {
		await mkdir(dist, { recursive: true });
		const build = await Bun.build({
			entrypoints: ENTRYPOINTS.map((entrypoint) => path.join(packageRoot, "src", entrypoint)),
			root: path.join(packageRoot, "src"),
			outdir: dist,
			naming: "[dir]/[name].js",
			target: "node",
			format: "esm",
			minify: false,
			sourcemap: "external",
			external: Object.keys(DEPENDENCIES),
		});
		if (!build.success) throw new AggregateError(build.logs, "Bun failed to build @finos/morphir-ir");

		await runCommand(
			[path.join(absoluteRoot, "node_modules/.bin/tsc"), "-p", path.join(packageRoot, "tsconfig.build.json"), "--emitDeclarationOnly", "--outDir", dist],
			absoluteRoot,
		);
		await rewriteDeclarationImports(dist);
		await canonicalizeSourceMaps(canonicalSourceMap, dist, path.join(packageRoot, "src"));
		await Promise.all([
			Bun.write(path.join(stage, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`),
			copyFile(path.join(packageRoot, "README.md"), path.join(stage, "README.md")),
			copyFile(path.join(absoluteRoot, "LICENSE"), path.join(stage, "LICENSE")),
			copyFile(path.join(absoluteRoot, "NOTICE"), path.join(stage, "NOTICE")),
		]);

		const expectedFilename = `finos-morphir-ir-${version}.tgz`;
		const stagedTarball = await packStagedPackage(stage, path.join(work, "packed"), expectedFilename);

		const tarball = path.join(output, expectedFilename);
		const files = await promoteVerifiedArtifact(stagedTarball, tarball, async (candidate) => {
			const candidateFiles = await archiveFiles(validatePackageFiles, candidate, absoluteRoot, await expectedArchiveFiles(packageRoot));
			await verifyExtractedFiles(candidate, candidateFiles, work);
			await smokeTest(candidate, path.join(absoluteRoot, "node_modules/.bin/tsc"));
			return candidateFiles;
		});
		return { tarball, files };
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}
