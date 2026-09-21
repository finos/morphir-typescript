// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import path from "node:path";
import { bindingVersion } from "./binding-version.ts";

const run = (...args: string[]) => {
	const result = Bun.spawnSync([process.execPath, path.join(import.meta.dir, "cli.ts"), ...args]);
	return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
};
test("bare mck is a package usage error", () => {
	const result = run();
	expect(result.code).toBe(2);
	expect(result.err).toContain("mck package run");
});
test("help advertises package commands", () => {
	const result = run("--help");
	expect(result.code).toBe(0);
	expect(result.out).toContain("package");
	expect(result.err).toBe("");
});
test("package run help retains adapter and contract flags", () => {
	const result = run("package", "run", "--help");
	expect(result.code).toBe(0);
	for (const flag of ["--adapter", "--adapter-arg", "--contract", "--kit", "--report", "--timeout"]) expect(result.out).toContain(flag);
});
test("unknown commands remain usage errors", () => {
	expect(run("frobnicate").code).toBe(2);
});
test("version reports the package version", () => {
	const result = run("--version");
	expect(result.code).toBe(0);
	expect(result.out.trim()).toBe(bindingVersion());
});
