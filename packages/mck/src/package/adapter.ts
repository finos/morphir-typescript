// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { readLines } from "../lines.ts";
import { parseEnvelope } from "../testee/protocol.ts";
import { parsePackageRequest } from "./protocol.ts";
import { referencePackageTestee } from "./reference.ts";

export async function runPackageAdapter(): Promise<void> {
	const testee = referencePackageTestee();
	try {
		for await (const line of readLines(process.stdin)) {
			if (line.trim() === "") continue;
			// Protocol or infrastructure errors terminate the adapter. They must never
			// be confused with a successful response rejecting the document under test.
			const { id, body } = parseEnvelope(line);
			const request = parsePackageRequest(body);
			if (request.op === "exit") return;
			const response = request.op === "capabilities" ? await testee.capabilities() : await testee.execute(request);
			process.stdout.write(`${JSON.stringify({ id, ...response })}\n`);
		}
	} finally {
		await testee.close();
	}
}
