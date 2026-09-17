// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { readLines } from "../lines.ts";
import { parseEnvelope } from "../testee/protocol.ts";
import type { PackageContractTestee, PackageContractVersion } from "./contract.ts";
import { PACKAGE_CONTRACT } from "./contract.ts";
import { parsePackageRequest } from "./protocol.ts";
import { referencePackageTestee, referenceResolutionTestee } from "./reference.ts";
import { RESOLUTION_CONTRACT } from "./resolution/contract.ts";
import { parseResolutionRequest } from "./resolution/protocol.ts";

async function runContractAdapter<Operation extends string, Request extends { readonly op: Operation }, Response, Capabilities>(
	parseRequest: (value: unknown) => Request | { readonly op: "capabilities" } | { readonly op: "exit" },
	testee: PackageContractTestee<Capabilities, Request, Response>,
): Promise<void> {
	try {
		for await (const line of readLines(process.stdin)) {
			if (line.trim() === "") continue;
			// Protocol or infrastructure errors terminate the adapter. They must never
			// be confused with a successful response rejecting the document under test.
			const { id, body } = parseEnvelope(line);
			const request = parseRequest(body);
			if (request.op === "exit") return;
			const response = request.op === "capabilities" ? await testee.capabilities() : await testee.execute(request as Request);
			process.stdout.write(`${JSON.stringify({ id, ...response })}\n`);
		}
	} finally {
		await testee.close();
	}
}

export async function runPackageAdapter(contract: PackageContractVersion = PACKAGE_CONTRACT): Promise<void> {
	if (contract === RESOLUTION_CONTRACT) return runContractAdapter(parseResolutionRequest, referenceResolutionTestee());
	return runContractAdapter(parsePackageRequest, referencePackageTestee());
}
