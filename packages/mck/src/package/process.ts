// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { jsonLineClient, type ProcessOptions } from "../testee/transport.ts";
import type { PackageContractDescriptor, PackageContractTestee, PackageContractVersion, PackageTestee } from "./contract.ts";
import { packageContract } from "./protocol.ts";
import type { ResolutionCapabilities, ResolutionOperation, ResolutionRequest, ResolutionResponse, ResolutionTestee } from "./resolution/contract.ts";
import { resolutionContract } from "./resolution/protocol.ts";

export function processPackageTestee(command: readonly string[], options: ProcessOptions): PackageTestee {
	return processContractTestee(command, options, packageContract);
}

function processContractTestee<
	Version extends PackageContractVersion,
	Operation extends string,
	Request extends { readonly op: Operation },
	Response,
	Capabilities extends { readonly suite: "package"; readonly contractVersion: Version; readonly operations: readonly Operation[] },
	Projection,
>(
	command: readonly string[],
	options: ProcessOptions,
	descriptor: PackageContractDescriptor<Version, Operation, Request, Response, Capabilities, Projection>,
): PackageContractTestee<Capabilities, Request, Response> {
	let exitCode: number | null | undefined;
	const client = jsonLineClient(command, {
		...options,
		onExit: (code) => {
			exitCode = code;
			options.onExit?.(code);
		},
	});
	return {
		capabilities: async () => descriptor.parseCapabilities(await client.exchange({ op: "capabilities" })),
		execute: async (request) => descriptor.parseResponse(await client.exchange(request), descriptor.operation(request)),
		close: async () => {
			await client.close();
			if (exitCode !== 0)
				throw new Error(
					`package adapter shutdown failed: ${exitCode === undefined ? "did not exit within shutdown grace period" : `exit ${exitCode ?? "signal"}`}`,
				);
		},
	};
}

export function processResolutionTestee(command: readonly string[], options: ProcessOptions): ResolutionTestee {
	return processContractTestee<"0.1.0-draft.2", ResolutionOperation, ResolutionRequest, ResolutionResponse, ResolutionCapabilities, ResolutionResponse>(
		command,
		options,
		resolutionContract,
	);
}
