// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import type { PackageContractTestee } from "../contract.ts";
import type { ResolutionResult } from "./model.ts";

export const RESOLUTION_CONTRACT = "0.1.0-draft.2" as const;
export const RESOLUTION_OPERATIONS = ["resolve-library"] as const;
export const RESOLUTION_PROFILES = ["flat-library"] as const;
export type ResolutionOperation = (typeof RESOLUTION_OPERATIONS)[number];
export type ResolutionProfile = (typeof RESOLUTION_PROFILES)[number];
export interface ResolutionRequest {
	readonly op: "resolve-library";
	/** Raw JSON is intentional: malformed and duplicate-key documents are cases. */
	readonly input: string;
}
export type ResolutionResponse = ResolutionResult;
export interface ResolutionCapabilities {
	readonly suite: "package";
	readonly contractVersion: typeof RESOLUTION_CONTRACT;
	readonly implementation: string;
	readonly implementationVersion: string;
	readonly operations: readonly ResolutionOperation[];
	readonly profiles: readonly ResolutionProfile[];
}
export type ResolutionTestee = PackageContractTestee<ResolutionCapabilities, ResolutionRequest, ResolutionResponse>;
