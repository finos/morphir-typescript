// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import path from "node:path";

for (const entry of ["cli.ts", "index.ts", "adapter.ts"]) {
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

for (const args of [["run"], ["check", "."], ["coverage"], ["kit", "status"], ["run", "--help"]]) {
	test(`retired mck ${args.join(" ")} directs consumers to native CLI`, () => {
		const result = Bun.spawnSync([process.execPath, path.join(import.meta.dir, "cli.ts"), ...args]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr.toString()).toContain("morphir mck");
		expect(result.stderr.toString()).toContain("--adapter");
	});
}
