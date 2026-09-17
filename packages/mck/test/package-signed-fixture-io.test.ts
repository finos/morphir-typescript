// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkFixtureFiles, readFixtureInputs, writeFixtureFiles } from "./support/package-signed-fixture-io.ts";

const temporaryDirectories: string[] = [];
const inputPaths = [
	"spec/package/mck/fixtures/two-libraries/eligibility/manifest.json",
	"spec/package/mck/fixtures/two-libraries/eligibility/ir.json",
	"spec/package/mck/fixtures/two-libraries/loan-rules/manifest.json",
	"spec/package/mck/fixtures/two-libraries/loan-rules/ir.json",
	"spec/package/mck/fixtures/two-libraries/lock-core.json",
	"spec/package/mck/fixtures/local-registry/unsigned/eligibility-statement-payload.json",
	"spec/package/mck/fixtures/local-registry/unsigned/loan-rules-statement-payload.json",
];
const bytes = (value: string) => new TextEncoder().encode(value);
const generated = new Map([
	["keys/publisher.json", bytes('{"key":"public"}\n')],
	["payload.bin", new Uint8Array([0, 255, 13, 10])],
]);

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(await realpath(tmpdir()), "mck-fixture-io-"));
	temporaryDirectories.push(directory);
	return directory;
}

async function populate(directory: string, files: ReadonlyMap<string, Uint8Array>): Promise<void> {
	for (const [path, content] of files) {
		await mkdir(dirname(join(directory, path)), { recursive: true });
		await writeFile(join(directory, path), content);
	}
}

async function sourceDirectory(): Promise<string> {
	const directory = await temporaryDirectory();
	await populate(directory, new Map(inputPaths.map((path) => [path, bytes(`${path}\n`)])));
	return directory;
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("signed fixture input and output", () => {
	test("reads precisely the seven required inputs as exact bytes", async () => {
		const source = await sourceDirectory();
		await writeFile(join(source, "unrelated.txt"), "ignored");
		const inputs = await readFixtureInputs(source);
		expect([...inputs.keys()].sort()).toEqual([...inputPaths].sort());
		for (const path of inputPaths) expect(inputs.get(path)).toEqual(bytes(`${path}\n`));
	});

	test("reports a missing input with its path", async () => {
		const source = await sourceDirectory();
		const path = inputPaths[0] as string;
		await rm(join(source, path));
		await expect(readFixtureInputs(source)).rejects.toThrow(path);
	});

	test("rejects a symlink input", async () => {
		const source = await sourceDirectory();
		const path = inputPaths[0] as string;
		await rm(join(source, path));
		await symlink(join(source, inputPaths[1] as string), join(source, path));
		await expect(readFixtureInputs(source)).rejects.toThrow(/symlink/i);
	});

	test("rejects symlinks in source ancestors", async () => {
		const source = await sourceDirectory();
		const parent = await temporaryDirectory();
		await symlink(source, join(parent, "alias"));
		await expect(readFixtureInputs(join(parent, "alias"))).rejects.toThrow(/symlink/i);
	});

	test("writes exact bytes into an absent or empty output directory", async () => {
		const parent = await temporaryDirectory();
		for (const output of [parent, join(parent, "new", "output")]) {
			await writeFixtureFiles(output, generated);
			for (const [path, content] of generated) expect(new Uint8Array(await readFile(join(output, path)))).toEqual(content);
		}
	});

	test("refuses a nonempty output without modifying its files", async () => {
		const output = await temporaryDirectory();
		await populate(output, generated);
		await expect(writeFixtureFiles(output, new Map([["replacement", bytes("new")]]))).rejects.toThrow(/empty/i);
		for (const [path, content] of generated) expect(new Uint8Array(await readFile(join(output, path)))).toEqual(content);
	});

	test("refuses source as output even when empty", async () => {
		const source = await temporaryDirectory();
		await expect(writeFixtureFiles(join(source, "."), generated, source)).rejects.toThrow(/source/i);
	});

	test("refuses output symlinks and symlink ancestors", async () => {
		const parent = await temporaryDirectory();
		const target = await temporaryDirectory();
		const alias = join(parent, "alias");
		await symlink(target, alias);
		await expect(writeFixtureFiles(alias, generated)).rejects.toThrow(/symlink/i);
		await expect(writeFixtureFiles(join(alias, "nested"), generated)).rejects.toThrow(/symlink/i);
	});

	test("refuses a source symlink alias of an empty output", async () => {
		const output = await temporaryDirectory();
		const parent = await temporaryDirectory();
		const source = join(parent, "source-alias");
		await symlink(output, source);
		await expect(writeFixtureFiles(output, generated, source)).rejects.toThrow(/symlink|source/i);
	});

	test("rejects escaping and noncanonical generated paths before writing", async () => {
		for (const path of ["../escape", "/absolute", "a/../escape", "a//b", "a\\b", "./file", ""]) {
			const output = await temporaryDirectory();
			await expect(writeFixtureFiles(output, new Map([[path, bytes("bad")]]))).rejects.toThrow(/path/i);
		}
	});

	test("checks exact files and permits only a root README.md as extra content", async () => {
		const output = await temporaryDirectory();
		await populate(output, generated);
		await writeFile(join(output, "README.md"), "fixture provenance");
		await expect(checkFixtureFiles(output, generated)).resolves.toBeUndefined();
	});

	test("detects a byte difference", async () => {
		const output = await temporaryDirectory();
		await populate(output, generated);
		await writeFile(join(output, "payload.bin"), new Uint8Array([0, 255, 13]));
		await expect(checkFixtureFiles(output, generated)).rejects.toThrow(/payload.bin/);
	});

	test("detects a missing file", async () => {
		const output = await temporaryDirectory();
		await populate(output, generated);
		await rm(join(output, "payload.bin"));
		await expect(checkFixtureFiles(output, generated)).rejects.toThrow(/payload.bin/);
	});

	test("rejects unexpected files, nested READMEs, and empty directories", async () => {
		for (const extra of ["extra.json", "keys/README.md", "empty/"]) {
			const output = await temporaryDirectory();
			await populate(output, generated);
			if (extra.endsWith("/")) await mkdir(join(output, extra));
			else await writeFile(join(output, extra), "extra");
			await expect(checkFixtureFiles(output, generated)).rejects.toThrow(/unexpected/i);
		}
	});

	test("rejects symlinks including the allowed README and check root", async () => {
		const output = await temporaryDirectory();
		await populate(output, generated);
		await symlink(join(output, "payload.bin"), join(output, "README.md"));
		await expect(checkFixtureFiles(output, generated)).rejects.toThrow(/symlink/i);
		const parent = await temporaryDirectory();
		await symlink(output, join(parent, "alias"));
		await expect(checkFixtureFiles(join(parent, "alias"), generated)).rejects.toThrow(/symlink/i);
	});
});
