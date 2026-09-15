// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Fixture adapter for process.test.ts: answers capabilities correctly, then
// writes to stderr and exits with a non-zero code on the first decode
// request, so the process Testee's ProtocolError names the exit code and
// captured stderr.

import { readLines } from "../../src/lines.ts";
import { IN_PROCESS_CAPABILITIES } from "../../src/testee/in-process.ts";
import { parseEnvelope, parseRequest } from "../../src/testee/protocol.ts";

const capabilities = { ...IN_PROCESS_CAPABILITIES, binding: "fixture" };
const out = (o: unknown): void => {
	process.stdout.write(`${JSON.stringify(o)}\n`);
};

for await (const line of readLines(process.stdin)) {
	if (line.trim() === "") continue;
	const env = parseEnvelope(line);
	const req = parseRequest(env.body);
	if (req.op === "capabilities") {
		out({ id: env.id, ...capabilities });
	} else if (req.op === "exit") {
		process.exit(0);
	} else {
		process.stderr.write("boom");
		process.exit(3);
	}
}
process.exit(0);
