// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { generateSignedFixture } from "./package-signed-fixture.ts";
import { checkFixtureFiles, readFixtureInputs, writeFixtureFiles } from "./package-signed-fixture-io.ts";

export function parseFixtureArguments(args: readonly string[]): { source: string; mode: "output" | "check"; destination: string } {
	const options = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index];
		const value = args[index + 1];
		if (!key || !["--source", "--output", "--check"].includes(key) || options.has(key) || !value || value.startsWith("--"))
			throw new Error("Expected --source <parent-root> and exactly one --output <empty-directory> or --check <directory>");
		options.set(key, value);
	}
	const source = options.get("--source");
	const mode = options.has("--output") ? "output" : "check";
	const destination = options.get(`--${mode}`);
	if (!source || !destination || options.size !== 2) throw new Error("Expected --source and exactly one --output or --check");
	return { source, mode, destination };
}

if (import.meta.main) {
	const { source, mode, destination } = parseFixtureArguments(process.argv.slice(2));
	const files = generateSignedFixture(await readFixtureInputs(source));
	if (mode === "output") await writeFixtureFiles(destination, files, source);
	else await checkFixtureFiles(destination, files);
	console.log(`Signed fixture ${mode}: ${files.size} exact files`);
}
