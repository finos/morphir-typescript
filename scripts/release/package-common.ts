// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The packaging mechanics both publishable packages share: running a command,
// listing and verifying a tarball's entries, canonicalizing source maps to a
// checkout-independent scheme, rewriting `.ts` specifiers out of declarations,
// and promoting a tarball only after it verifies. Everything that differs
// between `@finos/morphir-ir` and `@finos/morphir-mck` — the manifest contract,
// the entrypoints, the expected file set — stays in `package-ir.ts` and
// `package-mck.ts`.

import { randomUUID } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** How a package names itself in source maps and in diagnostics. */
export interface PackageIdentity {
	/** The virtual source-map scheme, such as `morphir-ir`. */
	readonly scheme: string;
	/** The repository-relative source root, such as `packages/ir/src`. */
	readonly sourceLabel: string;
	/**
	 * The directory a canonical source URL is rooted at, such as `src` for
	 * `morphir-ir:///src/index.ts`. Empty when the package's source root is the
	 * package itself, so `packages/mck/kit/embedded.ts` can be a bundled source.
	 */
	readonly virtualDirectory: string;
}

const COMMAND_LOG_LIMIT = 4_096;

export function boundedLog(value: string): string {
	if (value.length <= COMMAND_LOG_LIMIT) return value;
	return `${value.slice(0, COMMAND_LOG_LIMIT)}\n...[truncated ${value.length - COMMAND_LOG_LIMIT} characters]`;
}

export interface CommandResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

/** Runs a command to completion and reports its streams; never throws on a non-zero exit. */
export async function executeCommand(command: readonly string[], cwd: string): Promise<CommandResult> {
	const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	return { stdout, stderr, exitCode };
}

export function commandFailure(command: readonly string[], result: CommandResult): Error {
	const details = [
		result.stdout === "" ? undefined : `stdout:\n${boundedLog(result.stdout)}`,
		result.stderr === "" ? undefined : `stderr:\n${boundedLog(result.stderr)}`,
	].filter((detail) => detail !== undefined);
	return new Error(`${command[0]} failed with exit code ${result.exitCode}${details.length === 0 ? "" : `\n${details.join("\n")}`}`);
}

export async function runCommand(command: readonly string[], cwd: string): Promise<string> {
	const result = await executeCommand(command, cwd);
	if (result.exitCode !== 0) throw commandFailure(command, result);
	return result.stdout.trim();
}

export function canonicalSourceMapFor(
	identity: PackageIdentity,
	contents: string,
	mapFile: string,
	packageSourceRoot: string,
	sourceBase = path.dirname(mapFile),
): string {
	const parsed: unknown = JSON.parse(contents);
	if (!isRecord(parsed) || !Array.isArray(parsed.sources)) throw new Error(`${mapFile} must contain a source map with a sources array`);
	if (parsed.sourceRoot !== undefined && parsed.sourceRoot !== "") throw new Error(`${mapFile} contains an unexpected sourceRoot`);
	const sourceRoot = realpathSync(packageSourceRoot);
	const sources = parsed.sources.map((source) => {
		if (typeof source !== "string") throw new Error(`${mapFile} contains a non-string source`);
		const resolved = path.resolve(sourceBase, source);
		let resolvedSource: string;
		try {
			resolvedSource = realpathSync(resolved);
		} catch (error) {
			throw new Error(`${mapFile} source resolves outside ${identity.sourceLabel} or does not exist: ${source}`, { cause: error });
		}
		const relative = path.relative(sourceRoot, resolvedSource);
		if (relative === "" || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
			throw new Error(`${mapFile} source resolves outside ${identity.sourceLabel}: ${source}`);
		}
		const prefix = identity.virtualDirectory === "" ? "" : `${identity.virtualDirectory}/`;
		return `${identity.scheme}:///${prefix}${relative.split(path.sep).join("/")}`;
	});
	return `${JSON.stringify({ ...parsed, sources })}\n`;
}

export type CanonicalSourceMap = (contents: string, mapFile: string, packageSourceRoot: string, sourceBase?: string) => string;

/** Binds one package's identity into the source-map canonicalizer the build and its tests use. */
export function canonicalSourceMapper(identity: PackageIdentity): CanonicalSourceMap {
	return (contents, mapFile, packageSourceRoot, sourceBase = path.dirname(mapFile)) =>
		canonicalSourceMapFor(identity, contents, mapFile, packageSourceRoot, sourceBase);
}

export async function promoteVerifiedArtifact<T>(stagedTarball: string, finalTarball: string, verify: (tarball: string) => Promise<T>): Promise<T> {
	const result = await verify(stagedTarball);
	await mkdir(path.dirname(finalTarball), { recursive: true });
	const temporary = path.join(path.dirname(finalTarball), `.${path.basename(finalTarball)}.${randomUUID()}.tmp`);
	try {
		await copyFile(stagedTarball, temporary, constants.COPYFILE_EXCL);
		await rename(temporary, finalTarball);
		return result;
	} finally {
		await rm(temporary, { force: true });
	}
}

export async function declarationFiles(directory: string): Promise<readonly string[]> {
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

/** An extra specifier rewrite applied to declarations, such as a relative source path becoming a package specifier. */
export type DeclarationRewrite = readonly [pattern: RegExp, replacement: string];

export async function rewriteDeclarationImports(dist: string, extra: readonly DeclarationRewrite[] = []): Promise<void> {
	for (const file of await declarationFiles(dist)) {
		const contents = await readFile(file, "utf8");
		let updated = contents;
		for (const [pattern, replacement] of extra) updated = updated.replaceAll(pattern, replacement);
		updated = updated
			.replaceAll(/(\bfrom\s*["'])(\.[^"'\r\n]+)\.ts(["'])/g, "$1$2.js$3")
			.replaceAll(/(\b(?:import|require)\s*\(\s*["'])(\.[^"'\r\n]+)\.ts(["'])/g, "$1$2.js$3")
			.replaceAll(/(\bimport\s*["'])(\.[^"'\r\n]+)\.ts(["'])/g, "$1$2.js$3");
		if (updated === contents) continue;
		await Bun.write(file, updated);
	}
}

export async function canonicalizeSourceMaps(canonicalize: CanonicalSourceMap, dist: string, packageSourceRoot: string): Promise<void> {
	async function visit(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) await visit(absolute);
			else if (entry.isFile() && entry.name.endsWith(".map")) {
				const sourceBase = entry.name.endsWith(".js.map") ? dist : path.dirname(absolute);
				await Bun.write(absolute, canonicalize(await readFile(absolute, "utf8"), absolute, packageSourceRoot, sourceBase));
			}
		}
	}
	await visit(dist);
}

/** Validates one archive listing: the shape both packages share, with each package's own allow-list. */
export type PackageFileValidator = (files: readonly string[], links?: ReadonlySet<string>, expectedFiles?: ReadonlySet<string>) => void;

export interface PackageFileRules {
	/** Files published at the package root, such as `package/README.md`. */
	readonly rootFiles: readonly string[];
	/** Path prefixes whose contents publish verbatim, such as `package/kit/`. */
	readonly verbatimPrefixes?: readonly string[];
	/** Files a verbatim prefix would otherwise allow but that must never publish. */
	readonly denied?: readonly string[];
	/** The file set expected when a caller does not name one. */
	readonly defaultExpected: ReadonlySet<string>;
}

export function allowedPackageFile(file: string, rules: PackageFileRules): boolean {
	if (rules.denied?.includes(file) === true) return false;
	if (rules.rootFiles.includes(file)) return true;
	for (const prefix of rules.verbatimPrefixes ?? []) if (file.startsWith(prefix)) return true;
	if (!file.startsWith("package/dist/")) return false;
	if (file.includes(".test.")) return false;
	return /\.(?:js|js\.map|d\.ts|d\.ts\.map)$/.test(file);
}

export function packageFileValidator(rules: PackageFileRules): PackageFileValidator {
	return (files, links = new Set(), expectedFiles = rules.defaultExpected) => {
		if (links.size > 0) throw new Error(`package contains a link: ${[...links][0]}`);
		const unique = new Set<string>();
		for (const file of files) {
			if (file.includes("\\") || file.startsWith("/") || file.split("/").includes("..")) throw new Error(`unsafe package path: ${file}`);
			if (!allowedPackageFile(file, rules)) throw new Error(`unexpected package file: ${file}`);
			if (!expectedFiles.has(file)) throw new Error(`unexpected package file: ${file}`);
			if (unique.has(file)) throw new Error(`duplicate package file: ${file}`);
			unique.add(file);
		}
		for (const file of expectedFiles) if (!unique.has(file)) throw new Error(`package is missing ${file}`);
	};
}

export async function archiveFiles(
	validate: PackageFileValidator,
	tarball: string,
	cwd: string,
	expectedFiles: ReadonlySet<string>,
): Promise<readonly string[]> {
	const listing = await runCommand(["tar", "-tzf", tarball], cwd);
	const files = listing.split(/\r?\n/).filter((file) => file !== "");
	const verbose = (await runCommand(["tar", "-tvzf", tarball], cwd)).split(/\r?\n/).filter((line) => line !== "");
	if (verbose.length !== files.length) throw new Error("could not verify every package archive entry");
	const links = new Set<string>();
	for (const [index, line] of verbose.entries()) {
		const kind = line[0];
		if (kind !== "-") links.add(files[index] as string);
	}
	validate(files, links, expectedFiles);
	return [...files].sort();
}

export async function verifyExtractedFiles(tarball: string, files: readonly string[], work: string): Promise<void> {
	const extracted = path.join(work, "inspect");
	await mkdir(extracted);
	await runCommand(["tar", "-xzf", tarball, "-C", extracted], work);
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

/**
 * Packs a staged package directory with `bun pm pack` and returns the staged
 * tarball, checking that Bun produced exactly the expected filename.
 */
export async function packStagedPackage(stage: string, packedOutput: string, expectedFilename: string): Promise<string> {
	await mkdir(packedOutput, { recursive: true });
	const report = await runCommand([process.execPath, "pm", "pack", "--destination", packedOutput, "--ignore-scripts", "--quiet"], stage);
	const reportedFilename = report.split(/\r?\n/).filter(Boolean).at(-1);
	if (reportedFilename === undefined) throw new Error("bun pm pack did not report an artifact");
	if (path.basename(reportedFilename) !== expectedFilename) throw new Error(`bun pm pack reported an unexpected artifact: ${reportedFilename}`);
	const stagedTarball = path.join(packedOutput, path.basename(reportedFilename));
	const packed = await lstat(stagedTarball).catch(() => undefined);
	if (packed === undefined || !packed.isFile()) throw new Error(`bun pm pack did not create ${stagedTarball}`);
	return stagedTarball;
}
