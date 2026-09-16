// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { jsonLineClient, type ProcessOptions } from "../testee/transport.ts";
import type { PackageTestee } from "./contract.ts";
import { parsePackageCapabilities, parsePackageResponse } from "./protocol.ts";

export function processPackageTestee(command: readonly string[], options: ProcessOptions): PackageTestee {
	let exitCode: number | null | undefined;
	const client = jsonLineClient(command, {
		...options,
		onExit: (code) => {
			exitCode = code;
			options.onExit?.(code);
		},
	});
	return {
		capabilities: async () => parsePackageCapabilities(await client.exchange({ op: "capabilities" })),
		execute: async (request) => parsePackageResponse(await client.exchange(request), request.op),
		close: async () => {
			await client.close();
			if (exitCode !== 0)
				throw new Error(
					`package adapter shutdown failed: ${exitCode === undefined ? "did not exit within shutdown grace period" : `exit ${exitCode ?? "signal"}`}`,
				);
		},
	};
}
