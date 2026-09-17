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
import { PACKAGE_CONTRACT, type PackageContractVersion } from "./package/contract.ts";
import { RESOLUTION_CONTRACT } from "./package/resolution/contract.ts";
import { inProcessTestee } from "./testee/in-process.ts";
import { ProtocolError, parseEnvelope, parseRequest } from "./testee/protocol.ts";

type AdapterSelection = { readonly suite: "ir" } | { readonly suite: "package"; readonly contract: PackageContractVersion };

function parseSelection(args: readonly string[]): AdapterSelection {
	if (args.length === 0 || (args.length === 2 && args[0] === "--suite" && args[1] === "ir")) return { suite: "ir" };
	if (args.length === 2 && args[0] === "--suite" && args[1] === "package") return { suite: "package", contract: PACKAGE_CONTRACT };
	if (
		args.length === 4 &&
		args[0] === "--suite" &&
		args[1] === "package" &&
		args[2] === "--contract" &&
		(args[3] === PACKAGE_CONTRACT || args[3] === RESOLUTION_CONTRACT)
	)
		return { suite: "package", contract: args[3] };
	throw new Error(`usage: mck-adapter-typescript [--suite ir | --suite package [--contract ${PACKAGE_CONTRACT} | ${RESOLUTION_CONTRACT}]]`);
}

const selection = parseSelection(process.argv.slice(2));
if (selection.suite === "package") {
	await runPackageAdapter(selection.contract);
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
