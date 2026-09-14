// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the process Testee: every way a foreign process can misbehave
// (non-JSON output, a mismatched id, a non-zero exit, a hang) becomes a
// ProtocolError naming the problem, and the real adapter agrees with the
// in-process Testee it wraps.
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { IN_PROCESS_CAPABILITIES, inProcessTestee } from "./in-process.ts";
import { processTestee } from "./process.ts";

const fixture = (name: string): string => path.join(import.meta.dir, "..", "..", "test", "fixtures", name);
const adapter = path.join(import.meta.dir, "..", "adapter.ts");

const decodeRequest = {
	op: "decode" as const,
	version: 4,
	profile: "json" as const,
	path: "current" as const,
	strip: true,
	node: "Type",
	input: '{ "Reference": { "fqname": "morphir/SDK:list#list", "args": ["a"] } }',
};

// bun:test's `expect(promise).rejects` matcher can deadlock when the
// rejection races a child process's own exit/timeout handling (observed with
// these fixtures on this platform), so rejections are awaited directly
// instead of through that matcher.
async function rejection(p: Promise<unknown>): Promise<string> {
	try {
		await p;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	throw new Error("expected the promise to reject");
}

describe("processTestee", () => {
	test("non-JSON output rejects with a ProtocolError naming the parse failure", async () => {
		const t = processTestee(["bun", fixture("adapter-nonjson.ts")], { timeoutMs: 5000 });
		await t.capabilities();
		expect(await rejection(t.decode(decodeRequest))).toMatch(/not a JSON line/);
		await t.close();
	});

	test("a mismatched id rejects with a ProtocolError naming the expected and actual ids", async () => {
		const t = processTestee(["bun", fixture("adapter-wrong-id.ts")], { timeoutMs: 5000 });
		await t.capabilities();
		expect(await rejection(t.decode(decodeRequest))).toMatch(/expected id 2, got 999/);
		await t.close();
	});

	test("a non-zero exit rejects with a ProtocolError naming the code and captured stderr", async () => {
		const t = processTestee(["bun", fixture("adapter-exit.ts")], { timeoutMs: 5000 });
		await t.capabilities();
		expect(await rejection(t.decode(decodeRequest))).toMatch(/adapter exited with code 3[\s\S]*boom/);
		await t.close();
	});

	test("a hung adapter times out", async () => {
		const t = processTestee(["bun", fixture("adapter-hang.ts")], { timeoutMs: 200 });
		await t.capabilities();
		expect(await rejection(t.decode(decodeRequest))).toMatch(/timed out after 200 ms/);
		await t.close();
	});

	test("the real adapter matches the in-process testee's capabilities and decode answer, and closes cleanly", async () => {
		const t = processTestee(["bun", adapter], { timeoutMs: 5000 });
		const caps = await t.capabilities();
		expect(caps).toEqual(IN_PROCESS_CAPABILITIES);
		const viaAdapter = await t.decode(decodeRequest);
		const inProcess = await inProcessTestee().decode(decodeRequest);
		expect(viaAdapter).toEqual(inProcess);
		await t.close();
	}, 5000);
});
