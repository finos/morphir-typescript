// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Fixture adapter for process.test.ts: answers capabilities correctly, then
// answers the first decode request with a line that is not JSON at all, so
// the process Testee's ProtocolError names the parse failure.

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
		process.stdout.write("not json\n");
	}
}
process.exit(0);
