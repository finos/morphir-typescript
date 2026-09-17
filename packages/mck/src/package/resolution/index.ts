// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { diagnoseResolutionFailure } from "./diagnostics.ts";
import type { ResolutionResult } from "./model.ts";
import { parseResolutionInput } from "./parse.ts";
import { replayLockedGraph } from "./replay.ts";
import { searchInitialLibrary } from "./search.ts";
import { updateLockedGraph } from "./update.ts";

export type ResolutionExecutionReason = "resource-exhausted";

/** Execution boundary for resource failure, which is never a domain rejection. */
export class ResolutionExecutionError extends Error {
	readonly code = "execution-error";

	constructor(
		readonly mode: "initial" | "update",
		readonly reason: ResolutionExecutionReason,
		options?: ErrorOptions,
	) {
		super(`${mode} resolution ${reason}`, options);
		this.name = "ResolutionExecutionError";
	}
}

export function resolveLibrary(input: string): ResolutionResult {
	const parsed = parseResolutionInput(input);
	if (!parsed.ok) return parsed;
	if (parsed.value.mode === "replay") return replayLockedGraph(parsed.value);
	try {
		let searched: ReturnType<typeof searchInitialLibrary>;
		if (parsed.value.mode === "update") {
			const updated = updateLockedGraph(parsed.value);
			if (updated.kind === "rejection") return updated.result;
			searched = updated;
		} else searched = searchInitialLibrary(parsed.value);
		if (searched.kind === "selection") return { ok: true, graph: searched.graph };
		if (searched.kind === "incomplete-input")
			return {
				ok: false,
				diagnostic: {
					code: "incomplete-input",
					missing: searched.missing.map((item) =>
						item.kind === "catalog"
							? { kind: item.kind, packagePath: item.packagePath.toWire() }
							: { kind: item.kind, release: { packagePath: item.release.packagePath.toWire(), version: item.release.version.toWire() } },
					),
				},
			};
		return diagnoseResolutionFailure(parsed.value);
	} catch (error) {
		if (error instanceof RangeError) throw new ResolutionExecutionError(parsed.value.mode, "resource-exhausted", { cause: error });
		throw error;
	}
}
