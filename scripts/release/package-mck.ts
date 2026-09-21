// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Builds the publishable `@finos/morphir-mck` tarball: the package library,
// TypeScript adapter, and declarations. The mck
// sources reach the IR by relative path inside this repository; both the
// bundle and the declarations rewrite those paths to the `@finos/morphir-ir`
// package specifiers the published package depends on.
//
// The IR, Ajv validator and Noble curves are external dependencies.

import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { nativeContext } from "../conformance/native.ts";
import {
	archiveFiles,
	canonicalizeSourceMaps,
	canonicalSourceMapper,
	type DeclarationRewrite,
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
import { DEPENDENCIES as IR_DEPENDENCIES, packRuntimeDependency, type RuntimeDependencyName } from "./package-ir.ts";
import { parseStableVersion } from "./version.ts";

const ENTRYPOINTS = ["index.ts", "adapter.ts"] as const;

// Package metadata and sources share the package root in source maps.
const IDENTITY: PackageIdentity = { scheme: "morphir-mck", sourceLabel: "packages/mck", virtualDirectory: "" };

export const canonicalSourceMap = canonicalSourceMapper(IDENTITY);

const DESCRIPTION = "Morphir package implementation helpers and TypeScript adapters. Compatibility runs through the native Morphir CLI.";
const REPOSITORY = {
	type: "git",
	url: "git+https://github.com/finos/morphir-typescript.git",
	directory: "packages/mck",
} as const;
const EXPORTS = { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } as const;
const BIN = { "mck-adapter-typescript": "./dist/adapter.js" } as const;
const RUNTIME_DEPENDENCIES = { "@noble/curves": "2.4.0", ajv: "8.20.0" } as const;
const WORKSPACE_DEPENDENCIES = { "@finos/morphir-ir": "workspace:*", ...RUNTIME_DEPENDENCIES } as const;

// The adapter protocol's schema and worked example ship with the package: an
// installed consumer writing an adapter needs the contract it is held to, and
// the README points at both by name.
const CONTRACT_FILES = [
	"protocol.schema.json",
	"protocol.example.json",
	"package-protocol.schema.json",
	"package-report.schema.json",
	"package-resolution-protocol.schema.json",
	"package-resolution-report.schema.json",
] as const;

const ROOT_FILES = [
	"package/package.json",
	"package/README.md",
	"package/LICENSE",
	"package/NOTICE",
	...CONTRACT_FILES.map((file) => `package/${file}` as const),
] as const;
const REQUIRED_FILES = [
	...ROOT_FILES,
	"package/dist/index.js",
	"package/dist/index.js.map",
	"package/dist/adapter.js",
	"package/dist/adapter.js.map",
	"package/dist/index.d.ts",
	"package/dist/adapter.d.ts",
] as const;

/**
 * The IR is imported by relative source path inside the repository. Both the
 * bundle and the emitted declarations must name the published package instead.
 * `VOCABULARY` and `VocabularyEntry` are re-exported from `/v4`; the document
 * tree is published as `/layout`.
 */
function irPackageSpecifier(specifier: string): string {
	const normalized = specifier.split(path.sep).join("/");
	if (normalized.endsWith("/ir/src/index.ts")) return "@finos/morphir-ir";
	if (normalized.endsWith("/ir/src/model/index.ts")) return "@finos/morphir-ir/model";
	if (normalized.endsWith("/ir/src/versions/v4/index.ts") || normalized.endsWith("/ir/src/versions/v4/vocabulary.ts")) return "@finos/morphir-ir/v4";
	if (normalized.endsWith("/ir/src/layout/index.ts")) return "@finos/morphir-ir/layout";
	if (normalized.endsWith("/ir/src/codec/json/value.ts")) return "@finos/morphir-ir/codec/json";
	throw new Error(`@finos/morphir-mck imports an IR source that no published export covers: ${specifier}`);
}

const DECLARATION_REWRITES: readonly DeclarationRewrite[] = [
	[/(["'])(?:\.\.\/)+ir\/src\/index\.ts\1/g, '"@finos/morphir-ir"'],
	[/(["'])(?:\.\.\/)+ir\/src\/model\/index\.ts\1/g, '"@finos/morphir-ir/model"'],
	[/(["'])(?:\.\.\/)+ir\/src\/versions\/v4\/(?:index|vocabulary)\.ts\1/g, '"@finos/morphir-ir/v4"'],
	[/(["'])(?:\.\.\/)+ir\/src\/layout\/index\.ts\1/g, '"@finos/morphir-ir/layout"'],
	[/(["'])(?:\.\.\/)+ir\/src\/codec\/json\/value\.ts\1/g, '"@finos/morphir-ir/codec/json"'],
];

function expectExact(value: unknown, expected: unknown, field: string): void {
	if (!isDeepStrictEqual(value, expected)) throw new Error(`@finos/morphir-mck ${field} does not match the publishing contract`);
}

export function publishMckManifest(source: JsonRecord): JsonRecord & { readonly exports: typeof EXPORTS } {
	expectExact(source.name, "@finos/morphir-mck", "name");
	if (typeof source.version !== "string") throw new Error("@finos/morphir-mck version must be a stable semantic version");
	parseStableVersion(source.version);
	if (source.private !== undefined && source.private !== false) throw new Error("@finos/morphir-mck must be public");
	expectExact(source.type, "module", "type");
	expectExact(source.description, DESCRIPTION, "description");
	expectExact(source.license, "Apache-2.0", "license");
	expectExact(source.repository, REPOSITORY, "repository");
	expectExact(source.homepage, "https://github.com/finos/morphir-typescript#readme", "homepage");
	expectExact(source.bugs, "https://github.com/finos/morphir-typescript/issues", "bugs");
	expectExact(source.engines, { node: ">=24", bun: ">=1.2" }, "engines");
	expectExact(source.exports, EXPORTS, "exports");
	expectExact(source.bin, BIN, "bin");
	expectExact(source.sideEffects, false, "sideEffects");
	expectExact(source.publishConfig, { access: "public" }, "publishConfig");
	expectExact(source.dependencies, WORKSPACE_DEPENDENCIES, "dependencies");

	return {
		name: source.name,
		version: source.version,
		type: source.type,
		description: source.description,
		license: source.license,
		repository: structuredClone(REPOSITORY),
		homepage: source.homepage,
		bugs: source.bugs,
		engines: { node: ">=24", bun: ">=1.2" },
		exports: structuredClone(EXPORTS),
		bin: structuredClone(BIN),
		sideEffects: false,
		files: ["dist", ...CONTRACT_FILES, "README.md", "LICENSE", "NOTICE"],
		dependencies: { "@finos/morphir-ir": source.version, ...RUNTIME_DEPENDENCIES },
		publishConfig: { access: "public" },
	};
}

export const validatePackageFiles = packageFileValidator({
	rootFiles: [...ROOT_FILES],
	denied: ["package/dist/cli.js", "package/dist/cli.js.map", "package/dist/cli.d.ts", "package/dist/cli.d.ts.map"],
	defaultExpected: new Set(REQUIRED_FILES),
});

function parseManifest(source: string): JsonRecord {
	const parsed: unknown = JSON.parse(source);
	if (!isRecord(parsed)) throw new Error("packages/mck/package.json must contain an object");
	return parsed;
}

async function walkFiles(directory: string, visit: (absolute: string) => Promise<void> | void): Promise<void> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) await walkFiles(absolute, visit);
		else if (entry.isFile()) await visit(absolute);
	}
}

async function expectedArchiveFiles(packageRoot: string): Promise<ReadonlySet<string>> {
	const expected = new Set<string>(REQUIRED_FILES);
	const sourceRoot = path.join(packageRoot, "src");
	await walkFiles(sourceRoot, (absolute) => {
		if (!absolute.endsWith(".ts") || absolute.endsWith(".test.ts")) return;
		const relative = path.relative(sourceRoot, absolute).split(path.sep).join("/").replace(/\.ts$/, ".d.ts");
		expected.add(`package/dist/${relative}`);
		expected.add(`package/dist/${relative}.map`);
	});
	return expected;
}

async function copyTree(from: string, to: string): Promise<void> {
	await walkFiles(from, async (absolute) => {
		const destination = path.join(to, path.relative(from, absolute));
		await mkdir(path.dirname(destination), { recursive: true });
		await copyFile(absolute, destination);
	});
}

/** Packs installed runtime dependencies and their dependency trees for an offline consumer. */
async function packMckDependencies(root: string, packedOutput: string): Promise<Readonly<Record<string, string>>> {
	const packed = new Map<string, { readonly version: string; readonly tarball: string }>();
	async function pack(name: string, from: string): Promise<void> {
		const require = createRequire(from);
		// Noble exports its algorithm entries, but intentionally hides package.json.
		const entry = name === "@noble/curves" ? "ed25519.js" : name === "@noble/hashes" ? "sha2.js" : undefined;
		const manifestPath =
			entry === undefined ? require.resolve(`${name}/package.json`) : path.join(path.dirname(require.resolve(`${name}/${entry}`)), "package.json");
		const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { name: string; version: string; dependencies?: Record<string, string> };
		const previous = packed.get(name);
		if (previous !== undefined) {
			if (previous.version !== manifest.version) throw new Error(`offline runtime dependencies require multiple versions of ${name}`);
			return;
		}
		const expected = ({ ...RUNTIME_DEPENDENCIES, "@noble/hashes": "2.4.0" } as Readonly<Record<string, string>>)[name];
		if (manifest.name !== name || (expected !== undefined && manifest.version !== expected))
			throw new Error(`installed ${name} does not match the publishing contract`);
		const tarball = await packStagedPackage(
			path.dirname(manifestPath),
			packedOutput,
			`${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`,
		);
		packed.set(name, { version: manifest.version, tarball });
		for (const dependency of Object.keys(manifest.dependencies ?? {})) await pack(dependency, manifestPath);
	}
	for (const name of Object.keys(RUNTIME_DEPENDENCIES)) await pack(name, path.join(root, "packages/mck/package.json"));
	return Object.fromEntries([...packed].map(([name, { tarball }]) => [name, `file:${tarball.split(path.sep).join("/")}`]));
}

// Internal publisher verification is source-only. This checks its declared math dependency
// from an isolated installed MCK package without adding a public publisher entry point.
const NOBLE_SMOKE = `
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(path.resolve("node_modules/@finos/morphir-mck/package.json"));
const curves = require.resolve("@noble/curves/ed25519.js");
const hashes = createRequire(curves).resolve("@noble/hashes/sha2.js");
const installed = realpathSync("node_modules") + path.sep;
for (const entry of [curves, hashes]) {
  assert(realpathSync(entry).startsWith(installed), "crypto dependency resolved outside isolated consumer");
  const manifest = JSON.parse(require("node:fs").readFileSync(path.join(path.dirname(entry), "package.json"), "utf8"));
  assert.equal(manifest.version, "2.4.0");
}
const { ed25519 } = await import(pathToFileURL(curves).href);
const key = Buffer.from("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex");
const sig = Buffer.from("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b", "hex");
assert(ed25519.verify(sig, new Uint8Array(), key, { zip215: false }));
assert(!ed25519.verify(sig, new Uint8Array([0]), key, { zip215: false }));
`;

async function writeIntegritySmokeKit(consumer: string): Promise<string> {
	const root = path.join(consumer, "integrity-kit");
	const mck = path.join(root, "mck");
	const schemas = path.join(root, "schemas");
	const fixtures = path.join(mck, "fixtures/two-libraries");
	await Promise.all([
		mkdir(path.join(fixtures, "eligibility"), { recursive: true }),
		mkdir(path.join(fixtures, "loan-rules"), { recursive: true }),
		mkdir(schemas, { recursive: true }),
	]);
	const version = "0.1.0-draft.1";
	const schema = (id: string): JsonRecord => ({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: id, type: "object" });
	const files: ReadonlyArray<readonly [string, unknown]> = [
		[
			path.join(mck, "digest-vectors.json"),
			{
				formatVersion: version,
				cases: [{ id: "integrity.smoke.invalid-document", input: "null", error: "invalid-document" }],
				byteCases: [{ id: "integrity.smoke.empty-bytes", hex: "", digest: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }],
			},
		],
		[
			path.join(mck, "schema-cases.json"),
			{ formatVersion: version, cases: [{ id: "integrity.smoke.schema", schema: "manifest", fixture: "eligibility", expected: "accept" }] },
		],
		[path.join(mck, "library-cases.json"), { formatVersion: version, cases: [{ id: "integrity.smoke.library", expected: "reject", lockText: "{}" }] }],
		[path.join(fixtures, "eligibility/manifest.json"), {}],
		[path.join(fixtures, "loan-rules/manifest.json"), {}],
		[path.join(fixtures, "lock-core.json"), {}],
		[path.join(fixtures, "eligibility/ir.json"), {}],
		[path.join(fixtures, "loan-rules/ir.json"), {}],
		[path.join(schemas, "library-manifest.schema.json"), schema("https://morphir.finos.org/spec/package/0.1.0-draft.1/library-manifest.schema.json")],
		[path.join(schemas, "lock-core.schema.json"), schema("https://morphir.finos.org/spec/package/0.1.0-draft.1/lock-core.schema.json")],
	];
	await Promise.all(files.map(([file, value]) => Bun.write(file, `${JSON.stringify(value)}\n`)));
	return mck;
}

async function writeResolutionSmokeKit(consumer: string): Promise<string> {
	const root = path.join(consumer, "resolution-kit");
	const mck = path.join(root, "mck");
	const schemas = path.join(root, "schemas");
	await mkdir(path.join(mck, "fixtures/resolution"), { recursive: true });
	await mkdir(schemas, { recursive: true });
	const version = "0.1.0-draft.2";
	const expected = { ok: false, diagnostic: { code: "invalid-input", violations: [{ pointer: "", rule: "malformed-json" }] } };
	const resultSchema = {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: "https://morphir.finos.org/spec/package/0.1.0-draft.2/resolution-result.schema.json",
		type: "object",
	};
	const caseSchema = {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: "https://morphir.finos.org/spec/package/0.1.0-draft.2/resolution-case.schema.json",
		oneOf: [
			{
				type: "object",
				required: ["formatVersion", "fixtures"],
				additionalProperties: false,
				properties: { formatVersion: { const: version }, fixtures: { type: "array", minItems: 1, items: { type: "string" } } },
			},
			{
				type: "object",
				required: ["formatVersion", "cases"],
				additionalProperties: false,
				properties: {
					formatVersion: { const: version },
					cases: {
						type: "array",
						minItems: 1,
						items: {
							type: "object",
							required: ["id", "family", "description", "input", "expected"],
							additionalProperties: false,
							properties: {
								id: { type: "string" },
								family: { type: "string" },
								description: { type: "string" },
								input: { type: "string" },
								expected: { $ref: resultSchema.$id },
							},
						},
					},
				},
			},
		],
	};
	const schema = (id: string): JsonRecord => ({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: id, type: "object" });
	const files: ReadonlyArray<readonly [string, unknown]> = [
		[path.join(mck, "resolution-cases.json"), { formatVersion: version, fixtures: ["fixtures/resolution/smoke.json"] }],
		[
			path.join(mck, "fixtures/resolution/smoke.json"),
			{
				formatVersion: version,
				cases: [{ id: "resolution.smoke.malformed", family: "profile-boundaries", description: "Packed Node 24 resolve-library smoke", input: "{", expected }],
			},
		],
		[path.join(schemas, "library-manifest.schema.json"), schema("https://morphir.finos.org/spec/package/0.1.0-draft.1/library-manifest.schema.json")],
		[path.join(schemas, "lock-core.schema.json"), schema("https://morphir.finos.org/spec/package/0.1.0-draft.1/lock-core.schema.json")],
		[path.join(schemas, "resolution-input.schema.json"), schema("https://morphir.finos.org/spec/package/0.1.0-draft.2/resolution-input.schema.json")],
		[path.join(schemas, "resolution-result.schema.json"), resultSchema],
		[path.join(schemas, "resolution-case.schema.json"), caseSchema],
	];
	await Promise.all(files.map(([file, value]) => Bun.write(file, `${JSON.stringify(value)}\n`)));
	return mck;
}

async function verifyPackageSmokeReport(file: string, contractVersion: string, cases: number): Promise<void> {
	const report: unknown = JSON.parse(await readFile(file, "utf8"));
	if (!isRecord(report) || report.contractVersion !== contractVersion || !Array.isArray(report.records) || report.records.length !== cases) {
		throw new Error(`native package smoke did not produce the expected ${contractVersion} report`);
	}
	if (report.records.some((record) => !isRecord(record) || record.result !== "pass")) {
		throw new Error(`native package smoke reported a non-passing ${contractVersion} case`);
	}
}

/** Verifies installed package tooling and the Node 24 adapter with the native CLI. */
async function smokeTest(mckTarball: string, irTarball: string, compiler: string, root: string): Promise<void> {
	const consumer = await mkdtemp(path.join(tmpdir(), "morphir-mck-consumer-"));
	const irDependenciesWork = await mkdtemp(path.join(tmpdir(), "morphir-mck-ir-dependency-pack-"));
	const runtimeWork = await mkdtemp(path.join(tmpdir(), "morphir-mck-runtime-pack-"));
	try {
		// A fresh runner has no registry metadata for offline resolution. Local
		// tarball overrides cover the IR, the IR's own runtime dependencies (yaml,
		// decimal.js, see package-ir.ts's DEPENDENCIES), Ajv, Noble curves,
		// and their runtime dependencies, including Noble hashes.
		const irDependencyNames = Object.keys(IR_DEPENDENCIES) as readonly RuntimeDependencyName[];
		const irDependencyPacks = await Promise.all(
			irDependencyNames.map(async (name) => ({ name, tarball: await packRuntimeDependency(root, name, irDependenciesWork) })),
		);
		const irDependencyTarballs = irDependencyPacks.map(({ tarball }) => tarball);
		const irDependencyOverrides = Object.fromEntries(irDependencyPacks.map(({ name, tarball }) => [name, `file:${tarball.split(path.sep).join("/")}`]));
		const runtimeOverrides = await packMckDependencies(root, runtimeWork);
		const consumerManifest = {
			name: "morphir-mck-artifact-consumer",
			private: true,
			type: "module",
			overrides: {
				"@finos/morphir-ir": `file:${irTarball.split(path.sep).join("/")}`,
				...irDependencyOverrides,
				...runtimeOverrides,
			},
		};
		await Bun.write(path.join(consumer, "package.json"), `${JSON.stringify(consumerManifest)}\n`);
		await runCommand(
			[process.execPath, "add", "--offline", "--no-save", "--ignore-scripts", "--backend=copyfile", ...irDependencyTarballs, irTarball, mckTarball],
			consumer,
		);
		const adapter = "node_modules/@finos/morphir-mck/dist/adapter.js";

		// `engines.node` is `>=24`, so the compatibility check has to be Node 24
		// itself and not whichever newer Node happens to be first on PATH.
		await runCommand(
			[
				"node",
				"--input-type=module",
				"--eval",
				"if (process.versions.node.split('.')[0] !== '24') throw new Error('expected Node 24, received ' + process.versions.node);",
			],
			consumer,
		);

		// Required: validate the installed Node adapter with the released native runner.
		const native = await nativeContext(root);
		await runCommand([native.cli, "mck", "kit", "status", "--kit", native.kit, "--json"], consumer);
		await runCommand(
			[native.cli, "mck", "run", "--adapter", "node", "--adapter-arg", path.join(consumer, adapter), "--kit", native.kit, "--report", "ir.json"],
			consumer,
		);
		await runCommand([native.cli, "mck", "report", "check", "ir.json", path.join(root, ".config/mck-allowed-failing.json"), "--kit", native.kit], consumer);
		await runCommand(["node", "--input-type=module", "--eval", NOBLE_SMOKE], consumer);

		const integrityKit = await writeIntegritySmokeKit(consumer);
		const resolutionKit = await writeResolutionSmokeKit(consumer);
		const packageRun = async (contract: "0.1.0-draft.1" | "0.1.0-draft.2", kit: string, report: string, adapterArgs: readonly string[], cases: number) => {
			const args = [
				native.cli,
				"mck",
				"package",
				"run",
				"--contract",
				contract,
				"--kit",
				kit,
				"--adapter",
				"node",
				"--adapter-arg",
				path.join(consumer, adapter),
			];
			for (const argument of adapterArgs) args.push("--adapter-arg", argument);
			args.push("--report", report);
			await runCommand(args, consumer);
			await verifyPackageSmokeReport(path.join(consumer, report), contract, cases);
		};
		await packageRun("0.1.0-draft.1", integrityKit, "integrity.json", ["--suite", "package"], 4);
		await packageRun("0.1.0-draft.2", resolutionKit, "resolution.json", ["--suite", "package", "--contract", "0.1.0-draft.2"], 1);

		await Bun.write(path.join(consumer, "index.ts"), ['import * as mck from "@finos/morphir-mck";', "void mck;", ""].join("\n"));
		await runCommand([compiler, "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "index.ts"], consumer);
	} finally {
		await rm(consumer, { recursive: true, force: true });
		await rm(irDependenciesWork, { recursive: true, force: true });
		await rm(runtimeWork, { recursive: true, force: true });
	}
}

/**
 * The first specifier in a declaration file that names a TypeScript source, or
 * null. Three forms reach a `.ts` path: `from "…"` (import and re-export),
 * `import("…")` (a type-position dynamic import), and a bare side-effect
 * `import "…"`, which `tsc` emits for a module imported only for its global
 * declarations and which no published file answers either.
 */
export const TYPESCRIPT_SPECIFIER = /(?:from\s+|import\s*\(|import\s+)["'][^"']*\.ts["']/;

/**
 * Reads the packed declarations back out of the archive and refuses to promote
 * one whose specifiers still name repository sources: a `.ts` specifier no
 * published file answers, or an `ir/src/` path the rewrite missed.
 */
async function verifyDeclarations(tarball: string, files: readonly string[], cwd: string): Promise<void> {
	for (const declaration of files.filter((file) => file.endsWith(".d.ts"))) {
		const contents = await runCommand(["tar", "-xOf", tarball, declaration], cwd);
		const specifier = TYPESCRIPT_SPECIFIER.exec(contents);
		if (specifier !== null) throw new Error(`${declaration} imports a TypeScript source: ${specifier[0]}`);
		if (contents.includes("ir/src/")) throw new Error(`${declaration} still names the IR by repository path instead of @finos/morphir-ir`);
	}
}

export async function buildMckArtifact(
	root: string,
	outputDirectory: string,
	irTarball: string,
): Promise<{ readonly tarball: string; readonly files: readonly string[] }> {
	const absoluteRoot = path.resolve(root);
	const output = path.resolve(outputDirectory);
	const packageRoot = path.join(absoluteRoot, "packages/mck");
	const source = parseManifest(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	const manifest = publishMckManifest(source);
	const version = manifest.version as string;
	const work = await mkdtemp(path.join(tmpdir(), "morphir-mck-pack-"));
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
			external: ["@finos/morphir-ir", ...Object.keys(RUNTIME_DEPENDENCIES)],
			plugins: [
				{
					name: "ir-as-package",
					setup(builder) {
						builder.onResolve({ filter: /[\\/]ir[\\/]src[\\/]/ }, (args) => ({ path: irPackageSpecifier(args.path), external: true }));
					},
				},
			],
		});
		if (!build.success) throw new AggregateError(build.logs, "Bun failed to build @finos/morphir-mck");
		await canonicalizeSourceMaps(canonicalSourceMap, dist, packageRoot);

		// `tsc` roots the emit at `packages/` so the IR sources stay under
		// `rootDir`; only the package's own declarations are kept.
		const declarations = path.join(work, "declarations");
		await runCommand(
			[
				path.join(absoluteRoot, "node_modules/.bin/tsc"),
				"-p",
				path.join(packageRoot, "tsconfig.build.json"),
				"--emitDeclarationOnly",
				"--outDir",
				declarations,
			],
			absoluteRoot,
		);
		const emitted = path.join(declarations, "mck/src");
		await rewriteDeclarationImports(emitted, DECLARATION_REWRITES);
		await canonicalizeSourceMaps(canonicalSourceMap, emitted, packageRoot);
		await copyTree(emitted, dist);

		await Promise.all([
			Bun.write(path.join(stage, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`),
			copyFile(path.join(packageRoot, "README.md"), path.join(stage, "README.md")),
			...CONTRACT_FILES.map((file) => copyFile(path.join(packageRoot, file), path.join(stage, file))),
			copyFile(path.join(absoluteRoot, "LICENSE"), path.join(stage, "LICENSE")),
			copyFile(path.join(absoluteRoot, "NOTICE"), path.join(stage, "NOTICE")),
		]);

		const expectedFilename = `finos-morphir-mck-${version}.tgz`;
		const stagedTarball = await packStagedPackage(stage, path.join(work, "packed"), expectedFilename);

		const tarball = path.join(output, expectedFilename);
		const files = await promoteVerifiedArtifact(stagedTarball, tarball, async (candidate) => {
			const candidateFiles = await archiveFiles(validatePackageFiles, candidate, absoluteRoot, await expectedArchiveFiles(packageRoot));
			await verifyExtractedFiles(candidate, candidateFiles, work);
			await verifyDeclarations(candidate, candidateFiles, absoluteRoot);
			await smokeTest(candidate, path.resolve(irTarball), path.join(absoluteRoot, "node_modules/.bin/tsc"), absoluteRoot);
			return candidateFiles;
		});
		return { tarball, files };
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}
