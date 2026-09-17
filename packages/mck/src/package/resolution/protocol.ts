// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { array, fields, nonempty, object, string } from "../json.ts";
import {
	RESOLUTION_CONTRACT,
	RESOLUTION_OPERATIONS,
	RESOLUTION_PROFILES,
	type ResolutionCapabilities,
	type ResolutionContractDescriptor,
	type ResolutionOperation,
	type ResolutionProfile,
	type ResolutionRequest,
	type ResolutionResponse,
} from "./contract.ts";
import {
	ContentDigest,
	IRPackageName,
	type LockedGraphWire,
	ManifestDigest,
	PackagePath,
	type ReleaseRecordWire,
	type ResolutionDiagnosticWire,
	type ResolutionWitnessWire,
	StableVersion,
} from "./model.ts";
import { validateLockedGraph, validateResolutionWitness } from "./result-validation.ts";

export function parseResolutionCapabilities(value: unknown): ResolutionCapabilities {
	const entry = fields(value, ["suite", "contractVersion", "implementation", "implementationVersion", "operations", "profiles"]);
	if (entry.suite !== "package" || entry.contractVersion !== RESOLUTION_CONTRACT) throw new Error("unsupported package adapter contract");
	const operations = array(entry.operations).map((value) => {
		if (!RESOLUTION_OPERATIONS.includes(value as ResolutionOperation)) throw new Error(`unknown package operation ${String(value)}`);
		return value as ResolutionOperation;
	});
	const profiles = array(entry.profiles).map((value) => {
		if (!RESOLUTION_PROFILES.includes(value as ResolutionProfile)) throw new Error(`unknown package profile ${String(value)}`);
		return value as ResolutionProfile;
	});
	if (new Set(operations).size !== operations.length || new Set(profiles).size !== profiles.length) throw new Error("duplicate package capability");
	return {
		suite: "package",
		contractVersion: RESOLUTION_CONTRACT,
		implementation: nonempty(entry.implementation),
		implementationVersion: nonempty(entry.implementationVersion),
		operations,
		profiles,
	};
}

export function parseResolutionRequest(value: unknown): ResolutionRequest | { readonly op: "capabilities" } | { readonly op: "exit" } {
	const entry = object(value);
	switch (entry.op) {
		case "capabilities":
		case "exit":
			fields(entry, ["op"]);
			return { op: entry.op };
		case "resolve-library":
			fields(entry, ["op", "input"]);
			return { op: entry.op, input: string(entry.input) };
		default:
			throw new Error("unknown package request");
	}
}

/** Strict structural cloning; the full result schema is applied by the corpus and installed protocol tests. */
export function parseResolutionResponse(value: unknown, operation: ResolutionOperation): ResolutionResponse {
	if (operation !== "resolve-library") throw new Error(`unknown package operation ${operation as string}`);
	const entry = object(value);
	if (entry.ok === true) {
		fields(entry, ["ok", "graph"]);
		return { ok: true, graph: parseGraph(entry.graph) };
	}
	if (entry.ok === false) {
		fields(entry, ["ok", "diagnostic"]);
		return { ok: false, diagnostic: parseDiagnostic(entry.diagnostic) };
	}
	throw new Error("resolution adapter did not return a result");
}

export function projectResolutionResult(value: ResolutionResponse): ResolutionResponse {
	const parsed = parseResolutionResponse(value, "resolve-library");
	if (parsed.ok) return { ok: true, graph: projectGraph(parsed.graph) };
	const diagnostic = parsed.diagnostic;
	switch (diagnostic.code) {
		case "invalid-input":
		case "invalid-lock":
			return {
				ok: false,
				diagnostic: {
					...diagnostic,
					violations: [...diagnostic.violations].sort((left, right) => compareText(left.pointer, right.pointer) || compareText(left.rule, right.rule)),
				},
			};
		case "incomplete-input":
			return {
				ok: false,
				diagnostic: {
					...diagnostic,
					missing: [...diagnostic.missing].sort(compareMissing),
				},
			};
		case "update-scope-conflict":
			return {
				ok: false,
				diagnostic: { ...diagnostic, changedPins: [...diagnostic.changedPins].sort(compareChangedPin), witness: projectWitness(diagnostic.witness) },
			};
		case "unsupported-capability":
			return {
				ok: false,
				diagnostic: { ...diagnostic, changedPins: [...diagnostic.changedPins].sort(compareChangedPin), witness: projectWitness(diagnostic.witness) },
			};
		case "unsatisfiable-requirements":
			return {
				ok: false,
				diagnostic: {
					...diagnostic,
					root: projectReleaseRecord(diagnostic.root),
					catalogs: diagnostic.catalogs
						.map((catalog) => ({
							...catalog,
							releases: catalog.releases.map(projectReleaseRecord).sort((left, right) => compareVersion(right.release.version, left.release.version)),
						}))
						.sort((left, right) => compareText(left.packagePath, right.packagePath)),
					targets: [...diagnostic.targets].sort((left, right) => compareText(left.packagePath, right.packagePath)),
				},
			};
	}
}

const RULES = [
	"malformed-json",
	"duplicate-key",
	"unknown-field",
	"missing-field",
	"invalid-type",
	"invalid-value",
	"invalid-name",
	"invalid-version",
	"invalid-interval",
	"invalid-digest",
	"duplicate-identity",
	"identity-mismatch",
	"missing-root",
	"dangling-binding",
	"binding-mismatch",
	"requirement-mismatch",
	"digest-mismatch",
	"unreachable-node",
	"cycle",
	"unsupported-flat-binding",
] as const;

function parsed(value: unknown, parse: (text: string) => unknown): string {
	const result = string(value);
	parse(result);
	return result;
}
const packagePath = (value: unknown): string => parsed(value, PackagePath.parse);
const irPackageName = (value: unknown): string => parsed(value, IRPackageName.parse);
const manifestDigest = (value: unknown): string => parsed(value, ManifestDigest.parse);
const contentDigest = (value: unknown): string => parsed(value, ContentDigest.parse);
function version(value: unknown): string {
	const result = string(value);
	StableVersion.parse(result);
	return result;
}
function releaseId(value: unknown) {
	const entry = fields(value, ["packagePath", "version"]);
	return { packagePath: packagePath(entry.packagePath), version: version(entry.version) };
}
function requirement(value: unknown) {
	const entry = fields(value, ["irPackageName", "packagePath", "versionRange"]);
	const range = fields(entry.versionRange, ["minimumInclusive", "maximumExclusive"]);
	return {
		irPackageName: irPackageName(entry.irPackageName),
		packagePath: packagePath(entry.packagePath),
		versionRange: { minimumInclusive: version(range.minimumInclusive), maximumExclusive: version(range.maximumExclusive) },
	};
}
function releaseRecord(value: unknown) {
	const entry = fields(value, ["release", "irPackageName", "manifestDigest", "contentDigest", "dependencies"]);
	return {
		release: releaseId(entry.release),
		irPackageName: irPackageName(entry.irPackageName),
		manifestDigest: manifestDigest(entry.manifestDigest),
		contentDigest: contentDigest(entry.contentDigest),
		dependencies: array(entry.dependencies).map(requirement),
	};
}
function binding(value: unknown) {
	const entry = fields(value, ["irPackageName", "target"]);
	return { irPackageName: irPackageName(entry.irPackageName), target: releaseId(entry.target) };
}
function lockedNode(value: unknown) {
	const entry = fields(value, ["release", "irPackageName", "manifestDigest", "contentDigest", "bindings"]);
	return {
		release: releaseId(entry.release),
		irPackageName: irPackageName(entry.irPackageName),
		manifestDigest: manifestDigest(entry.manifestDigest),
		contentDigest: contentDigest(entry.contentDigest),
		bindings: array(entry.bindings).map(binding),
	};
}
function parseGraph(value: unknown) {
	const entry = fields(value, ["root", "nodes"]);
	const nodes = array(entry.nodes).map(lockedNode);
	const root = releaseId(entry.root);
	const graph = { root, nodes };
	validateLockedGraph(graph);
	return graph;
}
function changedPin(value: unknown) {
	const entry = object(value);
	if (entry.kind === "changed") {
		fields(entry, ["kind", "previous", "selected"]);
		return { kind: "changed" as const, previous: releaseId(entry.previous), selected: releaseId(entry.selected) };
	}
	if (entry.kind === "removed") {
		fields(entry, ["kind", "previous"]);
		return { kind: "removed" as const, previous: releaseId(entry.previous) };
	}
	throw new Error("unknown changed pin kind");
}
function occurrence(value: unknown): string[] {
	return array(value).map(irPackageName);
}
function witness(value: unknown) {
	const entry = fields(value, ["nodes"]);
	const nodes = array(entry.nodes).map((value) => {
		const node = fields(value, ["occurrence", "release", "bindings"]);
		return {
			occurrence: occurrence(node.occurrence),
			release: releaseId(node.release),
			bindings: array(node.bindings).map((value) => {
				const item = fields(value, ["irPackageName", "targetOccurrence"]);
				return { irPackageName: irPackageName(item.irPackageName), targetOccurrence: occurrence(item.targetOccurrence) };
			}),
		};
	});
	const result = { nodes };
	validateResolutionWitness(result);
	return result;
}
function target(value: unknown) {
	const entry = object(value);
	if (entry.kind === "eligible") {
		fields(entry, ["kind", "packagePath"]);
		return { kind: "eligible" as const, packagePath: packagePath(entry.packagePath) };
	}
	if (entry.kind === "exact") {
		fields(entry, ["kind", "packagePath", "version"]);
		return { kind: "exact" as const, packagePath: packagePath(entry.packagePath), version: version(entry.version) };
	}
	throw new Error("unknown resolution target kind");
}
function parseDiagnostic(value: unknown): ResolutionDiagnosticWire {
	const entry = object(value);
	const code = string(entry.code);
	switch (code) {
		case "invalid-input":
		case "invalid-lock": {
			fields(entry, ["code", "violations"]);
			const violations = array(entry.violations).map((value) => {
				const violation = fields(value, ["pointer", "rule"]);
				if (!RULES.includes(violation.rule as (typeof RULES)[number])) throw new Error("unknown resolution violation rule");
				return { pointer: string(violation.pointer), rule: violation.rule as (typeof RULES)[number] };
			});
			if (violations.length === 0) throw new Error("resolution violations must not be empty");
			return { code, violations };
		}
		case "incomplete-input": {
			fields(entry, ["code", "missing"]);
			const missing = array(entry.missing).map((value) => {
				const item = object(value);
				if (item.kind === "catalog") {
					fields(item, ["kind", "packagePath"]);
					return { kind: "catalog" as const, packagePath: packagePath(item.packagePath) };
				}
				if (item.kind === "release") {
					fields(item, ["kind", "release"]);
					return { kind: "release" as const, release: releaseId(item.release) };
				}
				throw new Error("unknown missing resolution item");
			});
			if (missing.length === 0) throw new Error("missing resolution items must not be empty");
			return { code, missing };
		}
		case "update-scope-conflict":
			fields(entry, ["code", "changedPins", "witness"]);
			{
				const changedPins = array(entry.changedPins).map(changedPin);
				if (changedPins.length === 0) throw new Error("update-scope-conflict must change at least one pin");
				return { code, changedPins, witness: witness(entry.witness) };
			}
		case "unsupported-capability":
			fields(entry, ["code", "requiredCapabilities", "changedPins", "witness"]);
			if (JSON.stringify(entry.requiredCapabilities) !== '["graph-aware-coexistence"]') throw new Error("unknown required resolution capability");
			return {
				code,
				requiredCapabilities: ["graph-aware-coexistence"],
				changedPins: array(entry.changedPins).map(changedPin),
				witness: witness(entry.witness),
			};
		case "unsatisfiable-requirements":
			fields(entry, ["code", "root", "catalogs", "targets"]);
			return {
				code,
				root: releaseRecord(entry.root),
				catalogs: array(entry.catalogs).map((value) => {
					const catalog = fields(value, ["packagePath", "releases"]);
					return { packagePath: packagePath(catalog.packagePath), releases: array(catalog.releases).map(releaseRecord) };
				}),
				targets: array(entry.targets).map(target),
			};
		default:
			throw new Error(`unknown resolution diagnostic ${code}`);
	}
}

function compareText(left: string, right: string): number {
	return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
function compareVersion(left: string, right: string): number {
	return StableVersion.parse(left).compare(StableVersion.parse(right));
}
function compareRelease(
	left: { readonly packagePath: string; readonly version: string },
	right: { readonly packagePath: string; readonly version: string },
): number {
	return compareText(left.packagePath, right.packagePath) || compareVersion(right.version, left.version);
}
function projectGraph(graph: LockedGraphWire) {
	return {
		root: graph.root,
		nodes: graph.nodes
			.map((node) => ({ ...node, bindings: [...node.bindings].sort((left, right) => compareText(left.irPackageName, right.irPackageName)) }))
			.sort((left, right) => {
				const leftRoot = left.release.packagePath === graph.root.packagePath && left.release.version === graph.root.version;
				const rightRoot = right.release.packagePath === graph.root.packagePath && right.release.version === graph.root.version;
				return leftRoot === rightRoot ? compareRelease(left.release, right.release) : leftRoot ? -1 : 1;
			}),
	};
}
function compareMissing(
	left: Extract<ResolutionDiagnosticWire, { code: "incomplete-input" }>["missing"][number],
	right: Extract<ResolutionDiagnosticWire, { code: "incomplete-input" }>["missing"][number],
): number {
	if (left.kind !== right.kind) return left.kind === "catalog" ? -1 : 1;
	if (left.kind === "catalog" && right.kind === "catalog") return compareText(left.packagePath, right.packagePath);
	if (left.kind === "release" && right.kind === "release") return compareRelease(left.release, right.release);
	return 0;
}
function compareChangedPin(left: ReturnType<typeof changedPin>, right: ReturnType<typeof changedPin>): number {
	return (
		compareText(left.previous.packagePath, right.previous.packagePath) ||
		(left.kind === "changed" && right.kind === "changed" ? compareVersion(right.selected.version, left.selected.version) : compareText(left.kind, right.kind))
	);
}
function compareOccurrence(left: readonly string[], right: readonly string[]): number {
	for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
		const order = compareText(left[index] as string, right[index] as string);
		if (order) return order;
	}
	return left.length - right.length;
}
function projectWitness(value: ResolutionWitnessWire) {
	return {
		nodes: value.nodes
			.map((node) => ({ ...node, bindings: [...node.bindings].sort((left, right) => compareText(left.irPackageName, right.irPackageName)) }))
			.sort((left, right) => compareOccurrence(left.occurrence, right.occurrence)),
	};
}
function projectReleaseRecord(value: ReleaseRecordWire) {
	return { ...value, dependencies: [...value.dependencies].sort((left, right) => compareText(left.irPackageName, right.irPackageName)) };
}

export const resolutionContract: ResolutionContractDescriptor = {
	contractVersion: RESOLUTION_CONTRACT,
	operation: (request) => request.op,
	supports: (capabilities, operation) => capabilities.operations.includes(operation) && capabilities.profiles.includes("flat-library"),
	parseCapabilities: parseResolutionCapabilities,
	parseRequest: parseResolutionRequest,
	parseResponse: parseResolutionResponse,
	projectResult: projectResolutionResult,
};
