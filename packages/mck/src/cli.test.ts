//
// Tests for the mck CLI. Run with: bun test packages/mck/src/cli.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cli = path.join(import.meta.dir, "cli.ts");
const packageRoot = path.resolve(import.meta.dir, "..");
const dirs: string[] = [];
const temp = (): string => {
	const d = mkdtempSync(path.join(tmpdir(), "mck-cli-"));
	dirs.push(d);
	return d;
};
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { force: true, recursive: true });
});

const run = (args: string[], env: Record<string, string> = {}) => {
	const r = Bun.spawnSync(["bun", "run", cli, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
	return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};

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

function fakePackage(): string {
	const pkg = temp();
	cpSync(packageRoot, pkg, { recursive: true });
	return pkg;
}

describe("mck check", () => {
	test("passes a well-formed kit", () => {
		const d = temp();
		writeFileSync(path.join(d, "types.md"), "## types-0001: ok\n```yaml canonical\na: 1\n```\n");
		const r = run(["check", d]);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/1 case\(s\) in 1 file\(s\), 0 error\(s\)/);
	});
	test("fails with file:line: message on errors", () => {
		const d = temp();
		writeFileSync(path.join(d, "types.md"), "## types-1: bad\n");
		const r = run(["check", d]);
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/types\.md:1: malformed case id/);
	});
	test("--json prints a report object", () => {
		const d = temp();
		writeFileSync(path.join(d, "types.md"), "## types-0001: ok\n```yaml canonical\na: 1\n```\n");
		const r = run(["check", d, "--json"]);
		expect(r.code).toBe(0);
		expect(JSON.parse(r.out)).toMatchObject({ cases: ["types-0001"], errors: [] });
	});
	test("unknown command is usage error", () => {
		const r = run(["frobnicate"]);
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/usage: mck check <dir> \[--json\]/);
	});
});

describe("mck kit", () => {
	test("kit status on the real package passes", () => {
		const r = run(["kit", "status"]);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/kit matches kit\.lock\.json \([0-9a-f]+\)/);
	});
	test("kit sync writes the snapshot, lock, and embedded module; status then passes", () => {
		const parent = fakeParent();
		const pkg = fakePackage();
		const sync = run(["kit", "sync", parent], { MCK_PACKAGE_ROOT: pkg });
		expect(sync.code).toBe(0);
		expect(sync.out).toMatch(/kit synced to [0-9a-f]+ \(3 files, sha256-[0-9a-f]+\)/);
		const status = run(["kit", "status"], { MCK_PACKAGE_ROOT: pkg });
		expect(status.code).toBe(0);
		expect(status.out).toMatch(/kit matches kit\.lock\.json \([0-9a-f]+\)/);
	});
	test("kit status fails after a hand edit", () => {
		const parent = fakeParent();
		const pkg = fakePackage();
		run(["kit", "sync", parent], { MCK_PACKAGE_ROOT: pkg });
		writeFileSync(path.join(pkg, "kit", "spec", "ir", "mck", "types.md"), "## types-0001: edited\n");
		const status = run(["kit", "status"], { MCK_PACKAGE_ROOT: pkg });
		expect(status.code).toBe(1);
		expect(status.err).toMatch(/kit differs from kit\.lock\.json: expected sha256-\S+ actual sha256-\S+/);
	});
	test("unknown kit subcommand is a usage error", () => {
		const r = run(["kit", "frobnicate"]);
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/usage: mck kit sync <repository-root> \[--force\]/);
	});
	test("kit sync against a repository without spec/ir/mck fails with a one-line message, not a stack trace", () => {
		const notAKit = temp();
		git(notAKit, "init", "-q");
		writeFileSync(path.join(notAKit, "README.md"), "not a kit\n");
		git(notAKit, "-c", "user.email=t@example.com", "-c", "user.name=t", "add", ".");
		git(notAKit, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "one");
		const pkg = fakePackage();
		const r = run(["kit", "sync", notAKit], { MCK_PACKAGE_ROOT: pkg });
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/^error: /m);
		expect(r.err).not.toMatch(/ at /);
	});
	test("kit sync refuses to move to an ancestor of the pinned commit, reported as a one-line error", () => {
		const parent = fakeParent();
		const first = git(parent, "rev-parse", "HEAD");
		writeFileSync(path.join(parent, "spec", "ir", "mck", "values.md"), "## values-0001: v\n```json canonical\n1\n```\n");
		git(parent, "-c", "user.email=t@example.com", "-c", "user.name=t", "add", ".");
		git(parent, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "two");
		const pkg = fakePackage();
		const firstSync = run(["kit", "sync", parent], { MCK_PACKAGE_ROOT: pkg });
		expect(firstSync.code).toBe(0);
		git(parent, "checkout", "-q", first);
		const r = run(["kit", "sync", parent], { MCK_PACKAGE_ROOT: pkg });
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/^error: /m);
		expect(r.err).toContain("older than the pinned commit");
	});
});
