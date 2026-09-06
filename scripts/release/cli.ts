// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractReleaseNotes } from "./changelog.ts";
import { prepareSuiteRelease, validateSuiteRelease } from "./suite.ts";
import { parseStableVersion } from "./version.ts";

const USAGE = ["Usage:", "  release prepare VERSION [--date=YYYY-MM-DD]", "  release validate TAG", "  release notes VERSION OUTPUT"].join("\n");

export interface ReleaseCliContext {
	readonly root?: string;
	readonly now?: Date;
	readonly stdout?: (line: string) => void;
}

function usageError(message?: string): Error {
	return new Error(message === undefined ? USAGE : `${message}\n${USAGE}`);
}

function prepareArguments(args: readonly string[], today: string): { version: string; date: string } {
	const [version, ...options] = args;
	if (version === undefined) throw usageError();
	let date = today;
	let hasDate = false;
	for (const option of options) {
		if (!option.startsWith("--date=")) throw usageError(`unknown argument: ${option}`);
		if (hasDate) throw usageError("--date may only be specified once");
		date = option.slice("--date=".length);
		hasDate = true;
	}
	return { version, date };
}

export async function runReleaseCli(args: readonly string[], context: ReleaseCliContext = {}): Promise<void> {
	const [command, ...commandArgs] = args;
	const root = context.root ?? process.cwd();
	const stdout = context.stdout ?? console.log;
	if (command === undefined) throw usageError();
	if (command === "prepare") {
		const today = (context.now ?? new Date()).toISOString().slice(0, 10);
		const { version, date } = prepareArguments(commandArgs, today);
		const prepared = await prepareSuiteRelease(root, version, date);
		stdout(`Prepared suite release ${prepared.text}.`);
		return;
	}
	if (command === "validate") {
		if (commandArgs.length !== 1) throw usageError();
		const tag = commandArgs[0] as string;
		await validateSuiteRelease(root, tag);
		stdout(`Validated suite release ${tag}.`);
		return;
	}
	if (command === "notes") {
		if (commandArgs.length !== 2) throw usageError();
		const [versionInput, outputPath] = commandArgs as [string, string];
		const version = parseStableVersion(versionInput);
		const changelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
		await writeFile(path.resolve(root, outputPath), extractReleaseNotes(changelog, version));
		stdout(`Wrote release notes for ${version.text} to ${outputPath}.`);
		return;
	}
	throw usageError(`unknown release command: ${command}`);
}

if (import.meta.main) await runReleaseCli(process.argv.slice(2));
