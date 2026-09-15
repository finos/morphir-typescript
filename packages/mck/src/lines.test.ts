// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for readLines: splitting a byte stream into text lines on "\n",
// stripping a trailing "\r", and yielding a final unterminated line at end.
import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { readLines } from "./lines.ts";

async function collect(stream: PassThrough, chunks: readonly string[]): Promise<string[]> {
	const out: string[] = [];
	const iterated = (async () => {
		for await (const line of readLines(stream)) out.push(line);
	})();
	for (const chunk of chunks) stream.write(chunk);
	stream.end();
	await iterated;
	return out;
}

describe("readLines", () => {
	test("splits on \\n, strips a trailing \\r, and yields the final unterminated line", async () => {
		const stream = new PassThrough();
		const lines = await collect(stream, ["a\nb", "c\r\nd"]);
		expect(lines).toEqual(["a", "bc", "d"]);
	});
});
