#!/usr/bin/env node
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// mck-adapter-typescript: the TypeScript binding behind the adapter protocol
// (protocol.schema.json, contract version 1; kit README, "Running the driver
// against a binding"). A transport over the in-process Testee and nothing
// more — in-process and child-process are the only two transports the
// protocol defines — and it is the reference every other adapter is checked
// against.
import { readLines } from "./lines.ts";
import { runPackageAdapter } from "./package/adapter.ts";
import { inProcessTestee } from "./testee/in-process.ts";
import { ProtocolError, parseEnvelope, parseRequest } from "./testee/protocol.ts";

if (process.argv[2] === "--suite" && process.argv[3] === "package") {
	await runPackageAdapter();
	process.exit(0);
}

const testee = inProcessTestee();
const out = (o: unknown): void => {
	process.stdout.write(`${JSON.stringify(o)}\n`);
};

for await (const line of readLines(process.stdin)) {
	if (line.trim() === "") continue;
	let id: number | null = null;
	try {
		const env = parseEnvelope(line);
		id = env.id;
		const req = parseRequest(env.body);
		switch (req.op) {
			case "capabilities":
				out({ id, ...(await testee.capabilities()) });
				break;
			case "decode":
				out({ id, ...(await testee.decode(req)) });
				break;
			case "readTree":
				out({ id, ...(await testee.readTree(req)) });
				break;
			case "writeTree":
				out({ id, ...(await testee.writeTree(req)) });
				break;
			case "exit":
				process.exit(0);
		}
	} catch (error) {
		const message = error instanceof ProtocolError ? error.message : String(error);
		out({ id, ok: false, diagnostic: { code: "protocol_error", stage: "syntax", cursor: "/", message } });
	}
}
process.exit(0);
