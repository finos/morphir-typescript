// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Builds the publishable `@finos/morphir-mck` tarball: three Node bundles
// (the library, the `mck` driver, the reference adapter), their declarations,
// and the vendored kit the driver runs when no checkout is named. The mck
// sources reach the IR by relative path inside this repository; both the
// bundle and the declarations rewrite those paths to the `@finos/morphir-ir`
// package specifiers the published package depends on.

import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	archiveFiles,
	canonicalizeSourceMaps,
	canonicalSourceMapper,
	commandFailure,
	type DeclarationRewrite,
	executeCommand,
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

const ENTRYPOINTS = ["index.ts", "cli.ts", "adapter.ts"] as const;

// The kit files are the package's own sources for source-map purposes, so the
// canonical root is the package, not `src`: `kit/embedded.ts` is bundled too.
const IDENTITY: PackageIdentity = { scheme: "morphir-mck", sourceLabel: "packages/mck", virtualDirectory: "" };

export const canonicalSourceMap = canonicalSourceMapper(IDENTITY);

const DESCRIPTION = "The Morphir Compatibility Kit (MCK) driver: runs the kit against any binding through the adapter protocol and writes conformance reports.";
const REPOSITORY = {
	type: "git",
	url: "git+https://github.com/finos/morphir-typescript.git",
	directory: "packages/mck",
} as const;
const EXPORTS = { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } as const;
const BIN = { mck: "./dist/cli.js", "mck-adapter-typescript": "./dist/adapter.js" } as const;
const WORKSPACE_DEPENDENCIES = { "@finos/morphir-ir": "workspace:*" } as const;

// The adapter protocol's schema and worked example ship beside the kit: an
// installed consumer writing an adapter needs the contract it is held to, and
// the README points at both by name.
const CONTRACT_FILES = ["protocol.schema.json", "protocol.example.json"] as const;

const ROOT_FILES = [
	"package/package.json",
	"package/README.md",
	"package/LICENSE",
	"package/NOTICE",
	"package/kit.lock.json",
	...CONTRACT_FILES.map((file) => `package/${file}` as const),
] as const;
const REQUIRED_FILES = [
	...ROOT_FILES,
	"package/dist/index.js",
	"package/dist/index.js.map",
	"package/dist/cli.js",
	"package/dist/cli.js.map",
	"package/dist/adapter.js",
	"package/dist/adapter.js.map",
	"package/dist/index.d.ts",
	"package/dist/cli.d.ts",
	"package/dist/adapter.d.ts",
] as const;

/** The generated module that carries the vendored kit; it is bundled, never shipped as a source. */
const EMBEDDED_KIT_MODULE = "embedded.ts";

/**
 * The IR is imported by relative source path inside the repository. Both the
 * bundle and the emitted declarations must name the published package instead.
 * `VOCABULARY` and `VocabularyEntry` are re-exported from `/v4`; the document
 * tree is published as `/layout`.
 */
function irPackageSpecifier(specifier: string): string {
	const normalized = specifier.split(path.sep).join("/");
	if (normalized.endsWith("/ir/src/index.ts")) return "@finos/morphir-ir";
	if (normalized.endsWith("/ir/src/versions/v4/index.ts") || normalized.endsWith("/ir/src/versions/v4/vocabulary.ts")) return "@finos/morphir-ir/v4";
	if (normalized.endsWith("/ir/src/layout/index.ts")) return "@finos/morphir-ir/layout";
	throw new Error(`@finos/morphir-mck imports an IR source that no published export covers: ${specifier}`);
}

const DECLARATION_REWRITES: readonly DeclarationRewrite[] = [
	[/(["'])(?:\.\.\/)+ir\/src\/index\.ts\1/g, '"@finos/morphir-ir"'],
	[/(["'])(?:\.\.\/)+ir\/src\/versions\/v4\/(?:index|vocabulary)\.ts\1/g, '"@finos/morphir-ir/v4"'],
	[/(["'])(?:\.\.\/)+ir\/src\/layout\/index\.ts\1/g, '"@finos/morphir-ir/layout"'],
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
	expectExact(source.engines, { node: ">=20", bun: ">=1.2" }, "engines");
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
		engines: { node: ">=20", bun: ">=1.2" },
		exports: structuredClone(EXPORTS),
		bin: structuredClone(BIN),
		sideEffects: false,
		files: ["dist", "kit", "kit.lock.json", ...CONTRACT_FILES, "README.md", "LICENSE", "NOTICE"],
		dependencies: { "@finos/morphir-ir": source.version },
		publishConfig: { access: "public" },
	};
}

export const validatePackageFiles = packageFileValidator({
	rootFiles: [...ROOT_FILES],
	verbatimPrefixes: ["package/kit/"],
	denied: [`package/kit/${EMBEDDED_KIT_MODULE}`],
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

/** The kit as it publishes: every vendored file except the generated module the bundle inlines. */
async function kitFiles(packageRoot: string): Promise<readonly string[]> {
	const kitRoot = path.join(packageRoot, "kit");
	const files: string[] = [];
	await walkFiles(kitRoot, (absolute) => {
		const relative = path.relative(kitRoot, absolute).split(path.sep).join("/");
		if (relative !== EMBEDDED_KIT_MODULE) files.push(relative);
	});
	return files.sort();
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
	for (const relative of await kitFiles(packageRoot)) expected.add(`package/kit/${relative}`);
	return expected;
}

async function copyTree(from: string, to: string): Promise<void> {
	await walkFiles(from, async (absolute) => {
		const destination = path.join(to, path.relative(from, absolute));
		await mkdir(path.dirname(destination), { recursive: true });
		await copyFile(absolute, destination);
	});
}

/**
 * Runs the packed driver the way a user does: `--version`, an embedded-kit run,
 * and the same run over the packed adapter as a child process.
 *
 * The vendored kit runs clean, so `mck run` exits 0; `checkKitRunReport` still
 * adjudicates the report rather than trusting the exit code.
 */
async function smokeTest(mckTarball: string, irTarball: string, compiler: string): Promise<void> {
	const consumer = await mkdtemp(path.join(tmpdir(), "morphir-mck-consumer-"));
	try {
		// The packed manifest depends on `@finos/morphir-ir` by exact version, and
		// `--offline` cannot resolve that name against a registry it must not
		// reach. The override points the transitive dependency at the very
		// tarball this run built, so the consumer installs the pair and nothing
		// else.
		const consumerManifest = {
			name: "morphir-mck-artifact-consumer",
			private: true,
			type: "module",
			overrides: { "@finos/morphir-ir": `file:${irTarball.split(path.sep).join("/")}` },
		};
		await Bun.write(path.join(consumer, "package.json"), `${JSON.stringify(consumerManifest)}\n`);
		await runCommand([process.execPath, "add", "--offline", "--no-save", "--ignore-scripts", "--backend=copyfile", irTarball, mckTarball], consumer);
		const cli = "node_modules/@finos/morphir-mck/dist/cli.js";
		const adapter = "node_modules/@finos/morphir-mck/dist/adapter.js";

		// `engines.node` is `>=20`, so the compatibility check has to be Node 20
		// itself and not whichever newer Node happens to be first on PATH.
		await runCommand(
			[
				"node",
				"--input-type=module",
				"--eval",
				"if (process.versions.node.split('.')[0] !== '20') throw new Error('expected Node 20, received ' + process.versions.node);",
			],
			consumer,
		);

		const version = await runCommand(["node", cli, "--version"], consumer);
		const manifest = JSON.parse(await readFile(path.join(consumer, "node_modules/@finos/morphir-mck/package.json"), "utf8")) as { version: string };
		if (version !== manifest.version) throw new Error(`the packed driver reported version ${version}, not ${manifest.version}`);

		await expectKitRun(["node", cli, "run", "--report", "r.json"], consumer, "r.json");
		await expectKitRun(["node", cli, "run", "--adapter", "node", "--adapter-arg", adapter, "--report", "a.json"], consumer, "a.json");

		await Bun.write(path.join(consumer, "index.ts"), ['import * as mck from "@finos/morphir-mck";', "void mck;", ""].join("\n"));
		await runCommand([compiler, "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "index.ts"], consumer);
	} finally {
		await rm(consumer, { recursive: true, force: true });
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

/**
 * The case ids the packed driver is allowed to fail on, and how many records
 * each may contribute. Every entry is a fence the vendored kit spells
 * non-canonically, not a fault in the binding, and each is listed for the
 * parent repository in the plan's task reports:
 *
 * - `distributions-0004`: `complete-example.yaml` quotes FQNames and writes
 *   scalar sequences in block style.
 * - `types-0010`, `values-0022`, `patterns-and-literals-0012`: an all-scalar
 *   `source` mapping under `attributes` spelled as a flow mapping, where every
 *   other all-scalar mapping in the kit is a block mapping.
 * - `document-tree-0003`: the heading says `node=TypeDefinitionFile` while the
 *   case's canonical fence is a whole distribution.
 * - `document-tree-0005`: the set carries `$meta` members a writer never emits,
 *   so its write half cannot reproduce it; the fences want `mode=read`.
 *
 * The kit resync empties this map again.
 */
const ALLOWED_FAILING_CASES: ReadonlyMap<string, number> = new Map([
	["distributions-0004", 2],
	["document-tree-0003", 2],
	["document-tree-0005", 4],
	["patterns-and-literals-0012", 2],
	["types-0010", 2],
	["values-0022", 2],
]);

/** Holds the packed driver to its report: this binding, no kit errors, and only the known failures. */
export function checkKitRunReport(report: unknown, label: string): void {
	if (!isRecord(report)) throw new Error(`${label} must contain a report object`);
	if (report.binding !== "morphir-typescript") throw new Error(`${label} reports binding ${String(report.binding)}`);
	if (!Array.isArray(report.records) || report.records.length === 0) throw new Error(`${label} contains no records`);

	const kitErrors = report.records.filter((record) => isRecord(record) && record.result === "kit-error").length;
	if (kitErrors > 0) throw new Error(`${label} reports ${kitErrors} kit-error record(s); the vendored kit must parse cleanly`);

	const failuresByCase = new Map<string, number>();
	for (const record of report.records) {
		if (!isRecord(record) || record.result !== "fail") continue;
		const caseId = String(record.caseId);
		failuresByCase.set(caseId, (failuresByCase.get(caseId) ?? 0) + 1);
	}
	const unexpected = [...failuresByCase]
		.filter(([caseId, count]) => count > (ALLOWED_FAILING_CASES.get(caseId) ?? 0))
		.map(([caseId, count]) => `${caseId} (${count} failing record(s), at most ${ALLOWED_FAILING_CASES.get(caseId) ?? 0} allowed)`)
		.sort();
	if (unexpected.length > 0) throw new Error(`${label} reports failures the packaging check does not allow: ${unexpected.join(", ")}`);
}

async function expectKitRun(command: readonly string[], consumer: string, reportFile: string): Promise<void> {
	const result = await executeCommand(command, consumer);
	// Exit 1 is `mck run` saying some record failed, which the report check
	// below adjudicates; any other non-zero exit is the driver itself failing.
	if (result.exitCode !== 0 && result.exitCode !== 1) throw commandFailure(command, result);
	checkKitRunReport(JSON.parse(await readFile(path.join(consumer, reportFile), "utf8")), reportFile);
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
			external: ["@finos/morphir-ir"],
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

		// `tsc` roots the emit at `packages/` so `kit/embedded.ts` and the IR
		// sources the program pulls in stay under `rootDir`; only the package's
		// own declarations are kept.
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
			copyFile(path.join(packageRoot, "kit.lock.json"), path.join(stage, "kit.lock.json")),
			...CONTRACT_FILES.map((file) => copyFile(path.join(packageRoot, file), path.join(stage, file))),
			copyFile(path.join(absoluteRoot, "LICENSE"), path.join(stage, "LICENSE")),
			copyFile(path.join(absoluteRoot, "NOTICE"), path.join(stage, "NOTICE")),
		]);
		for (const relative of await kitFiles(packageRoot)) {
			const destination = path.join(stage, "kit", relative);
			await mkdir(path.dirname(destination), { recursive: true });
			await copyFile(path.join(packageRoot, "kit", relative), destination);
		}

		const expectedFilename = `finos-morphir-mck-${version}.tgz`;
		const stagedTarball = await packStagedPackage(stage, path.join(work, "packed"), expectedFilename);

		const tarball = path.join(output, expectedFilename);
		const files = await promoteVerifiedArtifact(stagedTarball, tarball, async (candidate) => {
			const candidateFiles = await archiveFiles(validatePackageFiles, candidate, absoluteRoot, await expectedArchiveFiles(packageRoot));
			await verifyExtractedFiles(candidate, candidateFiles, work);
			await verifyDeclarations(candidate, candidateFiles, absoluteRoot);
			await smokeTest(candidate, path.resolve(irTarball), path.join(absoluteRoot, "node_modules/.bin/tsc"));
			return candidateFiles;
		});
		return { tarball, files };
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}
