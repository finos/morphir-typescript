// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseStableVersion } from "./version.ts";

const ENTRYPOINTS = ["index.ts", "model/index.ts", "versions/v4/index.ts", "codec/json/value.ts"] as const;

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
const REQUIRED_FILES = [
	"package/package.json",
	"package/README.md",
	"package/LICENSE",
	"package/NOTICE",
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

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

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
		publishConfig: { access: "public" },
	};
}

function allowedPackageFile(file: string): boolean {
	if (["package/package.json", "package/README.md", "package/LICENSE", "package/NOTICE"].includes(file)) return true;
	if (!file.startsWith("package/dist/")) return false;
	if (file.includes(".test.")) return false;
	return /\.(?:js|js\.map|d\.ts|d\.ts\.map)$/.test(file);
}

export function validatePackageFiles(
	files: readonly string[],
	links: ReadonlySet<string> = new Set(),
	expectedFiles: ReadonlySet<string> = new Set(REQUIRED_FILES),
): void {
	if (links.size > 0) throw new Error(`package contains a link: ${[...links][0]}`);
	const unique = new Set<string>();
	for (const file of files) {
		if (file.includes("\\") || file.startsWith("/") || file.split("/").includes("..")) throw new Error(`unsafe package path: ${file}`);
		if (!allowedPackageFile(file)) throw new Error(`unexpected package file: ${file}`);
		if (!expectedFiles.has(file)) throw new Error(`unexpected package file: ${file}`);
		if (unique.has(file)) throw new Error(`duplicate package file: ${file}`);
		unique.add(file);
	}
	for (const file of expectedFiles) if (!unique.has(file)) throw new Error(`package is missing ${file}`);
}

async function run(command: readonly string[], cwd: string): Promise<string> {
	const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (exitCode !== 0) {
		const detail = stderr.trim();
		throw new Error(`${command[0]} failed with exit code ${exitCode}${detail === "" ? "" : `: ${detail}`}`);
	}
	return stdout.trim();
}

function parseManifest(source: string): JsonRecord {
	const parsed: unknown = JSON.parse(source);
	if (!isRecord(parsed)) throw new Error("packages/ir/package.json must contain an object");
	return parsed;
}

async function expectedArchiveFiles(packageRoot: string): Promise<ReadonlySet<string>> {
	const expected = new Set<string>(REQUIRED_FILES);
	const sourceRoot = path.join(packageRoot, "src");
	async function visit(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) await visit(absolute);
			else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
				const relative = path.relative(sourceRoot, absolute).split(path.sep).join("/").replace(/\.ts$/, ".d.ts");
				expected.add(`package/dist/${relative}`);
				expected.add(`package/dist/${relative}.map`);
			}
		}
	}
	await visit(sourceRoot);
	return expected;
}

async function declarationFiles(directory: string): Promise<readonly string[]> {
	const files: string[] = [];
	async function visit(current: string): Promise<void> {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const absolute = path.join(current, entry.name);
			if (entry.isDirectory()) await visit(absolute);
			else if (entry.isFile() && entry.name.endsWith(".d.ts")) files.push(absolute);
		}
	}
	await visit(directory);
	return files;
}

async function rewriteDeclarationImports(dist: string): Promise<void> {
	for (const file of await declarationFiles(dist)) {
		const contents = await readFile(file, "utf8");
		const updated = contents
			.replaceAll(/(\bfrom\s*["'])(\.[^"'\r\n]+)\.ts(["'])/g, "$1$2.js$3")
			.replaceAll(/(\b(?:import|require)\s*\(\s*["'])(\.[^"'\r\n]+)\.ts(["'])/g, "$1$2.js$3")
			.replaceAll(/(\bimport\s*["'])(\.[^"'\r\n]+)\.ts(["'])/g, "$1$2.js$3");
		if (updated === contents) continue;
		await Bun.write(file, updated);
	}
}

async function archiveFiles(tarball: string, cwd: string, expectedFiles: ReadonlySet<string>): Promise<readonly string[]> {
	const listing = await run(["tar", "-tzf", tarball], cwd);
	const files = listing.split(/\r?\n/).filter((file) => file !== "");
	const verbose = (await run(["tar", "-tvzf", tarball], cwd)).split(/\r?\n/).filter((line) => line !== "");
	if (verbose.length !== files.length) throw new Error("could not verify every package archive entry");
	const links = new Set<string>();
	for (const [index, line] of verbose.entries()) {
		const kind = line[0];
		if (kind !== "-") links.add(files[index] as string);
	}
	validatePackageFiles(files, links, expectedFiles);
	return [...files].sort();
}

async function verifyExtractedFiles(tarball: string, files: readonly string[], work: string): Promise<void> {
	const extracted = path.join(work, "inspect");
	await mkdir(extracted);
	await run(["tar", "-xzf", tarball, "-C", extracted], work);
	const found: string[] = [];
	async function walk(directory: string): Promise<void> {
		for (const name of await readdir(directory)) {
			const absolute = path.join(directory, name);
			const info = await lstat(absolute);
			if (info.isSymbolicLink()) throw new Error(`package contains a link: ${path.relative(extracted, absolute)}`);
			if (info.isDirectory()) await walk(absolute);
			else if (info.isFile()) found.push(path.relative(extracted, absolute).split(path.sep).join("/"));
			else throw new Error(`package contains a non-regular file: ${path.relative(extracted, absolute)}`);
		}
	}
	await walk(extracted);
	if (JSON.stringify(found.sort()) !== JSON.stringify(files)) throw new Error("extracted package contents do not match its archive listing");
}

async function smokeTest(tarball: string, compiler: string): Promise<void> {
	const consumer = await mkdtemp(path.join(tmpdir(), "morphir-ir-consumer-"));
	try {
		await Bun.write(path.join(consumer, "package.json"), '{"name":"morphir-ir-artifact-consumer","private":true,"type":"module"}\n');
		await run([process.execPath, "add", "--offline", "--no-save", "--ignore-scripts", "--backend=copyfile", tarball], consumer);
		const specifiers = ["@finos/morphir-ir", "@finos/morphir-ir/model", "@finos/morphir-ir/v4", "@finos/morphir-ir/codec/json"];
		const program = `const specifiers = ${JSON.stringify(specifiers)}; for (const specifier of specifiers) { const resolved = import.meta.resolve(specifier); if (!resolved.includes('/node_modules/@finos/morphir-ir/')) throw new Error('resolved outside installed package: ' + resolved); await import(specifier); }`;
		await run([process.execPath, "--eval", program], consumer);
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
		await run([compiler, "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "index.ts"], consumer);
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
		});
		if (!build.success) throw new AggregateError(build.logs, "Bun failed to build @finos/morphir-ir");

		await run(
			[path.join(absoluteRoot, "node_modules/.bin/tsc"), "-p", path.join(packageRoot, "tsconfig.build.json"), "--emitDeclarationOnly", "--outDir", dist],
			absoluteRoot,
		);
		await rewriteDeclarationImports(dist);
		await Promise.all([
			Bun.write(path.join(stage, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`),
			copyFile(path.join(packageRoot, "README.md"), path.join(stage, "README.md")),
			copyFile(path.join(absoluteRoot, "LICENSE"), path.join(stage, "LICENSE")),
			copyFile(path.join(absoluteRoot, "NOTICE"), path.join(stage, "NOTICE")),
		]);

		await mkdir(output, { recursive: true });
		const expectedFilename = `finos-morphir-ir-${version}.tgz`;
		const report = await run([process.execPath, "pm", "pack", "--destination", output, "--ignore-scripts", "--quiet"], stage);
		const reportedFilename = report.split(/\r?\n/).filter(Boolean).at(-1);
		if (reportedFilename === undefined) throw new Error("bun pm pack did not report an artifact");
		if (path.basename(reportedFilename) !== expectedFilename) throw new Error(`bun pm pack reported an unexpected artifact: ${reportedFilename}`);
		const tarball = path.join(output, path.basename(reportedFilename));
		const packed = await lstat(tarball).catch(() => undefined);
		if (packed === undefined || !packed.isFile()) throw new Error(`bun pm pack did not create ${tarball}`);

		const files = await archiveFiles(tarball, absoluteRoot, await expectedArchiveFiles(packageRoot));
		await verifyExtractedFiles(tarball, files, work);
		await smokeTest(tarball, path.join(absoluteRoot, "node_modules/.bin/tsc"));
		return { tarball, files };
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}
