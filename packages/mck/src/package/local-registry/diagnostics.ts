// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import type { ViolationRule as ResolutionRule } from "../resolution/model.ts";
import type { LocalId, RegistryPath } from "./domain.ts";

export type Subject =
	| { readonly kind: "lock" | "policy" | "request" }
	| { readonly kind: "repository"; readonly registry: LocalId }
	| { readonly kind: "object"; readonly registry: LocalId; readonly path: RegistryPath };
export type SubjectWire =
	| { readonly kind: "lock" | "policy" | "request" }
	| { readonly kind: "repository"; readonly registry: string }
	| { readonly kind: "object"; readonly registry: string; readonly path: string };
export type Phase = "decode" | "support" | "shape" | "structure" | "repository" | "authorization" | "catalog" | "bundle" | "graph" | "publication" | "commit";
export type ViolationRule =
	| ResolutionRule
	| "noncanonical"
	| "missing-reference"
	| "orphan-reference"
	| "evidence-kind-mismatch"
	| "target-link-mismatch"
	| "dependency-mismatch"
	| "threshold-exceeds-keys";
export type DecodeCode =
	| "unsafe-path"
	| "invalid-input"
	| "resource-limit"
	| "unsupported-profile"
	| "unsupported-source"
	| "unsupported-capability"
	| "unsupported-payload-type"
	| "capability-unavailable";
export type DecodeResource =
	| "lock-bytes"
	| "policy-bytes"
	| "record-bytes"
	| "statement-bytes"
	| "envelope-bytes"
	| "root-bytes"
	| "timestamp-bytes"
	| "snapshot-bytes"
	| "targets-bytes"
	| "json-depth"
	| "graph-nodes"
	| "node-bindings"
	| "graph-bindings"
	| "evidence-entries"
	| "publisher-rules"
	| "namespace-grants"
	| "publisher-keys"
	| "signatures"
	| "path-bytes"
	| "path-components"
	| "component-bytes";
export type DecodeWitness =
	| { readonly kind: "path"; readonly subject: SubjectWire; readonly rule: "grammar" | "reserved-name" }
	| { readonly kind: "violation"; readonly subject: SubjectWire; readonly pointer: string; readonly rule: ViolationRule }
	| { readonly kind: "unsupported"; readonly subject: SubjectWire; readonly pointer: string; readonly value: string }
	| {
			readonly kind: "resource";
			readonly subject: SubjectWire;
			readonly resource: DecodeResource;
			readonly scope: "profile";
			readonly maximum: string;
			readonly observed: string;
	  };
export interface DecodeFault {
	readonly phase: Phase;
	readonly code: DecodeCode;
	readonly witnesses: readonly DecodeWitness[];
}
export interface DecodeFailure {
	readonly ok: false;
	readonly diagnostic: DecodeFault & { readonly category: "invalid-input" | "unsupported-capability" | "domain-rejection" };
}
export type DecodeResult<T> = { readonly ok: true; readonly value: T } | DecodeFailure;
export function subjectToWire(subject: Subject): SubjectWire {
	if (subject.kind === "object") return { kind: subject.kind, registry: subject.registry.toWire(), path: subject.path.toWire() };
	if (subject.kind === "repository") return { kind: subject.kind, registry: subject.registry.toWire() };
	return subject;
}
export function canonicalDiagnostic(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalDiagnostic).join(",")}]`;
	if (value !== null && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
			.map(([key, child]) => `${JSON.stringify(key)}:${canonicalDiagnostic(child)}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
const phases: readonly Phase[] = [
	"decode",
	"support",
	"shape",
	"structure",
	"repository",
	"authorization",
	"catalog",
	"bundle",
	"graph",
	"publication",
	"commit",
];
const rank = (code: DecodeCode) => (code === "resource-limit" ? 0 : code === "unsafe-path" ? 1 : code === "invalid-input" ? 2 : 3);
/** Input order is deterministic logical-object order; fatal resource faults retain only its first witness. */
export function selectFailure(faults: readonly DecodeFault[]): DecodeFailure | undefined {
	const selected = [...faults].sort(
		(a, b) => phases.indexOf(a.phase) - phases.indexOf(b.phase) || rank(a.code) - rank(b.code) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
	)[0];
	if (!selected) return undefined;
	const matching = faults.filter((fault) => fault.phase === selected.phase && fault.code === selected.code).flatMap((fault) => fault.witnesses);
	const unique = new Map(matching.map((witness) => [canonicalDiagnostic(witness), witness]));
	const witnesses =
		selected.code === "resource-limit" || selected.code === "unsafe-path"
			? matching.slice(0, 1)
			: [...unique].sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(([, witness]) => witness);
	return {
		ok: false,
		diagnostic: {
			category:
				selected.code === "invalid-input"
					? "invalid-input"
					: selected.code === "resource-limit" || selected.code === "unsafe-path"
						? "domain-rejection"
						: "unsupported-capability",
			code: selected.code,
			phase: selected.phase,
			witnesses,
		},
	};
}
export function invalid(subject: Subject, phase: Phase, violations: readonly { readonly pointer: string; readonly rule: ViolationRule }[]): DecodeFailure {
	return selectFailure([
		{ code: "invalid-input", phase, witnesses: violations.map((violation) => ({ kind: "violation", subject: subjectToWire(subject), ...violation })) },
	]) as DecodeFailure;
}
export function resourceFailure(subject: Subject, phase: Phase, resource: DecodeResource, maximum: number): DecodeFailure {
	return {
		ok: false,
		diagnostic: {
			category: "domain-rejection",
			code: "resource-limit",
			phase,
			witnesses: [{ kind: "resource", subject: subjectToWire(subject), resource, scope: "profile", maximum: String(maximum), observed: String(maximum + 1) }],
		},
	};
}
