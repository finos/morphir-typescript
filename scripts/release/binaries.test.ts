// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { binaryNames, hostTarget, selectedTargets, TARGETS } from "./binaries.ts";
import { runReleaseCli } from "./cli.ts";

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

describe("binaryNames", () => {
	test("names only the adapter for every target in a fixed order", () => {
		expect(binaryNames("1.2.3")).toEqual([
			"mck-adapter-typescript-1.2.3-linux-x64",
			"mck-adapter-typescript-1.2.3-linux-arm64",
			"mck-adapter-typescript-1.2.3-darwin-x64",
			"mck-adapter-typescript-1.2.3-darwin-arm64",
			"mck-adapter-typescript-1.2.3-windows-x64.exe",
		]);
		expect(binaryNames("1.2.3")).toHaveLength(TARGETS.length);
	});

	test("substitutes the version verbatim so the workflow can pin the same list", () => {
		// The release workflow passes its own `${version}` shell expansion.
		const expansion = `${String.fromCharCode(36)}{version}`;
		expect(binaryNames(expansion)).toContain(`mck-adapter-typescript-${expansion}-darwin-arm64`);
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
	test("the adapter builds without driver or kit modules", async () => {
		const build = await Bun.build({
			entrypoints: [path.join(root, "packages/mck/src/adapter.ts")],
			target: "bun",
			plugins: [
				{
					name: "adapter-boundary",
					setup(builder) {
						builder.onLoad({ filter: /[/\\]mck[/\\](?:kit[/\\]|src[/\\](?:driver|kit|coverage)[/\\])/ }, (args) => {
							throw new Error(`adapter depends on retired tooling: ${args.path}`);
						});
					},
				},
			],
		});
		expect(build.logs).toEqual([]);
		expect(build.success).toBe(true);
	});

	test("the release binaries route runs IR and package protocols without tool runtimes", async () => {
		const output = await workspace();
		const previous = process.env.MCK_BINARY_TARGETS;
		process.env.MCK_BINARY_TARGETS = "host";
		const built: string[] = [];
		try {
			await runReleaseCli(["binaries", output], { root, stdout: (binary) => built.push(binary) });
		} finally {
			if (previous === undefined) delete process.env.MCK_BINARY_TARGETS;
			else process.env.MCK_BINARY_TARGETS = previous;
		}
		const [, os, arch] = selectedTargets("host")[0] as [string, string, string];
		const name = `mck-adapter-typescript-${version}-${os}-${arch}${os === "windows" ? ".exe" : ""}`;
		expect(await readdir(output)).toEqual([name]);
		expect(built).toEqual([path.join(output, name)]);
		const home = path.join(output, "home");
		await mkdir(home);
		const env = {
			PATH: "",
			HOME: home,
			USERPROFILE: home,
			LOCALAPPDATA: home,
			APPDATA: home,
			TMPDIR: home,
			TMP: home,
			TEMP: home,
			...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
		};
		for (const args of [[], ["--suite", "package"], ["--suite", "package", "--contract", "0.1.0-draft.2"]]) {
			const child = Bun.spawn([built[0] as string, ...args], {
				cwd: output,
				env,
				stdin: new Response('{"id":1,"op":"capabilities"}\n{"id":2,"op":"exit"}\n'),
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
			expect({ stderr, code }).toEqual({ stderr: "", code: 0 });
			const capabilities = JSON.parse(stdout);
			expect(capabilities.id).toBe(1);
			if (args.length === 0) expect(capabilities.binding).toBe("morphir-typescript");
			else expect(capabilities.implementationVersion).toBe(version);
		}

		// Opt in with an absolute released/native CLI path. A supplied bad path
		// fails; this never substitutes the frozen TypeScript driver.
		const native = process.env.MORPHIR_MCK_NATIVE_CLI;
		if (native !== undefined) {
			expect(path.isAbsolute(native)).toBe(true);
			const run = async (args: string[]) => {
				const child = Bun.spawn([native, ...args], { cwd: output, env: { ...env, MORPHIR_LOG_FILE: "false" }, stdout: "pipe", stderr: "pipe" });
				const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
				expect(code, `${stdout}\n${stderr}`).toBe(0);
				return stdout;
			};
			await run(["mck", "kit", "vendor", "--source", "embedded", "--dest", "kit"]);
			await run(["mck", "run", "--adapter", built[0] as string, "--kit", "kit", "--report", "report.json"]);
			const report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8"));
			expect(report.execution.session.status).toBe("finished");
			expect(report.records.filter((record: { result: string }) => record.result === "pass").length).toBeGreaterThan(0);
			await writeFile(path.join(output, "allowed.json"), '{"cases":[]}');
			await run(["mck", "report", "check", "report.json", "allowed.json", "--kit", "kit"]);
		}
	}, 600_000);
});
