// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { jsonLineClient } from "./transport.ts";

test("the JSON-line client exchanges arbitrary operation bodies and closes with the next id", async () => {
	const script = `
		const { createInterface } = require("node:readline");
		let nextId = 1;
		createInterface({ input: process.stdin }).on("line", (line) => {
			const { id, ...body } = JSON.parse(line);
			if (id !== nextId++) process.exit(2);
			if (body.op === "exit") process.exit(id === 3 ? 0 : 3);
			process.stdout.write(JSON.stringify({ id, echoed: body }) + "\\n");
		});
	`;
	let exitCode: number | null | undefined;
	const client = jsonLineClient(["bun", "-e", script], {
		timeoutMs: 5000,
		onExit: (code) => {
			exitCode = code;
		},
	});
	try {
		const request = { op: "packageDigest", files: [{ path: "package.json", content: "{}" }] };
		expect(await client.exchange(request)).toEqual({ echoed: request });
		expect(await client.exchange({ op: "customOperation", value: [1, null, true] })).toEqual({
			echoed: { op: "customOperation", value: [1, null, true] },
		});
	} finally {
		await client.close();
	}
	expect(exitCode).toBe(0);
});
