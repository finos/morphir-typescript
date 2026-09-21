// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkNativeKit, type NativeContext, nativeCli, runNativeConformance } from "./native.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), "native-consumer-"));
	roots.push(root);
	const kit = path.join(root, "vendor/morphir-mck");
	mkdirSync(kit, { recursive: true });
	writeFileSync(path.join(kit, "mck-kit.lock.json"), "{}");
	const calls: string[][] = [];
	const report = path.join(root, ".dev/out/conformance/native.json");
	const context: NativeContext = {
		root,
		cli: "/native/morphir",
		kit,
		execute: async (args) => {
			calls.push([...args]);
			return 0;
		},
	};
	return { root, kit, calls, report, context };
}

test("no production pin or local override never falls back to the old driver", async () => {
	const { root } = fixture();
	await expect(nativeCli(root, {})).rejects.toThrow("mck-cli.json");
	await expect(nativeCli(root, { MORPHIR_MCK_NATIVE_CLI: "relative" })).rejects.toThrow("absolute");
	await expect(nativeCli(root, { MORPHIR_MCK_NATIVE_CLI: path.join(root, "missing") })).rejects.toThrow();
});

test("kit verification requires a generated native manifest and invokes native authoring gates", async () => {
	const { context, calls, kit } = fixture();
	await checkNativeKit(context);
	expect(calls.map((args) => args.slice(1, 3))).toEqual([
		["mck", "kit"],
		["mck", "check"],
		["mck", "coverage"],
		["mck", "schema"],
	]);
	expect(calls.every((args) => args.includes(kit))).toBe(true);
	rmSync(path.join(kit, "mck-kit.lock.json"));
	writeFileSync(path.join(kit, "kit.lock.json"), "{}");
	await expect(checkNativeKit(context)).rejects.toThrow("mck-kit.lock.json");
});

test("a failed run is adjudicated but successful HTML cannot mask a failed gate", async () => {
	const { context, calls, report } = fixture();
	mkdirSync(path.dirname(report), { recursive: true });
	writeFileSync(report, "stale");
	await expect(
		runNativeConformance({
			...context,
			execute: async (args) => {
				calls.push([...args]);
				if (args[2] === "run") {
					expect(existsSync(report)).toBe(false);
					writeFileSync(report, "fresh evidence");
					return 1;
				}
				if (args[2] === "report" && args[3] === "check") return 1;
				return 0;
			},
		}),
	).rejects.toThrow();
	expect(calls.filter((args) => args[2] === "report").map((args) => args[3])).toEqual(["check", "render"]);
	expect(readFileSync(report, "utf8")).toBe("fresh evidence");
});

test("missing fresh report cannot be replaced by a previous successful report", async () => {
	const { context, calls, report } = fixture();
	mkdirSync(path.dirname(report), { recursive: true });
	writeFileSync(report, "stale");
	await expect(runNativeConformance(context)).rejects.toThrow("report");
	expect(existsSync(report)).toBe(false);
	expect(calls.some((args) => args[2] === "report")).toBe(false);
});

test("schema gate failure stops before adapter execution and removes stale evidence", async () => {
	const { context, report, calls } = fixture();
	mkdirSync(path.dirname(report), { recursive: true });
	writeFileSync(report, "stale");
	await expect(
		runNativeConformance({
			...context,
			execute: async (args) => {
				calls.push([...args]);
				return args[2] === "schema" ? 1 : 0;
			},
		}),
	).rejects.toThrow();
	expect(existsSync(report)).toBe(false);
	expect(calls.some((args) => args[2] === "run")).toBe(false);
});

test("the native report checker owns allowed-failure adjudication", async () => {
	const { context, report } = fixture();
	await runNativeConformance({
		...context,
		execute: async (args) => {
			if (args[2] === "run") {
				writeFileSync(report, "fresh");
				return 1;
			}
			return 0;
		},
	});
});

test("abnormal exit cannot pass even when a fresh report would be accepted", async () => {
	const { context, report } = fixture();
	await expect(
		runNativeConformance({
			...context,
			execute: async (args) => {
				if (args[2] === "run") {
					writeFileSync(report, "fresh");
					return -1;
				}
				return 0;
			},
		}),
	).rejects.toThrow("run=-1");
});

test("the concrete CLI process cannot hide a signal behind a fresh report", async () => {
	const { context, root, report } = fixture();
	writeFileSync(
		path.join(root, "mck"),
		`
import { writeFileSync } from "node:fs";
if (process.argv[2] === "run") {
  writeFileSync(process.argv[process.argv.indexOf("--report") + 1], "fresh report");
  process.kill(process.pid, "SIGTERM");
}
`,
	);
	await expect(runNativeConformance({ ...context, cli: process.execPath, execute: undefined })).rejects.toThrow("signal");
	expect(readFileSync(report, "utf8")).toBe("fresh report");
}, 30_000);

test.skipIf(process.env.MORPHIR_MCK_NATIVE_CLI === undefined)("native CLI runs and certifies a freshly vendored kit with the TypeScript adapter", async () => {
	const { root, kit } = fixture();
	const repository = path.resolve(import.meta.dir, "../..");
	const cli = await nativeCli(root);
	rmSync(kit, { recursive: true });
	mkdirSync(path.join(root, "packages/mck/src"), { recursive: true });
	// A fixture wrapper keeps report paths temporary while exercising the real
	// binding and its installed dependencies from this checkout.
	writeFileSync(path.join(root, "packages/mck/src/adapter.ts"), `import ${JSON.stringify(path.join(repository, "packages/mck/src/adapter.ts"))};\n`);
	mkdirSync(path.join(root, ".config"));
	writeFileSync(path.join(root, ".config/mck-allowed-failing.json"), '{"cases":[]}');
	const execute = async (args: readonly string[]) => {
		const child = Bun.spawn([...args], { cwd: root, env: { ...process.env, MORPHIR_LOG_FILE: "false" }, stdout: "pipe", stderr: "pipe" });
		const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		expect(status, `${stdout}\n${stderr}`).toBe(0);
		return status;
	};
	await execute([cli, "mck", "kit", "vendor", "--source", "embedded", "--dest", kit]);
	await runNativeConformance({ root, kit, cli, execute });
	expect(existsSync(path.join(root, ".dev/out/conformance/native.html"))).toBe(true);
	writeFileSync(path.join(kit, "spec/mck/vocabulary.json"), "{}");
	await expect(
		checkNativeKit({
			root,
			kit,
			cli,
			execute: async (args) => {
				const child = Bun.spawn([...args], { cwd: root, stdout: "ignore", stderr: "ignore" });
				return child.exited;
			},
		}),
	).rejects.toThrow();
});
