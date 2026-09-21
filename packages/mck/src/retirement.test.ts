// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

for (const entry of ["index.ts", "adapter.ts"]) {
	test(`${entry} builds without retired IR tooling`, async () => {
		const build = await Bun.build({
			entrypoints: [path.join(import.meta.dir, entry)],
			target: "node",
			plugins: [
				{
					name: "retired-ir-boundary",
					setup(builder) {
						builder.onLoad({ filter: /[/\\]mck[/\\](?:kit[/\\]|src[/\\](?:(?:driver|kit|coverage)[/\\]|testee[/\\]process\.ts$))/ }, (args) => {
							if (args.path.endsWith(`${path.sep}kit${path.sep}hash.ts`)) return undefined;
							throw new Error(`imports retired IR tooling: ${args.path}`);
						});
					},
				},
			],
		});
		expect(build.logs).toEqual([]);
		expect(build.success).toBe(true);
	});
}

test("removes the TypeScript package runner and process client", () => {
	for (const file of [
		"cli.ts",
		"package/cli.ts",
		"package/run.ts",
		"package/process.ts",
		"package/corpus.ts",
		"package/resolution/corpus.ts",
		"report.ts",
		"testee/transport.ts",
	]) {
		expect(existsSync(path.join(import.meta.dir, file)), file).toBe(false);
	}
});

test("publishes only the adapter executable and no Effect CLI dependencies", () => {
	const manifest = JSON.parse(readFileSync(path.join(import.meta.dir, "../package.json"), "utf8"));
	expect(manifest.bin).toEqual({ "mck-adapter-typescript": "./dist/adapter.js" });
	for (const dependency of Object.keys(manifest.devDependencies ?? {})) expect(dependency.startsWith("@effect/") || dependency === "effect").toBe(false);
});

test("does not export runner APIs from the library entry point", async () => {
	const library = await import("./index.ts");
	for (const name of [
		"loadPackageKit",
		"loadResolutionKit",
		"packageExitCode",
		"processPackageTestee",
		"processResolutionTestee",
		"runPackageKit",
		"runResolutionKit",
	]) {
		expect(name in library, name).toBe(false);
	}
});
