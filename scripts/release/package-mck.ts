// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Builds the publishable `@finos/morphir-mck` tarball: three Node bundles
// (the library, the `mck` driver, the reference adapter), their declarations,
// and the vendored kit the driver runs when no checkout is named. The mck
// sources reach the IR by relative path inside this repository; both the
// bundle and the declarations rewrite those paths to the `@finos/morphir-ir`
// package specifiers the published package depends on.
//
// The IR and Ajv validator are external dependencies. The command line is built
// on @effect/cli, and those packages (declared as devDependencies) are bundled
// into dist/cli.js rather than published as dependencies: nobody imports the
// driver entry, and @effect/platform-node would otherwise hand every consumer
// a dependency tree the library itself never uses. Their sources appear in
// cli.js.map under a virtual node_modules path.

import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
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
import { DEPENDENCIES as IR_DEPENDENCIES, packRuntimeDependency, type RuntimeDependencyName } from "./package-ir.ts";
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
const RUNTIME_DEPENDENCIES = { ajv: "8.20.0" } as const;
const WORKSPACE_DEPENDENCIES = { "@finos/morphir-ir": "workspace:*", ...RUNTIME_DEPENDENCIES } as const;

// The adapter protocol's schema and worked example ship beside the kit: an
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
		dependencies: { "@finos/morphir-ir": source.version, ...RUNTIME_DEPENDENCIES },
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

/** Packs the installed validator and its runtime dependency tree for an offline consumer. */
async function packAjvDependencies(root: string, packedOutput: string): Promise<Readonly<Record<string, string>>> {
	const packed = new Map<string, { readonly version: string; readonly tarball: string }>();
	async function pack(name: string, from: string): Promise<void> {
		const manifestPath = createRequire(from).resolve(`${name}/package.json`);
		const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { name: string; version: string; dependencies?: Record<string, string> };
		const previous = packed.get(name);
		if (previous !== undefined) {
			if (previous.version !== manifest.version) throw new Error(`offline validator dependencies require multiple versions of ${name}`);
			return;
		}
		if (name === "ajv" && manifest.version !== RUNTIME_DEPENDENCIES.ajv) throw new Error("installed Ajv does not match the publishing contract");
		const tarball = await packStagedPackage(
			path.dirname(manifestPath),
			packedOutput,
			`${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`,
		);
		packed.set(name, { version: manifest.version, tarball });
		for (const dependency of Object.keys(manifest.dependencies ?? {})) await pack(dependency, manifestPath);
	}
	await pack("ajv", path.join(root, "packages/mck/package.json"));
	return Object.fromEntries([...packed].map(([name, { tarball }]) => [name, `file:${tarball.split(path.sep).join("/")}`]));
}

const PACKAGE_SMOKE = String.raw`
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { referencePackageTestee, processPackageTestee } from "@finos/morphir-mck";

const digest = (text) => "sha256:" + createHash("sha256").update(text).digest("hex");
const canonical = '{"a":"first","z":"last"}';
const expected = {
	ok: true,
	canonical,
	manifestDigest: digest(canonical),
	packageContentDigest: digest("morphir-package-content:0.1.0-draft.1\n" + canonical),
};
const schemas = {
	manifest: {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: "https://example.invalid/package-manifest",
		type: "object",
		required: ["name"],
		properties: { name: { type: "string" } },
		additionalProperties: false,
	},
	lock: { $ref: "https://example.invalid/package-manifest" },
};
let exitCode;
const processTestee = processPackageTestee(
	[process.execPath, "node_modules/@finos/morphir-mck/dist/adapter.js", "--suite", "package"],
	{ timeoutMs: 5000, onExit: (code) => { exitCode = code; } },
);
for (const testee of [referencePackageTestee(), processTestee]) {
	try {
		assert.equal((await testee.capabilities()).suite, "package");
		assert.deepEqual(await testee.execute({ op: "normalize", input: '{ "z": "last", "a": "first" }' }), expected);
		for (const artifact of ["manifest", "lock"]) {
			assert.deepEqual(await testee.execute({ op: "validate", artifact, input: '{"name":"sample"}', schemas }), { ok: true, valid: true });
			assert.deepEqual(await testee.execute({ op: "validate", artifact, input: '{"name":123}', schemas }), { ok: true, valid: false });
		}
	} finally {
		await testee.close();
	}
}
assert.equal(exitCode, 0);
`;

const RESOLUTION_SMOKE = `
import assert from "node:assert/strict";
import { processResolutionTestee, referenceResolutionTestee } from "@finos/morphir-mck";
const digest = "sha256:" + "0".repeat(64);
const id = (packagePath, version = "1.0.0") => ({ packagePath, version });
const requirement = (irPackageName, packagePath, minimumInclusive, maximumExclusive) => ({ irPackageName, packagePath, versionRange: { minimumInclusive, maximumExclusive } });
const record = (packagePath, version, irPackageName, dependencies = []) => ({ release: id(packagePath, version), irPackageName, manifestDigest: digest, contentDigest: digest, dependencies });
const binding = (metadata) => ({ irPackageName: metadata.irPackageName, target: metadata.release });
const node = (metadata, bindings = []) => ({ release: metadata.release, irPackageName: metadata.irPackageName, manifestDigest: metadata.manifestDigest, contentDigest: metadata.contentDigest, bindings });
const targetPath = "example.com/lib/target";
const keeperPath = "example.com/lib/keeper";
const existingPath = "example.com/lib/existing";
const existing10 = record(existingPath, "1.0.0", "example/existing");
const existing15 = record(existingPath, "1.5.0", "example/existing");
const target10 = record(targetPath, "1.0.0", "example/target");
const target20 = record(targetPath, "2.0.0", "example/target", [requirement("example/existing", existingPath, "1.5.0", "2.0.0")]);
const keeper = record(keeperPath, "1.0.0", "example/keeper", [requirement("example/existing", existingPath, "1.0.0", "2.0.0")]);
const root = record("example.com/app/root", "1.0.0", "example/app", [requirement("example/target", targetPath, "1.0.0", "3.0.0"), requirement("example/keeper", keeperPath, "1.0.0", "2.0.0")]);
const input = JSON.stringify({ formatVersion: "0.1.0-draft.2", capability: "flat-library", root, mode: "update", catalogs: [{ packagePath: targetPath, releases: [target10, target20] }, { packagePath: keeperPath, releases: [keeper] }, { packagePath: existingPath, releases: [existing10, existing15] }], lock: { root: root.release, nodes: [node(root, [binding(target10), binding(keeper)]), node(target10), node(keeper, [binding(existing10)]), node(existing10)] }, targets: [{ kind: "exact", packagePath: targetPath, version: "2.0.0" }] });
let exitCode;
const processTestee = processResolutionTestee([process.execPath, "node_modules/@finos/morphir-mck/dist/adapter.js", "--suite", "package", "--contract", "0.1.0-draft.2"], { timeoutMs: 5000, onExit: (code) => { exitCode = code; } });
for (const testee of [referenceResolutionTestee(), processTestee]) {
	try {
		assert.deepEqual((await testee.capabilities()).profiles, ["flat-library"]);
		const result = await testee.execute({ op: "resolve-library", input });
		assert.equal(result.ok, false);
		assert.equal(result.diagnostic.code, "update-scope-conflict");
		assert.deepEqual(result.diagnostic.changedPins, [{ kind: "changed", previous: existing10.release, selected: existing15.release }]);
	} finally { await testee.close(); }
}
assert.equal(exitCode, 0);
`;

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
		const: expected,
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
				cases: [{ id: "resolution.smoke.malformed", family: "profile-boundaries", description: "Packed Node 20 resolve-library smoke", input: "{", expected }],
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

/**
 * Runs the packed driver the way a user does: `--version`, an embedded-kit run,
 * and the same run over the packed adapter as a child process.
 *
 * The vendored kit runs clean, so `mck run` exits 0. `checkKitRunReport`
 * still adjudicates the report against ALLOWED_FAILING_CASES, and
 * `expectKitRun` still requires that exit code from the driver.
 */
async function smokeTest(mckTarball: string, irTarball: string, compiler: string, root: string): Promise<void> {
	const consumer = await mkdtemp(path.join(tmpdir(), "morphir-mck-consumer-"));
	const irDependenciesWork = await mkdtemp(path.join(tmpdir(), "morphir-mck-ir-dependency-pack-"));
	const ajvWork = await mkdtemp(path.join(tmpdir(), "morphir-mck-ajv-pack-"));
	try {
		// A fresh runner has no registry metadata for offline resolution. Local
		// tarball overrides cover the IR, the IR's own runtime dependencies (yaml,
		// decimal.js — see package-ir.ts's DEPENDENCIES), Ajv, and Ajv's runtime
		// dependencies.
		const irDependencyNames = Object.keys(IR_DEPENDENCIES) as readonly RuntimeDependencyName[];
		const irDependencyPacks = await Promise.all(
			irDependencyNames.map(async (name) => ({ name, tarball: await packRuntimeDependency(root, name, irDependenciesWork) })),
		);
		const irDependencyTarballs = irDependencyPacks.map(({ tarball }) => tarball);
		const irDependencyOverrides = Object.fromEntries(irDependencyPacks.map(({ name, tarball }) => [name, `file:${tarball.split(path.sep).join("/")}`]));
		const ajvOverrides = await packAjvDependencies(root, ajvWork);
		const consumerManifest = {
			name: "morphir-mck-artifact-consumer",
			private: true,
			type: "module",
			overrides: {
				"@finos/morphir-ir": `file:${irTarball.split(path.sep).join("/")}`,
				...irDependencyOverrides,
				...ajvOverrides,
			},
		};
		await Bun.write(path.join(consumer, "package.json"), `${JSON.stringify(consumerManifest)}\n`);
		await runCommand(
			[process.execPath, "add", "--offline", "--no-save", "--ignore-scripts", "--backend=copyfile", ...irDependencyTarballs, irTarball, mckTarball],
			consumer,
		);
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
		await runCommand(["node", "--input-type=module", "--eval", PACKAGE_SMOKE], consumer);
		await runCommand(["node", "--input-type=module", "--eval", RESOLUTION_SMOKE], consumer);

		const resolutionKit = await writeResolutionSmokeKit(consumer);
		await runCommand(["node", cli, "package", "run", "--contract", "0.1.0-draft.2", "--kit", resolutionKit, "--report", "resolution.json"], consumer);
		await runCommand(
			[
				"node",
				cli,
				"package",
				"run",
				"--contract",
				"0.1.0-draft.2",
				"--kit",
				resolutionKit,
				"--adapter",
				"node",
				"--adapter-arg",
				adapter,
				"--adapter-arg",
				"--suite",
				"--adapter-arg",
				"package",
				"--adapter-arg",
				"--contract",
				"--adapter-arg",
				"0.1.0-draft.2",
				"--report",
				"resolution-adapter.json",
			],
			consumer,
		);

		await Bun.write(path.join(consumer, "index.ts"), ['import * as mck from "@finos/morphir-mck";', "void mck;", ""].join("\n"));
		await runCommand([compiler, "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "index.ts"], consumer);
	} finally {
		await rm(consumer, { recursive: true, force: true });
		await rm(irDependenciesWork, { recursive: true, force: true });
		await rm(ajvWork, { recursive: true, force: true });
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
 * each may contribute. Empty: the vendored kit runs clean. The mechanism
 * stays so a future kit resync can carry a known-bad fence again without a
 * code change.
 */
const ALLOWED_FAILING_CASES: ReadonlyMap<string, number> = new Map();

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
	if (result.exitCode !== 0) throw commandFailure(command, result);
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
			await smokeTest(candidate, path.resolve(irTarball), path.join(absoluteRoot, "node_modules/.bin/tsc"), absoluteRoot);
			return candidateFiles;
		});
		return { tarball, files };
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}
