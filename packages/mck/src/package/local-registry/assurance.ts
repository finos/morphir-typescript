// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { parseRestoreAssuranceProvider, parseRestoreAssuranceReceipt, parseRestoreAssuranceSelection } from "./assurance-protocol.ts";

export const RESTORE_ASSURANCE_PROFILE = "restore-filesystem-assurance";
export const RESTORE_ASSURANCE_PROFILE_VERSION = "0.1.0-draft.1";
export type RestoreAssuranceMode = "portable" | "hardened";

export interface RestoreAssuranceSelection<Mode extends RestoreAssuranceMode = RestoreAssuranceMode> {
	readonly profile: typeof RESTORE_ASSURANCE_PROFILE;
	readonly profileVersion: typeof RESTORE_ASSURANCE_PROFILE_VERSION;
	readonly mode: Mode;
}
export interface RestoreAssuranceProviderIdentity {
	readonly id: string;
	readonly version: string;
}
export interface RestoreAssuranceEnvironment {
	readonly runtime: { readonly name: string; readonly version: string };
	readonly os: { readonly name: string; readonly version: string };
	readonly architecture: string;
	readonly filesystem: string;
	readonly assumptions: readonly [string, ...string[]];
}
/** Trusted host attestation. Parsing does not verify evidence or qualify a backend. */
export interface RestoreAssuranceQualification<Mode extends RestoreAssuranceMode = RestoreAssuranceMode> {
	readonly mode: Mode;
	readonly environment: RestoreAssuranceEnvironment;
	readonly evidence: readonly [string, ...string[]];
}
export interface RestoreAssuranceProvider {
	readonly identity: RestoreAssuranceProviderIdentity;
	readonly qualification:
		| { readonly kind: "unqualified" }
		| { readonly kind: "qualified"; readonly entries: readonly [RestoreAssuranceQualification, ...RestoreAssuranceQualification[]] };
}
export type RestoreAssuranceContext = {
	[Mode in RestoreAssuranceMode]: {
		readonly selection: RestoreAssuranceSelection<Mode>;
		readonly provider: RestoreAssuranceProviderIdentity;
		readonly qualification: RestoreAssuranceQualification<Mode>;
	};
}[RestoreAssuranceMode];
export type RestoreAssuranceReceipt =
	| { readonly kind: "selected"; readonly context: RestoreAssuranceContext }
	| {
			readonly kind: "rejected";
			readonly selection: RestoreAssuranceSelection;
			readonly provider: RestoreAssuranceProviderIdentity;
			readonly reason: "provider-unqualified" | "mode-unavailable";
	  };
export interface RestoreAssuranceRequest {
	readonly selection: RestoreAssuranceSelection;
	readonly provider: RestoreAssuranceProvider;
}
export type RestoreAssuranceExecution<T> =
	| { readonly kind: "executed"; readonly receipt: Extract<RestoreAssuranceReceipt, { kind: "selected" }>; readonly value: T }
	| { readonly kind: "rejected"; readonly receipt: Extract<RestoreAssuranceReceipt, { kind: "rejected" }> };

/**
 * Select fresh trusted host inputs before the callback can access packages.
 * The receipt records preflight only: it is neither authentication nor graph readiness
 * nor compatibility evidence. No provider is implemented or qualified by this module.
 * Callback errors propagate unchanged; there is no retry or mode fallback.
 */
export async function withRestoreAssurance<T>(
	selectionInput: unknown,
	providerInput: unknown,
	callback: (context: RestoreAssuranceContext) => T | Promise<T>,
): Promise<RestoreAssuranceExecution<T>> {
	const selection = parseRestoreAssuranceSelection(selectionInput);
	const provider = parseRestoreAssuranceProvider(providerInput);
	const qualification = provider.qualification.kind === "qualified" ? provider.qualification.entries.find((entry) => entry.mode === selection.mode) : undefined;
	const receipt = parseRestoreAssuranceReceipt(
		qualification
			? { kind: "selected", context: { selection, provider: provider.identity, qualification } }
			: {
					kind: "rejected",
					selection,
					provider: provider.identity,
					reason: provider.qualification.kind === "unqualified" ? "provider-unqualified" : "mode-unavailable",
				},
	);
	if (receipt.kind === "rejected") return Object.freeze({ kind: "rejected", receipt });
	const value = await callback(receipt.context);
	return Object.freeze({ kind: "executed" as const, receipt, value });
}
