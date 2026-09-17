// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

export const INPUT_PATHS = [
	"spec/package/mck/fixtures/two-libraries/eligibility/manifest.json",
	"spec/package/mck/fixtures/two-libraries/eligibility/ir.json",
	"spec/package/mck/fixtures/two-libraries/loan-rules/manifest.json",
	"spec/package/mck/fixtures/two-libraries/loan-rules/ir.json",
	"spec/package/mck/fixtures/two-libraries/lock-core.json",
	"spec/package/mck/fixtures/local-registry/unsigned/eligibility-statement-payload.json",
	"spec/package/mck/fixtures/local-registry/unsigned/loan-rules-statement-payload.json",
] as const;

/** Check each existing component without following links, including above the selected root. */
async function rejectSymlinks(path: string): Promise<void> {
	const absolute = resolve(path);
	let current = parse(absolute).root;
	for (const component of absolute.slice(current.length).split(sep).filter(Boolean)) {
		current = join(current, component);
		try {
			if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink is not allowed: ${current}`);
		} catch (error) {
			if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
			throw error;
		}
	}
}

function validatePaths(files: ReadonlyMap<string, Uint8Array>): void {
	for (const path of files.keys()) {
		if (
			isAbsolute(path) ||
			path.includes("\\") ||
			path.includes("\0") ||
			path.split("/").some((component) => component === "" || component === "." || component === "..")
		) {
			throw new Error(`Invalid fixture path: ${path}`);
		}
	}
}

export async function readFixtureInputs(source: string): Promise<ReadonlyMap<string, Uint8Array>> {
	return new Map(
		await Promise.all(
			INPUT_PATHS.map(async (path) => {
				const input = resolve(source, path);
				await rejectSymlinks(input);
				// The OS spells the missing path its own way (backslashes on Windows); name the input as the corpus does.
				const stats = await lstat(input).catch((cause: unknown) => {
					throw new Error(`Missing fixture input file: ${path}`, { cause });
				});
				if (!stats.isFile()) throw new Error(`Expected fixture input file: ${path}`);
				return [path, new Uint8Array(await readFile(input))] as const;
			}),
		),
	);
}

/** Author once into an empty destination. Existing files are never replaced or removed. */
export async function writeFixtureFiles(output: string, files: ReadonlyMap<string, Uint8Array>, source?: string): Promise<void> {
	validatePaths(files);
	await rejectSymlinks(output);
	if (source !== undefined) {
		await rejectSymlinks(source);
		if (resolve(source) === resolve(output)) throw new Error("Fixture output must not alias its source");
	}
	await mkdir(output, { recursive: true });
	if ((await readdir(output)).length !== 0) throw new Error(`Fixture output must be empty: ${output}`);
	for (const [path, content] of files) {
		const target = join(output, path);
		await rejectSymlinks(target);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content, { flag: "wx" });
	}
}

export async function checkFixtureFiles(dir: string, files: ReadonlyMap<string, Uint8Array>): Promise<void> {
	validatePaths(files);
	await rejectSymlinks(dir);
	const seen = new Set<string>();
	async function visit(relative: string): Promise<void> {
		for (const entry of await readdir(join(dir, relative), { withFileTypes: true })) {
			const path = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${path}`);
			if (entry.isDirectory()) {
				if (![...files.keys()].some((expected) => expected.startsWith(`${path}/`))) throw new Error(`Unexpected fixture directory: ${path}`);
				await visit(path);
			} else if (entry.isFile()) {
				const expected = files.get(path);
				if (expected !== undefined) {
					if (!Buffer.from(expected).equals(await readFile(join(dir, path)))) throw new Error(`Fixture bytes differ: ${path}`);
					seen.add(path);
				} else if (path !== "README.md") throw new Error(`Unexpected fixture file: ${path}`);
			} else throw new Error(`Unexpected fixture entry: ${path}`);
		}
	}
	await visit("");
	for (const path of files.keys()) {
		if (!seen.has(path)) throw new Error(`Missing fixture file: ${path}`);
	}
}
