//
// Tests for the morphir-conformance CLI. Run with: bun test src/cli.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cli = path.join(import.meta.dir, "cli.ts");
const dirs: string[] = [];
const temp = (): string => { const d = mkdtempSync(path.join(tmpdir(), "corpus-cli-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { force: true, recursive: true }); });

const run = (...args: string[]) => {
	const r = Bun.spawnSync(["bun", "run", cli, ...args], { stdout: "pipe", stderr: "pipe" });
	return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};

describe("morphir-conformance check", () => {
	test("passes a well-formed corpus", () => {
		const d = temp();
		writeFileSync(path.join(d, "types.md"), "## types-0001: ok\n```yaml canonical\na: 1\n```\n");
		const r = run("check", d);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/1 case\(s\) in 1 file\(s\), 0 error\(s\)/);
	});
	test("fails with file:line: message on errors", () => {
		const d = temp();
		writeFileSync(path.join(d, "types.md"), "## types-1: bad\n");
		const r = run("check", d);
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/types\.md:1: malformed case id/);
	});
	test("--json prints a report object", () => {
		const d = temp();
		writeFileSync(path.join(d, "types.md"), "## types-0001: ok\n```yaml canonical\na: 1\n```\n");
		const r = run("check", d, "--json");
		expect(r.code).toBe(0);
		expect(JSON.parse(r.out)).toMatchObject({ cases: ["types-0001"], errors: [] });
	});
	test("unknown command is usage error", () => {
		const r = run("frobnicate");
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/usage: morphir-conformance check <dir> \[--json\]/);
	});
});
