// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the Node filesystem adapter (`./layout/node`): a document tree
// written to a directory and read back names the same files a hand-written
// tree would, the profile can be inferred from the manifest it finds, an
// ambiguous manifest is refused, and a file outside the layout's grammar is
// ignored rather than misread.
// Run with: bun test packages/ir/src/layout/node.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { YAML_PROFILE } from "../codec/yaml/index.ts";
import { fileSet } from "./kit-fixtures.test-helper.ts";
import { readTreeFromDirectory, writeTreeToDirectory } from "./node.ts";
import { readTree } from "./read-tree.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), "morphir-ir-layout-node-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	while (dirs.length > 0) {
		const dir = dirs.pop() as string;
		await rm(dir, { recursive: true, force: true });
	}
});

// Every relative path under `dir`, POSIX-separated, sorted.
async function listing(dir: string): Promise<readonly string[]> {
	const out: string[] = [];
	async function walk(base: string): Promise<void> {
		for (const entry of await readdir(path.join(dir, base), { withFileTypes: true })) {
			const relative = base === "" ? entry.name : `${base}/${entry.name}`;
			if (entry.isDirectory()) await walk(relative);
			else out.push(relative);
		}
	}
	await walk("");
	return out.sort();
}

describe("writeTreeToDirectory then readTreeFromDirectory", () => {
	test("the escape set writes to the physical names the YAML profile spells", async () => {
		const dir = await tempDir();
		await writeTreeToDirectory(dir, fileSet("escape"), YAML_PROFILE);

		expect(await listing(dir)).toEqual(["manifest.yaml", "pkg/my-org/my-project/domain/module.yaml", "pkg/my-org/my-project/domain/user-_id.type.yaml"]);
	});

	test("reading it back, with the profile given, matches readTree on the map", async () => {
		const dir = await tempDir();
		await writeTreeToDirectory(dir, fileSet("escape"), YAML_PROFILE);

		const expected = readTree(fileSet("escape"), YAML_PROFILE);
		const actual = await readTreeFromDirectory(dir, YAML_PROFILE);
		expect(actual).toEqual(expected);
	});

	test("reading it back, with no profile given, infers the profile from the manifest", async () => {
		const dir = await tempDir();
		await writeTreeToDirectory(dir, fileSet("escape"), YAML_PROFILE);

		const expected = readTree(fileSet("escape"), YAML_PROFILE);
		const actual = await readTreeFromDirectory(dir);
		expect(actual).toEqual(expected);
	});
});

describe("readTreeFromDirectory and the shape of what it finds", () => {
	test("a manifest.json beside a manifest.yaml is ambiguous", async () => {
		const dir = await tempDir();
		await writeTreeToDirectory(dir, fileSet("escape"), YAML_PROFILE);
		await writeFile(path.join(dir, "manifest.json"), '{ "formatVersion": 4, "distribution": "Library", "package": "my-org/my-project", "pathBudget": 4000 }\n');

		const r = await readTreeFromDirectory(dir);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.code).toBe("invalid_distribution_shape");
		expect(r.error.message).toBe("both manifest.json and manifest.yaml exist");
	});

	test("a stray notes.md is ignored", async () => {
		const dir = await tempDir();
		await writeTreeToDirectory(dir, fileSet("escape"), YAML_PROFILE);
		await writeFile(path.join(dir, "notes.md"), "anything at all\n");

		const expected = readTree(fileSet("escape"), YAML_PROFILE);
		const actual = await readTreeFromDirectory(dir, YAML_PROFILE);
		expect(actual).toEqual(expected);
	});

	test("a module.json under a yaml tree disagrees with the profile", async () => {
		const dir = await tempDir();
		await writeTreeToDirectory(dir, fileSet("escape"), YAML_PROFILE);
		const modulePath = path.join(dir, "pkg/my-org/my-project/domain/module.json");
		await mkdir(path.dirname(modulePath), { recursive: true });
		await writeFile(modulePath, '{ "formatVersion": 4, "path": "domain", "types": ["user-ID"], "values": [] }\n');

		const r = await readTreeFromDirectory(dir, YAML_PROFILE);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.code).toBe("invalid_distribution_shape");
		expect(r.error.message).toBe("pkg/my-org/my-project/domain/module.json is not a yaml file");
	});
});
