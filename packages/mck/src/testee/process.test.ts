// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the process Testee: every way a foreign process can misbehave
// (non-JSON output, a mismatched id, a non-zero exit, a hang, dying right
// after answering) becomes a ProtocolError naming the problem; a dead
// child's stdin never raises an uncaught error; and the real adapter agrees
// with the in-process Testee it wraps.
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { IN_PROCESS_CAPABILITIES, inProcessTestee } from "./in-process.ts";
import { processTestee } from "./process.ts";
import { ProtocolError } from "./protocol.ts";

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
		expect(error).toBeInstanceOf(ProtocolError);
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

	test("an adapter that answers and then exits promptly is not mistaken for one that failed to answer", async () => {
		const t = processTestee(["bun", fixture("adapter-answer-then-exit.ts")], { timeoutMs: 5000 });
		await t.capabilities();
		const response = await t.decode(decodeRequest);
		const expected = await inProcessTestee().decode(decodeRequest);
		expect(response).toEqual(expected);
		// The adapter has already exited after answering; the next request must
		// report that exit, not hang or repeat the previous answer.
		expect(await rejection(t.decode(decodeRequest))).toMatch(/adapter exited with code 0/);
		await t.close();
	});

	test("a dead child's stdin does not raise an uncaught error when the Testee is closed", async () => {
		let uncaught: unknown;
		const onUncaught = (err: unknown) => {
			uncaught = err;
		};
		process.once("uncaughtException", onUncaught);
		process.once("unhandledRejection", onUncaught);
		try {
			const t = processTestee(["bun", fixture("adapter-exit.ts")], { timeoutMs: 5000 });
			await t.capabilities();
			await rejection(t.decode(decodeRequest));
			// The child has already exited (code 3) by the time close() runs, so
			// its stdin pipe is dead; close() must still resolve cleanly.
			await t.close();
			// Give any late "error" event a turn before asserting none fired.
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(uncaught).toBeUndefined();
		} finally {
			process.removeListener("uncaughtException", onUncaught);
			process.removeListener("unhandledRejection", onUncaught);
		}
	});

	test("the real adapter matches the in-process testee's capabilities and decode answer, closes cleanly, and exits 0", async () => {
		let exitCode: number | null | undefined;
		const t = processTestee(["bun", adapter], {
			timeoutMs: 5000,
			onExit: (code) => {
				exitCode = code;
			},
		});
		const caps = await t.capabilities();
		expect(caps).toEqual(IN_PROCESS_CAPABILITIES);
		const viaAdapter = await t.decode(decodeRequest);
		const inProcess = await inProcessTestee().decode(decodeRequest);
		expect(viaAdapter).toEqual(inProcess);
		await t.close();
		expect(exitCode).toBe(0);
	}, 5000);
});
