// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Fixture adapter for process.test.ts: answers capabilities and the first
// decode request correctly, then exits 0 immediately after writing the
// decode response — before ever reading a next request — so the process
// Testee must not mistake a conforming adapter's prompt exit for a failure
// of the request it just answered.
import { readLines } from "../../src/lines.ts";
import { IN_PROCESS_CAPABILITIES, inProcessTestee } from "../../src/testee/in-process.ts";
import { parseEnvelope, parseRequest } from "../../src/testee/protocol.ts";

const capabilities = { ...IN_PROCESS_CAPABILITIES, binding: "fixture" };
const testee = inProcessTestee();
const out = (o: unknown): void => {
	process.stdout.write(`${JSON.stringify(o)}\n`);
};

for await (const line of readLines(process.stdin)) {
	if (line.trim() === "") continue;
	const env = parseEnvelope(line);
	const req = parseRequest(env.body);
	if (req.op === "capabilities") {
		out({ id: env.id, ...capabilities });
	} else if (req.op === "decode") {
		out({ id: env.id, ...(await testee.decode(req)) });
		process.exit(0);
	} else if (req.op === "exit") {
		process.exit(0);
	}
}
process.exit(0);
