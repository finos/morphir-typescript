// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { binaryNames, buildBinaries, hostTarget, selectedTargets, TARGETS } from "./binaries.ts";

const root = path.resolve(import.meta.dir, "../..");
const version = JSON.parse(await readFile(path.join(root, "packages/mck/package.json"), "utf8")).version as string;

const workspaces: string[] = [];

afterAll(async () => {
	// Windows keeps a handle on an executable image for a moment after the
	// process exits, so removing a just-run binary can fail with EPERM. The
	// directory is under the system temp root; leaving it is harmless.
	for (const workspace of workspaces) await rm(workspace, { recursive: true, force: true }).catch(() => {});
});

async function workspace(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "morphir-binaries-"));
	workspaces.push(directory);
	return directory;
}

async function runBinary(binary: string, args: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const child = Bun.spawn([binary, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	return { stdout, stderr, exitCode };
}

describe("binaryNames", () => {
	test("names both executables for every target in a fixed order", () => {
		expect(binaryNames("1.2.3")).toEqual([
			"mck-1.2.3-linux-x64",
			"mck-adapter-typescript-1.2.3-linux-x64",
			"mck-1.2.3-linux-arm64",
			"mck-adapter-typescript-1.2.3-linux-arm64",
			"mck-1.2.3-darwin-x64",
			"mck-adapter-typescript-1.2.3-darwin-x64",
			"mck-1.2.3-darwin-arm64",
			"mck-adapter-typescript-1.2.3-darwin-arm64",
			"mck-1.2.3-windows-x64.exe",
			"mck-adapter-typescript-1.2.3-windows-x64.exe",
		]);
		expect(binaryNames("1.2.3")).toHaveLength(TARGETS.length * 2);
	});

	test("substitutes the version verbatim so the workflow can pin the same list", () => {
		// The release workflow passes its own `${version}` shell expansion.
		const expansion = `${String.fromCharCode(36)}{version}`;
		expect(binaryNames(expansion)).toContain(`mck-${expansion}-darwin-arm64`);
	});
});

describe("selectedTargets", () => {
	test("compiles every target when the environment names none", () => {
		expect(selectedTargets(undefined)).toEqual(TARGETS);
		expect(selectedTargets("")).toEqual(TARGETS);
	});

	test("limits the matrix to the host target", () => {
		expect(selectedTargets("host")).toEqual([TARGETS.find(([target]) => target === hostTarget())] as typeof TARGETS);
	});

	test("accepts an explicit comma-separated subset and rejects an unknown target", () => {
		expect(selectedTargets("bun-darwin-arm64,bun-linux-x64")).toEqual([
			["bun-darwin-arm64", "darwin", "arm64"],
			["bun-linux-x64", "linux", "x64"],
		]);
		expect(() => selectedTargets("bun-plan9-x64")).toThrow(/unknown binary target/);
	});
});

describe("buildBinaries", () => {
	test("compiles a self-contained driver and adapter for the host target", async () => {
		const output = await workspace();
		const previous = process.env.MCK_BINARY_TARGETS;
		process.env.MCK_BINARY_TARGETS = "host";
		let built: readonly string[];
		try {
			built = await buildBinaries(root, output);
		} finally {
			if (previous === undefined) delete process.env.MCK_BINARY_TARGETS;
			else process.env.MCK_BINARY_TARGETS = previous;
		}

		const [, hostName, hostArch] = selectedTargets("host")[0] as [string, string, string];
		expect(built.map((binary) => path.basename(binary))).toEqual([
			`mck-${version}-${hostName}-${hostArch}${hostName === "windows" ? ".exe" : ""}`,
			`mck-adapter-typescript-${version}-${hostName}-${hostArch}${hostName === "windows" ? ".exe" : ""}`,
		]);
		for (const binary of built) expect(path.dirname(binary)).toBe(output);

		// Everything below runs from the temp workspace, never the checkout, so
		// what the test proves is that the binary is self-contained: no
		// repository, no `node_modules`, and no Node installation.
		const driver = built[0] as string;
		const reported = await runBinary(driver, ["--version"], output);
		expect(reported.exitCode).toBe(0);
		expect(reported.stdout.trim()).toBe(version);

		// The compiled driver carries the vendored kit.
		const run = await runBinary(driver, ["run", "--only", "^types-0001$"], output);
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("pass");

		// There is no `kit.lock.json` inside the compiled binary's virtual
		// root, so `kit status` reports the embedded kit instead of failing
		// with ENOENT on a path under it.
		const status = await runBinary(driver, ["kit", "status"], output);
		expect(status.exitCode).toBe(0);
		expect(status.stdout).toContain("embedded kit:");
	}, 600_000);
});
