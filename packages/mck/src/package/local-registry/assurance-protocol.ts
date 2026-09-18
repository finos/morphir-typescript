// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { array, fields, nonempty, object } from "../json.ts";
import {
	RESTORE_ASSURANCE_PROFILE,
	RESTORE_ASSURANCE_PROFILE_VERSION,
	type RestoreAssuranceEnvironment,
	type RestoreAssuranceMode,
	type RestoreAssuranceProvider,
	type RestoreAssuranceProviderIdentity,
	type RestoreAssuranceQualification,
	type RestoreAssuranceReceipt,
	type RestoreAssuranceRequest,
	type RestoreAssuranceSelection,
} from "./assurance.ts";

function mode(value: unknown): RestoreAssuranceMode {
	if (value !== "portable" && value !== "hardened") throw new Error("unknown restore assurance mode");
	return value;
}
function freeze<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function nonemptyList<T>(values: T[]): [T, ...T[]] {
	const [first, ...rest] = values;
	if (first === undefined) throw new Error("expected nonempty list");
	return [first, ...rest];
}
function identity(value: unknown): RestoreAssuranceProviderIdentity {
	const entry = fields(value, ["id", "version"]);
	return { id: nonempty(entry.id), version: nonempty(entry.version) };
}
function platform(value: unknown) {
	const entry = fields(value, ["name", "version"]);
	return { name: nonempty(entry.name), version: nonempty(entry.version) };
}
function environment(value: unknown): RestoreAssuranceEnvironment {
	const entry = fields(value, ["runtime", "os", "architecture", "filesystem", "assumptions"]);
	return {
		runtime: platform(entry.runtime),
		os: platform(entry.os),
		architecture: nonempty(entry.architecture),
		filesystem: nonempty(entry.filesystem),
		assumptions: nonemptyList(Array.from(array(entry.assumptions), nonempty)),
	};
}
function qualification(value: unknown): RestoreAssuranceQualification {
	const entry = fields(value, ["mode", "environment", "evidence"]);
	return { mode: mode(entry.mode), environment: environment(entry.environment), evidence: nonemptyList(Array.from(array(entry.evidence), nonempty)) };
}

/** Closed structural parser; all results are independent, deeply frozen snapshots. */
export function parseRestoreAssuranceSelection(value: unknown): RestoreAssuranceSelection {
	const entry = fields(value, ["profile", "profileVersion", "mode"]);
	if (entry.profile !== RESTORE_ASSURANCE_PROFILE || entry.profileVersion !== RESTORE_ASSURANCE_PROFILE_VERSION)
		throw new Error("unsupported restore assurance profile");
	return freeze({ profile: RESTORE_ASSURANCE_PROFILE, profileVersion: RESTORE_ASSURANCE_PROFILE_VERSION, mode: mode(entry.mode) });
}

/** Qualification and evidence are host attestations, not independently verified here. */
export function parseRestoreAssuranceProvider(value: unknown): RestoreAssuranceProvider {
	const entry = fields(value, ["identity", "qualification"]);
	const providerIdentity = identity(entry.identity);
	const attestation = object(entry.qualification);
	if (attestation.kind === "unqualified") {
		fields(attestation, ["kind"]);
		return freeze({ identity: providerIdentity, qualification: { kind: "unqualified" } });
	}
	if (attestation.kind !== "qualified") throw new Error("unknown provider qualification kind");
	fields(attestation, ["kind", "entries"]);
	const entries = nonemptyList(array(attestation.entries).map(qualification));
	if (new Set(entries.map((entry) => entry.mode)).size !== entries.length) throw new Error("duplicate restore assurance mode");
	return freeze({ identity: providerIdentity, qualification: { kind: "qualified", entries } });
}

export function parseRestoreAssuranceRequest(value: unknown): RestoreAssuranceRequest {
	const entry = fields(value, ["selection", "provider"]);
	return freeze({ selection: parseRestoreAssuranceSelection(entry.selection), provider: parseRestoreAssuranceProvider(entry.provider) });
}

/** Wire receipts are reports only. Parsing one does not authorize package access. */
export function parseRestoreAssuranceReceipt(value: unknown): RestoreAssuranceReceipt {
	const entry = object(value);
	if (entry.kind === "rejected") {
		fields(entry, ["kind", "selection", "provider", "reason"]);
		if (entry.reason !== "provider-unqualified" && entry.reason !== "mode-unavailable") throw new Error("unknown restore assurance rejection");
		return freeze({ kind: "rejected", selection: parseRestoreAssuranceSelection(entry.selection), provider: identity(entry.provider), reason: entry.reason });
	}
	if (entry.kind !== "selected") throw new Error("unknown restore assurance receipt kind");
	fields(entry, ["kind", "context"]);
	const context = fields(entry.context, ["selection", "provider", "qualification"]);
	const selection = parseRestoreAssuranceSelection(context.selection);
	const selectedQualification = qualification(context.qualification);
	const provider = identity(context.provider);
	if (selection.mode !== selectedQualification.mode) throw new Error("restore assurance receipt mode mismatch");
	// Preserve mode agreement in the domain type as well as at the wire boundary.
	return freeze({
		kind: "selected",
		context:
			selection.mode === "portable"
				? { selection: { ...selection, mode: "portable" }, provider, qualification: { ...selectedQualification, mode: "portable" } }
				: { selection: { ...selection, mode: "hardened" }, provider, qualification: { ...selectedQualification, mode: "hardened" } },
	});
}
