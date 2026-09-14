// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectSnapshot, kitStatus, readLock, syncKit } from "./sync.ts";

const dirs: string[] = [];
const temp = (): string => {
	const d = mkdtempSync(path.join(tmpdir(), "mck-sync-"));
	dirs.push(d);
	return d;
};
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { force: true, recursive: true });
});
const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function fakeParent(): string {
	const root = temp();
	mkdirSync(path.join(root, "spec", "ir", "mck", "documents"), { recursive: true });
	mkdirSync(path.join(root, "website"), { recursive: true });
	writeFileSync(path.join(root, "spec", "ir", "mck", "types.md"), "## types-0001: t {node=Type}\n```text canonical\nwebsite/x.json\n```\n");
	writeFileSync(path.join(root, "spec", "ir", "mck", "documents", "d.yaml"), "d: 1\n");
	writeFileSync(path.join(root, "website", "x.json"), "{}\n");
	git(root, "init", "-q");
	git(root, "-c", "user.email=t@example.com", "-c", "user.name=t", "add", ".");
	git(root, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "one");
	return root;
}

describe("collectSnapshot", () => {
	test("takes every kit file plus every file a text fence names", async () => {
		const files = await collectSnapshot(fakeParent());
		expect([...files.keys()].sort()).toEqual(["spec/ir/mck/documents/d.yaml", "spec/ir/mck/types.md", "website/x.json"]);
	});
});

describe("syncKit and kitStatus", () => {
	test("writes the snapshot, lock, and embedded module; status passes; a hand edit fails status", async () => {
		const parent = fakeParent();
		const pkg = temp();
		const result = await syncKit(pkg, parent, { force: false, now: new Date("2026-09-07T00:00:00Z") });
		expect(result.commit).toBe(git(parent, "rev-parse", "HEAD"));
		expect(existsSync(path.join(pkg, "kit", "spec", "ir", "mck", "types.md"))).toBeTrue();
		expect(existsSync(path.join(pkg, "kit", "website", "x.json"))).toBeTrue();
		const lock = readLock(pkg);
		expect(lock).toMatchObject({ repository: "https://github.com/finos/morphir", path: "spec/ir/mck", commit: result.commit, syncedAt: "2026-09-07" });
		expect(readFileSync(path.join(pkg, "kit", "embedded.ts"), "utf8")).toContain('["spec/ir/mck/types.md", ');
		expect(kitStatus(pkg).ok).toBeTrue();
		writeFileSync(path.join(pkg, "kit", "spec", "ir", "mck", "types.md"), "## types-0001: edited\n");
		expect(kitStatus(pkg).ok).toBeFalse();
	});
	test("refuses to move to an ancestor of the pinned commit unless forced", async () => {
		const parent = fakeParent();
		const first = git(parent, "rev-parse", "HEAD");
		writeFileSync(path.join(parent, "spec", "ir", "mck", "values.md"), "## values-0001: v\n```json canonical\n1\n```\n");
		git(parent, "-c", "user.email=t@example.com", "-c", "user.name=t", "add", ".");
		git(parent, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "two");
		const pkg = temp();
		await syncKit(pkg, parent, { force: false });
		git(parent, "checkout", "-q", first);
		await expect(syncKit(pkg, parent, { force: false })).rejects.toThrow(/older than the pinned commit/);
		await expect(syncKit(pkg, parent, { force: true })).resolves.toMatchObject({ commit: first });
	});
});
