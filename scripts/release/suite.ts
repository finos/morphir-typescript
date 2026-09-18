// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { constants } from "node:fs";
import { copyFile, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser";
import { extractReleaseNotes, prepareChangelog } from "./changelog.ts";
import { compareVersions, parseStableVersion, parseVersionTag, type StableVersion } from "./version.ts";

const MANIFESTS = [
	{ path: "package.json", workspace: "", name: "morphir-typescript", private: true },
	{ path: "packages/ir/package.json", workspace: "packages/ir", name: "@finos/morphir-ir", private: false },
	{ path: "packages/mck/package.json", workspace: "packages/mck", name: "@finos/morphir-mck", private: false },
	{ path: "packages/sdk/package.json", workspace: "packages/sdk", name: "@finos/morphir-sdk", private: false },
] as const;

const LOCK_PATH = "bun.lock";
const CHANGELOG_PATH = "CHANGELOG.md";

interface PackageManifest {
	name?: unknown;
	version?: unknown;
	private?: unknown;
	[key: string]: unknown;
}

interface WorkspaceLock {
	name?: unknown;
	version?: unknown;
	[key: string]: unknown;
}

interface ParsedLockfile {
	workspaces?: Record<string, WorkspaceLock>;
	[key: string]: unknown;
}

interface SuiteFiles {
	readonly manifests: readonly { readonly definition: (typeof MANIFESTS)[number]; readonly source: string; readonly value: PackageManifest }[];
	readonly lockSource: string;
	readonly lock: ParsedLockfile;
	readonly changelog: string;
}

export interface ReleaseFileSystem {
	readonly writeFile: (file: string, contents: string, options: { readonly flag: "wx" }) => Promise<unknown>;
	readonly copyFile: (from: string, to: string, mode: number) => Promise<unknown>;
	readonly rename: (from: string, to: string) => Promise<unknown>;
	readonly unlink: (file: string) => Promise<unknown>;
}

export interface PrepareSuiteReleaseOptions {
	readonly fileSystem?: ReleaseFileSystem;
}

const NODE_FILE_SYSTEM: ReleaseFileSystem = { writeFile, copyFile, rename, unlink };

function parseObject(source: string, description: string): Record<string, unknown> {
	const value: unknown = JSON.parse(source);
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${description} must contain a JSON object`);
	return value as Record<string, unknown>;
}

async function readSuite(root: string): Promise<SuiteFiles> {
	const manifests = await Promise.all(
		MANIFESTS.map(async (definition) => {
			const source = await readFile(path.join(root, definition.path), "utf8");
			return { definition, source, value: parseObject(source, definition.path) };
		}),
	);
	const lockSource = await readFile(path.join(root, LOCK_PATH), "utf8");
	const parsedLock: unknown = Bun.JSONC.parse(lockSource);
	if (parsedLock === null || typeof parsedLock !== "object" || Array.isArray(parsedLock)) throw new Error("bun.lock must contain an object");
	const changelog = await readFile(path.join(root, CHANGELOG_PATH), "utf8");
	return { manifests, lockSource, lock: parsedLock as ParsedLockfile, changelog };
}

function currentVersion(files: SuiteFiles): StableVersion {
	const versions = files.manifests.map(({ value }) => parseStableVersion(String(value.version)));
	const first = versions[0] as StableVersion;
	if (versions.some((version) => version.text !== first.text)) throw new Error("suite package versions do not match");
	return first;
}

function validateManifests(files: SuiteFiles): void {
	for (const { definition, value } of files.manifests) {
		if (value.name !== definition.name) throw new Error(`${definition.path} must be named ${definition.name}`);
		if (definition.private && value.private !== true) {
			throw new Error(definition.path === "package.json" ? "root package must be private" : `${definition.name} must be private`);
		}
		if (!definition.private && value.private !== undefined && value.private !== false) throw new Error(`${definition.name} must be public`);
	}
}

function eol(source: string): "\n" | "\r\n" {
	return source.includes("\r\n") ? "\r\n" : "\n";
}

function formatJson(value: unknown, original: string): string {
	const indent = /^\t/m.test(original) ? "\t" : 2;
	return `${JSON.stringify(value, null, indent).replaceAll("\n", eol(original))}${eol(original)}`;
}

function updatedLock(files: SuiteFiles, current: StableVersion, target: StableVersion): string {
	const workspaces = files.lock.workspaces;
	if (workspaces === undefined || workspaces === null || typeof workspaces !== "object" || Array.isArray(workspaces))
		throw new Error("bun.lock is missing workspaces");
	const expectedPaths = new Set<string>(MANIFESTS.map((definition) => definition.workspace));
	for (const workspacePath of Object.keys(workspaces)) {
		if (!expectedPaths.has(workspacePath)) throw new Error(`bun.lock has unexpected workspace ${workspacePath || "<root>"}`);
	}
	for (const definition of MANIFESTS) {
		const workspace = workspaces[definition.workspace];
		if (workspace?.name !== definition.name) throw new Error(`bun.lock workspace ${definition.workspace || "<root>"} has the wrong name`);
		if (workspace.version !== current.text) throw new Error(`bun.lock workspace ${definition.workspace || "<root>"} has the wrong version`);
	}
	const parseErrors: ParseError[] = [];
	parse(files.lockSource, parseErrors, { allowTrailingComma: true });
	if (parseErrors.length > 0) throw new Error(`jsonc-parser could not parse bun.lock at offset ${parseErrors[0]?.offset}`);
	let source = files.lockSource;
	for (const definition of MANIFESTS) {
		const edits = modify(source, ["workspaces", definition.workspace, "version"], target.text, {});
		source = applyEdits(source, edits);
	}
	return source;
}

interface StagedReplacement {
	readonly destination: string;
	readonly temporary: string;
	readonly backup: string;
	readonly contents: string;
	backedUp: boolean;
	replaced: boolean;
}

async function cleanupFiles(fileSystem: ReleaseFileSystem, files: readonly string[]): Promise<unknown[]> {
	const failures: unknown[] = [];
	for (const file of files) {
		try {
			await fileSystem.unlink(file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") failures.push(error);
		}
	}
	return failures;
}

/**
 * Keeps every destination present during replacement and restores replaced files
 * after in-process errors. This is not crash-level multi-file atomicity.
 */
async function atomicReplace(root: string, outputs: ReadonlyMap<string, string>, fileSystem: ReleaseFileSystem): Promise<void> {
	const staged: StagedReplacement[] = [...outputs].map(([relativePath, contents]) => {
		const destination = path.join(root, relativePath);
		const id = crypto.randomUUID();
		return {
			destination,
			temporary: `${destination}.release-${id}.tmp`,
			backup: `${destination}.release-${id}.backup`,
			contents,
			backedUp: false,
			replaced: false,
		};
	});

	try {
		for (const file of staged) await fileSystem.writeFile(file.temporary, file.contents, { flag: "wx" });
	} catch (error) {
		const cleanupFailures = await cleanupFiles(
			fileSystem,
			staged.map((file) => file.temporary),
		);
		if (cleanupFailures.length > 0) throw new AggregateError([error, ...cleanupFailures], "release staging failed and temporary-file cleanup also failed");
		throw error;
	}

	try {
		for (const file of staged) {
			await fileSystem.copyFile(file.destination, file.backup, constants.COPYFILE_EXCL);
			file.backedUp = true;
		}
	} catch (error) {
		const cleanupFailures = [
			...(await cleanupFiles(
				fileSystem,
				staged.map((file) => file.temporary),
			)),
			...(await cleanupFiles(
				fileSystem,
				staged.map((file) => file.backup),
			)),
		];
		if (cleanupFailures.length > 0) throw new AggregateError([error, ...cleanupFailures], "release backup staging failed and cleanup also failed");
		throw error;
	}

	try {
		for (const file of staged) {
			await fileSystem.rename(file.temporary, file.destination);
			file.replaced = true;
		}
	} catch (error) {
		const rollbackFailures: unknown[] = [];
		for (const file of staged.toReversed()) {
			if (file.replaced && file.backedUp) {
				try {
					await fileSystem.rename(file.backup, file.destination);
					file.backedUp = false;
					file.replaced = false;
				} catch (rollbackError) {
					rollbackFailures.push(rollbackError);
				}
			}
		}
		rollbackFailures.push(
			...(await cleanupFiles(
				fileSystem,
				staged.map((file) => file.temporary),
			)),
			...(await cleanupFiles(
				fileSystem,
				staged.filter((file) => !file.replaced).map((file) => file.backup),
			)),
		);
		if (rollbackFailures.length > 0) {
			const retainedBackups = staged.filter((file) => file.replaced && file.backedUp).map((file) => file.backup);
			throw new AggregateError(
				[error, ...rollbackFailures],
				`release update failed and rollback also failed; original files may remain in: ${retainedBackups.join(", ")}`,
			);
		}
		throw error;
	}

	const cleanupFailures = await cleanupFiles(
		fileSystem,
		staged.map((file) => file.backup),
	);
	if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures, "release updated, but backup-file cleanup failed");
}

export async function prepareSuiteRelease(root: string, targetInput: string, date: string, options: PrepareSuiteReleaseOptions = {}): Promise<StableVersion> {
	const target = parseStableVersion(targetInput);
	const files = await readSuite(root);
	validateManifests(files);
	const current = currentVersion(files);
	if (compareVersions(target, current) <= 0) throw new Error(`release version ${target.text} must be newer than ${current.text}`);
	const outputs = new Map<string, string>();
	for (const { definition, source, value } of files.manifests) {
		value.version = target.text;
		outputs.set(definition.path, formatJson(value, source));
	}
	outputs.set(LOCK_PATH, updatedLock(files, current, target));
	outputs.set(CHANGELOG_PATH, prepareChangelog(files.changelog, target, date));
	await atomicReplace(root, outputs, options.fileSystem ?? NODE_FILE_SYSTEM);
	return target;
}

export async function validateSuiteRelease(root: string, tagInput: string): Promise<StableVersion> {
	const tag = parseVersionTag(tagInput);
	const files = await readSuite(root);
	validateManifests(files);
	const current = currentVersion(files);
	if (tag.text !== current.text) throw new Error(`release tag ${tagInput} does not match suite version ${current.text}`);
	updatedLock(files, current, current);
	extractReleaseNotes(files.changelog, current);
	return current;
}
