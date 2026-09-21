// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
// Consumer orchestration only. The native CLI owns kit and report validation.
import { constants } from "node:fs";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { installCli, parseReleasePin, releaseTarget } from "./released-cli.ts";

export interface NativeContext {
	readonly root: string;
	readonly cli: string;
	readonly kit: string;
	readonly execute?: (args: readonly string[]) => Promise<number>;
}

export async function nativeCli(root: string, env: Readonly<Record<string, string | undefined>> = process.env): Promise<string> {
	const override = env.MORPHIR_MCK_NATIVE_CLI;
	if (override !== undefined) {
		if (!path.isAbsolute(override)) throw new Error("MORPHIR_MCK_NATIVE_CLI must be an absolute executable path");
		if (!(await stat(override)).isFile()) throw new Error("MORPHIR_MCK_NATIVE_CLI must name a file");
		await access(override, constants.X_OK);
		return override;
	}
	const file = path.join(root, ".config/mck-cli.json");
	const pin = parseReleasePin(JSON.parse(await readFile(file, "utf8")));
	const target = releaseTarget();
	return installCli({ root, version: pin.version, target, sha256: pin.sha256[target.triple] as string });
}

export async function nativeContext(root: string): Promise<NativeContext> {
	return { root, cli: await nativeCli(root), kit: path.resolve(root, process.env.MORPHIR_MCK_KIT ?? "vendor/morphir-mck") };
}

function execute(context: NativeContext): (args: readonly string[]) => Promise<number> {
	return (
		context.execute ??
		(async (args) => {
			const child = Bun.spawn([...args], {
				cwd: context.root,
				env: { ...process.env, MORPHIR_LOG_FILE: "false" },
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			});
			const status = await child.exited;
			if (child.signalCode !== null) throw new Error(`native command terminated by signal ${child.signalCode}`);
			return status;
		})
	);
}

export async function checkNativeKit(context: NativeContext): Promise<void> {
	// Never let a historical kit.lock.json or raw directory bypass native
	// managed-snapshot verification. The CLI verifies the manifest's contents.
	await access(path.join(context.kit, "mck-kit.lock.json"));
	for (const args of [
		["mck", "kit", "status", "--kit", context.kit, "--json"],
		["mck", "check", context.kit],
		["mck", "coverage", "--kit", context.kit],
		["mck", "schema", "check", "--kit", context.kit],
	]) {
		const status = await execute(context)([context.cli, ...args]);
		if (status !== 0) throw new Error(`native ${args.slice(0, 3).join(" ")} failed with exit ${status}`);
	}
}

export async function runNativeConformance(context: NativeContext): Promise<void> {
	const directory = path.join(context.root, ".dev/out/conformance");
	await mkdir(directory, { recursive: true });
	const report = path.join(directory, "native.json");
	const html = path.join(directory, "native.html");
	await Promise.all([rm(report, { force: true }), rm(html, { force: true })]);
	await checkNativeKit(context);
	const run = execute(context);
	const status = await run([
		context.cli,
		"mck",
		"run",
		"--adapter",
		process.execPath,
		"--adapter-arg",
		path.join(context.root, "packages/mck/src/adapter.ts"),
		"--kit",
		context.kit,
		"--report",
		report,
	]);
	if (!(await stat(report).catch(() => undefined))?.isFile()) throw new Error(`native run exited ${status} without a fresh report at ${report}`);
	// The report gate, including session integrity, owns allowed-failure
	// adjudication. Rendering runs separately and cannot hide a gate failure.
	const checked = await run([context.cli, "mck", "report", "check", report, path.join(context.root, ".config/mck-allowed-failing.json"), "--kit", context.kit]);
	const rendered = await run([context.cli, "mck", "report", "render", report, "--format", "html", "--output", html]);
	if ((status !== 0 && status !== 1) || checked !== 0 || rendered !== 0)
		throw new Error(`native conformance failed: run=${status}, report check=${checked}, render=${rendered}`);
}
