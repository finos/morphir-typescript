// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Compiles the `mck` driver and its reference adapter to single-file
// executables, one pair per release target. `bun build --compile` bundles
// `kit/embedded.ts`, `packages/mck/package.json`, and the relative IR sources
// into the executable, so a released binary carries the vendored kit and needs
// no checkout, no `node_modules`, and no Node installation. Cross-compilation
// needs no source rewriting for the same reason: nothing is resolved at run
// time.

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { runCommand } from "./package-common.ts";
import { parseStableVersion } from "./version.ts";

/** A release target: the `bun build --target` name, and the OS and architecture the filename reports. */
export type BinaryTarget = readonly [target: string, os: string, arch: string];

/**
 * Every target a release compiles, in the order it compiles them. All five
 * cross-compile from any host. A target that stops cross-compiling is dropped
 * from the matrix rather than built natively: it is removed from this list
 * with a comment and a bead, never patched around.
 * Bun publishes no `bun-windows-arm64` build, so Windows on ARM is served by
 * the x64 binary under emulation.
 */
export const TARGETS: readonly BinaryTarget[] = [
	["bun-linux-x64", "linux", "x64"],
	["bun-linux-arm64", "linux", "arm64"],
	["bun-darwin-x64", "darwin", "x64"],
	["bun-darwin-arm64", "darwin", "arm64"],
	["bun-windows-x64", "windows", "x64"],
];

interface Entrypoint {
	readonly source: string;
	readonly stem: string;
}

/** The two executables the package declares in `bin`, in `bin` order. */
const ENTRYPOINTS: readonly Entrypoint[] = [
	{ source: "packages/mck/src/cli.ts", stem: "mck" },
	{ source: "packages/mck/src/adapter.ts", stem: "mck-adapter-typescript" },
];

/** The environment variable that narrows the matrix: `host`, or a comma-separated list of target names. */
export const TARGET_SELECTION_VARIABLE = "MCK_BINARY_TARGETS";

function binaryName(stem: string, version: string, os: string, arch: string): string {
	return `${stem}-${version}-${os}-${arch}${os === "windows" ? ".exe" : ""}`;
}

/**
 * Every binary a full release produces, in build order. The release workflow's
 * expected file set is pinned to this list, so the workflow and the build
 * cannot drift apart. `version` is substituted verbatim, which lets the
 * automation test pass the workflow's own `${version}` shell expansion.
 */
export function binaryNames(version: string): readonly string[] {
	return TARGETS.flatMap(([, os, arch]) => ENTRYPOINTS.map((entrypoint) => binaryName(entrypoint.stem, version, os, arch)));
}

/** The target whose binary runs on this machine, or `null` when no release target does. */
export function hostTarget(): string | null {
	const host = `${process.platform}-${process.arch}`;
	if (host === "linux-x64") return "bun-linux-x64";
	if (host === "linux-arm64") return "bun-linux-arm64";
	if (host === "darwin-x64") return "bun-darwin-x64";
	if (host === "darwin-arm64") return "bun-darwin-arm64";
	// Windows on ARM runs x64 executables under emulation, so the x64 target is
	// the host target there too.
	if (host === "win32-x64" || host === "win32-arm64") return "bun-windows-x64";
	return null;
}

export function selectedTargets(selection: string | undefined): readonly BinaryTarget[] {
	if (selection === undefined || selection.trim() === "") return TARGETS;
	if (selection.trim() === "host") {
		const host = hostTarget();
		const target = TARGETS.find(([name]) => name === host);
		if (target === undefined) throw new Error(`no release target runs on ${process.platform}-${process.arch}`);
		return [target];
	}
	return selection
		.split(",")
		.map((name) => name.trim())
		.filter((name) => name !== "")
		.map((name) => {
			const target = TARGETS.find(([candidate]) => candidate === name);
			if (target === undefined) throw new Error(`unknown binary target: ${name}`);
			return target;
		});
}

async function mckVersion(root: string): Promise<string> {
	const manifest = JSON.parse(await readFile(path.join(root, "packages/mck/package.json"), "utf8")) as { version?: unknown };
	return parseStableVersion(String(manifest.version)).text;
}

/**
 * Compiles every selected target into `outputDirectory` and reports the
 * absolute path of each executable in build order.
 */
export async function buildBinaries(root: string, outputDirectory: string): Promise<readonly string[]> {
	const version = await mckVersion(root);
	const directory = path.resolve(root, outputDirectory);
	await mkdir(directory, { recursive: true });
	const built: string[] = [];
	for (const [target, os, arch] of selectedTargets(process.env[TARGET_SELECTION_VARIABLE])) {
		for (const entrypoint of ENTRYPOINTS) {
			const output = path.join(directory, binaryName(entrypoint.stem, version, os, arch));
			await runCommand([process.execPath, "build", "--compile", `--target=${target}`, entrypoint.source, "--outfile", output], root);
			built.push(output);
		}
	}
	return built;
}
