//
// Tests for the mck CLI. Run with: bun test packages/mck/src/cli.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
	// A directory that is not there is an operator mistake, not a crash: like
	// `run` and `coverage`, `check` reports it as `error: <message>` and exits 1
	// rather than letting the ENOENT escape as an unhandled rejection.
	test("a missing directory is reported as an error, not a stack trace", () => {
		const r = run(["check", path.join(temp(), "not-a-directory")]);
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/^error: /m);
		expect(r.err).not.toMatch(/\bat .*cli\.ts/);
	});
	test("unknown command is usage error", () => {
		const r = run(["frobnicate"]);
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/Invalid subcommand for mck/);
		expect(r.out).toBe("");
	});
});

describe("mck", () => {
	// The command line is built on @effect/cli: the library renders help and
	// usage errors; the driver keeps the exit codes the README documents
	// (0 ok, 1 failure, 2 usage error).
	test("bare mck is a usage error naming the subcommands", () => {
		const r = run([]);
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/check/);
		expect(r.err).toMatch(/coverage/);
		expect(r.out).toBe("");
	});
	test("--help exits 0 and prints the usage to stdout", () => {
		const r = run(["--help"]);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/USAGE/);
		expect(r.out).toMatch(/\bcheck\b/);
		expect(r.out).toMatch(/\brun\b/);
		expect(r.err).toBe("");
	});
	test("run --help documents the run flags", () => {
		const r = run(["run", "--help"]);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/--adapter-arg/);
		expect(r.out).toMatch(/--timeout/);
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
	// A compiled binary has no `kit.lock.json` and no `kit/` tree: `bun build
	// --compile` puts the bundled modules under a virtual root. An empty
	// package root reproduces that layout without compiling.
	test("kit status in a compiled binary reports the embedded kit and succeeds", () => {
		const r = run(["kit", "status"], { MCK_PACKAGE_ROOT: temp() });
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/^embedded kit: finos\/morphir [0-9a-f]{40} \(compiled binary; lock file not available\)$/m);
		expect(r.err).toBe("");
	});
	test("kit sync in a compiled binary refuses with a one-line error, not a stack trace", () => {
		const r = run(["kit", "sync", fakeParent()], { MCK_PACKAGE_ROOT: temp() });
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/^error: kit sync needs a source checkout of @finos\/morphir-mck; this binary embeds the kit at finos\/morphir [0-9a-f]{40}$/m);
		expect(r.err).not.toContain("ENOENT");
	});
	test("unknown kit subcommand is a usage error", () => {
		const r = run(["kit", "frobnicate"]);
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/Invalid subcommand/);
	});
	test("bare kit is a usage error naming sync and status", () => {
		const r = run(["kit"]);
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/sync/);
		expect(r.err).toMatch(/status/);
		expect(r.out).toBe("");
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

describe("mck run", () => {
	// Pinned, not bounded: the embedded kit is a fixed set of bytes, so this
	// line moves only when a kit resync deliberately moves it.
	//
	// The two skips are versions-0001's version-3 fence, on both paths.
	test("over the embedded kit, every fence passes and only version 3 is skipped", () => {
		const r = run(["run"]);
		expect(r.out).toMatch(/^624 pass, 0 fail, 0 kit-error, 2 skipped$/m);
		expect(r.code).toBe(0);
	});
	test("the embedded kit skips only version 3", () => {
		const reportFile = path.join(temp(), "report.json");
		run(["run", "--report", reportFile]);
		const report = JSON.parse(readFileSync(reportFile, "utf8")) as { records: { caseId: string; result: string; message?: string }[] };
		const failing = report.records.filter((rec) => rec.result === "fail");
		const skipped = report.records.filter((rec) => rec.result === "skipped");
		expect(failing).toHaveLength(0);
		expect(skipped).toHaveLength(2);
		for (const rec of skipped) expect(rec.message).toBe("version 3 not in capabilities");
	});
	test("--only restricts the report to matching case ids", () => {
		const reportFile = path.join(temp(), "report.json");
		const r = run(["run", "--only", "^types-0001$", "--report", reportFile]);
		expect(r.code).toBe(0);
		const report = JSON.parse(readFileSync(reportFile, "utf8")) as { records: { caseId: string }[] };
		expect(report.records.length).toBeGreaterThan(0);
		for (const rec of report.records) expect(rec.caseId).toBe("types-0001");
	});
	test("--strict fails when any fence is skipped (version 3 is, in-process)", () => {
		const r = run(["run", "--strict"]);
		expect(r.code).toBe(1);
	});
	test("--kit against a directory with a kit error exits 1 and reports a kit-error", () => {
		const kitDir = path.join(temp(), "spec", "ir", "mck");
		mkdirSync(kitDir, { recursive: true });
		writeFileSync(path.join(kitDir, "types.md"), "## types-1: bad\n");
		const reportFile = path.join(temp(), "report.json");
		const r = run(["run", "--kit", kitDir, "--report", reportFile]);
		expect(r.code).toBe(1);
		const report = JSON.parse(readFileSync(reportFile, "utf8")) as { records: { result: string }[] };
		expect(report.records.some((rec) => rec.result === "kit-error")).toBe(true);
	});
	test("--adapter runs the kit through the given child process, matching the in-process result", () => {
		const inProcess = run(["run", "--only", "^types-0001$"]);
		const viaAdapter = run(["run", "--only", "^types-0001$", "--adapter", "bun", "--adapter-arg", path.join(packageRoot, "src", "adapter.ts")]);
		expect(viaAdapter.code).toBe(inProcess.code);
		expect(viaAdapter.out).toBe(inProcess.out);
	});
	test("--adapter naming a nonexistent executable is reported as a kit-error, not a crash", () => {
		const r = run(["run", "--only", "^types-0001$", "--adapter", "definitely-not-an-executable", "--timeout", "500"]);
		expect(r.code).toBe(1);
		expect(r.err).not.toMatch(/ at /);
		expect(r.out).toMatch(/kit-error/);
	}, 10000);
	test("--adapter-arg is repeatable", () => {
		const r = run([
			"run",
			"--only",
			"^types-0001$",
			"--adapter",
			"bun",
			"--adapter-arg",
			path.join(packageRoot, "src", "adapter.ts"),
			"--adapter-arg",
			"--suite",
			"--adapter-arg",
			"ir",
		]);
		expect(r.code).toBe(0);
	});
	test("--timeout too small surfaces the adapter as unavailable instead of hanging", () => {
		const r = run([
			"run",
			"--only",
			"^types-0001$",
			"--adapter",
			"bun",
			"--adapter-arg",
			path.join(packageRoot, "test", "fixtures", "adapter-hang.ts"),
			"--timeout",
			"50",
		]);
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/kit-error/);
	}, 10000);
	test("an invalid --only regex is a usage error naming the problem", () => {
		const r = run(["run", "--only", "("]);
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/invalid --only regex: /);
		expect(r.err).not.toMatch(/ at /);
	});
	test("a non-positive --timeout is a usage error", () => {
		const r = run(["run", "--timeout", "0"]);
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/--timeout/);
		expect(r.err).not.toMatch(/ at /);
	});
	// @effect/cli reports a trailing flag with no operand as an argument it
	// does not recognise; what matters is the exit code and the flag's name.
	test("a flag missing its operand at the end of argv is a usage error", () => {
		const r = run(["run", "--kit"]);
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/'--kit'/);
	});
});

describe("mck coverage", () => {
	test("a kit missing a variant's case reports the gap and exits 1", () => {
		const kitDir = path.join(temp(), "spec", "ir", "mck");
		mkdirSync(kitDir, { recursive: true });
		writeFileSync(path.join(kitDir, "types.md"), '## types-0001: t {node=Type}\n```json canonical\n{ "Reference": ["a:b#c"] }\n```\n');
		const r = run(["coverage", "--kit", kitDir]);
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/^Type\/Tuple has no case$/m);
	});
	test("an unknown flag is a usage error", () => {
		const r = run(["coverage", "--frobnicate"]);
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/Received unknown argument: '--frobnicate'/);
	});
	test("a flag missing its operand at the end of argv is a usage error", () => {
		const r = run(["coverage", "--kit"]);
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/'--kit'/);
	});
});

describe("mck --version", () => {
	test("prints the driver's package version", () => {
		const r = run(["--version"]);
		expect(r.code).toBe(0);
		expect(r.out.trim()).toMatch(/^\d+\.\d+\.\d+/);
	});
});
