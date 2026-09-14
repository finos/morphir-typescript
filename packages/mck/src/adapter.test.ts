// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// End-to-end test of the mck-adapter-typescript executable: pipes a
// capabilities request, a decode, a malformed line, and exit through a
// spawned process and checks the three JSON-line responses and the exit code.
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import path from "node:path";
import { readLines } from "./lines.ts";
import { IN_PROCESS_CAPABILITIES } from "./testee/in-process.ts";

const adapter = path.join(import.meta.dir, "adapter.ts");

describe("mck-adapter-typescript", () => {
	test("answers capabilities and decode, reports a malformed line, and exits 0 on exit", async () => {
		const child = spawn("bun", [adapter], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		const responses: unknown[] = [];
		const collecting = (async () => {
			for await (const line of readLines(child.stdout)) {
				responses.push(JSON.parse(line));
				if (responses.length === 3) break;
			}
		})();
		child.stdin.write(`${JSON.stringify({ id: 1, op: "capabilities" })}\n`);
		child.stdin.write(
			`${JSON.stringify({
				id: 2,
				op: "decode",
				version: 4,
				profile: "json",
				path: "current",
				strip: true,
				node: "Type",
				input: '{ "Reference": { "fqname": "morphir/SDK:list#list", "args": ["a"] } }',
			})}\n`,
		);
		child.stdin.write("not json\n");
		await collecting;
		const exitCode = new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? -1)));
		child.stdin.write(`${JSON.stringify({ id: 4, op: "exit" })}\n`);
		child.stdin.end();

		expect(responses[0]).toEqual({ id: 1, ...IN_PROCESS_CAPABILITIES });
		expect(responses[1]).toEqual({
			id: 2,
			ok: true,
			kind: "Reference",
			canonical: { json: '{ "Reference": ["morphir/SDK:list#list", "a"] }' },
			warnings: [],
		});
		expect(responses[2]).toMatchObject({ id: null, ok: false, diagnostic: { code: "protocol_error" } });
		expect(await exitCode).toBe(0);
	}, 5000);
});
