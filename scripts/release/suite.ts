// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractReleaseNotes, prepareChangelog } from "./changelog.ts";
import { compareVersions, parseStableVersion, parseVersionTag, type StableVersion } from "./version.ts";

const MANIFESTS = [
	{ path: "package.json", workspace: "", name: "morphir-typescript", private: true },
	{ path: "packages/ir/package.json", workspace: "packages/ir", name: "@finos/morphir-ir", private: false },
	{ path: "packages/mck/package.json", workspace: "packages/mck", name: "@finos/morphir-mck", private: true },
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
		if (!definition.private && value.private === true) throw new Error(`${definition.name} must be public`);
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
		workspace.version = target.text;
	}
	return formatJson(files.lock, files.lockSource);
}

async function atomicReplace(root: string, outputs: ReadonlyMap<string, string>): Promise<void> {
	const temporaryFiles: { temporary: string; destination: string }[] = [];
	try {
		for (const [relativePath, contents] of outputs) {
			const destination = path.join(root, relativePath);
			const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
			await writeFile(temporary, contents, { flag: "wx" });
			temporaryFiles.push({ temporary, destination });
		}
		for (const file of temporaryFiles) await rename(file.temporary, file.destination);
	} finally {
		await Promise.all(temporaryFiles.map(({ temporary }) => unlink(temporary).catch(() => undefined)));
	}
}

export async function prepareSuiteRelease(root: string, targetInput: string, date: string): Promise<StableVersion> {
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
	await atomicReplace(root, outputs);
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
