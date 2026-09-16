// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The IR compatibility protocol over the shared JSON-lines transport.
import { parseCapabilities, parseDecodeResponse, parseWriteTreeResponse } from "./protocol.ts";
import type { DecodeRequest, DecodeResponse, ReadTreeRequest, Testee, WriteTreeRequest, WriteTreeResponse } from "./testee.ts";
import { jsonLineClient, type ProcessOptions } from "./transport.ts";

export type { ProcessOptions } from "./transport.ts";

export function processTestee(command: readonly string[], options: ProcessOptions): Testee {
	const client = jsonLineClient(command, options);
	return {
		capabilities: async () => parseCapabilities(await client.exchange({ op: "capabilities" })),
		decode: async (req: DecodeRequest): Promise<DecodeResponse> => parseDecodeResponse(await client.exchange(req)),
		readTree: async (req: ReadTreeRequest): Promise<DecodeResponse> => parseDecodeResponse(await client.exchange(req)),
		writeTree: async (req: WriteTreeRequest): Promise<WriteTreeResponse> => parseWriteTreeResponse(await client.exchange(req)),
		close: client.close,
	};
}
