// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadKit, loadKitFromFiles } from "./load.ts";
import { KIT_PATH, kitFilesFromDirectory, kitFilesFromMap, profileOfPath, resolveTextFence, textFenceTarget } from "./source.ts";

const dirs: string[] = [];
const temp = (): string => {
	const d = mkdtempSync(path.join(tmpdir(), "mck-source-"));
	dirs.push(d);
	return d;
};
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { force: true, recursive: true });
});

describe("kitFilesFromDirectory", () => {
	test("lists the kit's files under spec/ir/mck and reads them", () => {
		const root = temp();
		const kit = path.join(root, "spec", "ir", "mck");
		mkdirSync(path.join(kit, "documents"), { recursive: true });
		writeFileSync(path.join(kit, "types.md"), "## types-0001: t\n```json canonical\n1\n```\n");
		writeFileSync(path.join(kit, "documents", "a.yaml"), "a: 1\n");
		const files = kitFilesFromDirectory(kit, root);
		expect(files.list().sort()).toEqual([`${KIT_PATH}/documents/a.yaml`, `${KIT_PATH}/types.md`]);
		expect(files.read(`${KIT_PATH}/documents/a.yaml`)).toBe("a: 1\n");
		expect(files.display(`${KIT_PATH}/types.md`)).toBe(path.join(kit, "types.md"));
	});
	test("reads a repository file outside the kit only when a root is given", () => {
		const root = temp();
		const kit = path.join(root, "spec", "ir", "mck");
		mkdirSync(kit, { recursive: true });
		mkdirSync(path.join(root, "website"), { recursive: true });
		writeFileSync(path.join(root, "website", "x.json"), "{}\n");
		expect(kitFilesFromDirectory(kit, root).read("website/x.json")).toBe("{}\n");
		expect(kitFilesFromDirectory(kit).read("website/x.json")).toBeNull();
		expect(kitFilesFromDirectory(kit).read("../../etc/passwd")).toBeNull();
	});
	test("rejects backslash-separated traversal payloads even though a root is given", () => {
		const root = temp();
		const kit = path.join(root, "spec", "ir", "mck");
		mkdirSync(kit, { recursive: true });
		// A file placed exactly where the traversal payloads would land if the
		// backslash segment were naively joined instead of rejected: one level
		// above root (".."), which is where "..\\secret.txt" resolves on
		// Windows, and the same place "spec/ir/mck/..\\..\\secret.txt" resolves
		// once its POSIX segments walk back up into the kit directory.
		const secret = path.join(path.dirname(root), "secret.txt");
		writeFileSync(secret, "top secret\n");
		try {
			const files = kitFilesFromDirectory(kit, root);
			expect(files.read("..\\secret.txt")).toBeNull();
			expect(files.read("spec/ir/mck/..\\..\\secret.txt")).toBeNull();
			expect(files.display("..\\secret.txt")).toBe("..\\secret.txt");
		} finally {
			rmSync(secret, { force: true });
		}
	});
});

describe("loadKitFromFiles", () => {
	test("parses every top-level case file except README.md, in name order, and keeps the source", async () => {
		const files = kitFilesFromMap(
			"embedded",
			new Map([
				[`${KIT_PATH}/values.md`, "## values-0001: v\n```json canonical\n1\n```\n"],
				[`${KIT_PATH}/README.md`, "# not a case file\n"],
				[`${KIT_PATH}/types.md`, "## types-0001: t\n```json canonical\n1\n```\n"],
				[`${KIT_PATH}/documents/d.yaml`, "d: 1\n"],
			]),
		);
		const kit = await loadKitFromFiles(files);
		expect(kit.errors).toEqual([]);
		expect(kit.files).toEqual([`${KIT_PATH}/types.md`, `${KIT_PATH}/values.md`]);
		expect(kit.cases.map((c) => c.id)).toEqual(["types-0001", "values-0001"]);
		expect(kit.source).toBe(files);
	});
});

describe("text fences", () => {
	test("textFenceTarget is the first non-empty line", () => {
		expect(textFenceTarget("\n  spec/ir/mck/documents/x.yaml \n")).toBe("spec/ir/mck/documents/x.yaml");
	});
	test("profileOfPath", () => {
		expect(profileOfPath("a/b.json")).toBe("json");
		expect(profileOfPath("a/b.yaml")).toBe("yaml");
		expect(profileOfPath("a/b.yml")).toBe("yaml");
		expect(profileOfPath("a/b.txt")).toBeNull();
	});
	test("resolveTextFence returns the file's content and profile, or an error naming the path", async () => {
		const files = kitFilesFromMap(
			"embedded",
			new Map([
				[
					`${KIT_PATH}/distributions.md`,
					"## distributions-0001: d {node=Distribution}\n```text canonical\nwebsite/x.json\n```\n```text canonical\nmissing.yaml\n```\n",
				],
				["website/x.json", '{"a":1}\n'],
			]),
		);
		const kit = await loadKitFromFiles(files);
		const [f0, f1] = kit.cases[0]?.fences ?? [];
		expect(resolveTextFence(kit, f0!)).toEqual({ ok: true, path: "website/x.json", profile: "json", content: '{"a":1}\n' });
		expect(resolveTextFence(kit, f1!)).toEqual({ ok: false, message: "text fence names missing.yaml, which is not in the kit source (embedded)" });
	});
	test("loadKit over a directory resolves text fences through the repository root", async () => {
		const root = temp();
		const kit = path.join(root, "spec", "ir", "mck");
		mkdirSync(kit, { recursive: true });
		mkdirSync(path.join(root, "website"), { recursive: true });
		writeFileSync(path.join(root, "website", "x.json"), "{}\n");
		writeFileSync(path.join(kit, "distributions.md"), "## distributions-0001: d\n```text canonical\nwebsite/x.json\n```\n");
		const loaded = await loadKit(kit, root);
		expect(resolveTextFence(loaded, loaded.cases[0]!.fences[0]!)).toMatchObject({ ok: true, content: "{}\n" });
	});
});
