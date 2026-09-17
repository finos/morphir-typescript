// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import {
	type Binding,
	type LockedGraph,
	type LockedNode,
	type ReleaseId,
	type ReleaseRecord,
	type ReplayResolutionInput,
	type ResolutionResult,
	releaseIdsEqual,
	releaseIdToWire,
	type UpdateResolutionInput,
	type Violation,
} from "./model.ts";
import { compareReleaseIdsCanonical, orderBindingsForOutput, orderLockedNodesForOutput, orderViolationsCanonical } from "./order.ts";
import { lockedGraphToWire } from "./wire.ts";

function normalizeLock(lock: LockedGraph): LockedGraph {
	return {
		...lock,
		nodes: orderLockedNodesForOutput(lock.root, lock.nodes).map((node) => ({
			...node,
			bindings: orderBindingsForOutput(node.bindings),
		})),
	};
}

function releaseKey(release: ReleaseId): string {
	return `${release.packagePath.toWire()}@${release.version.toWire()}`;
}

interface ValidEdge {
	readonly source: LockedNode;
	readonly binding: Binding;
	readonly target: LockedNode;
}

type AdjacencyIndex = ReadonlyMap<string, readonly LockedNode[]>;

function canReach(start: LockedNode, destination: LockedNode, adjacency: AdjacencyIndex): boolean {
	const pending = [start];
	const visited = new Set<string>();
	while (pending.length > 0) {
		const current = pending.pop() as LockedNode;
		const key = releaseKey(current.release);
		if (visited.has(key)) continue;
		if (releaseIdsEqual(current.release, destination.release)) return true;
		visited.add(key);
		for (const target of adjacency.get(key) ?? []) pending.push(target);
	}
	return false;
}

type LockedResolutionInput = ReplayResolutionInput | UpdateResolutionInput;
type ResolutionFailure = Extract<ResolutionResult, { readonly ok: false }>;
const validatedLock: unique symbol = Symbol("validated-lock");

/** A lock that has passed topology, selected-metadata, and immutable-metadata validation. */
export interface ValidatedLockedInput<T extends LockedResolutionInput = LockedResolutionInput> {
	readonly [validatedLock]: true;
	readonly input: T;
	readonly recordFor: (release: ReleaseId) => ReleaseRecord;
}

export type OldLockValidationResult<T extends LockedResolutionInput = LockedResolutionInput> =
	| { readonly ok: true; readonly value: ValidatedLockedInput<T> }
	| { readonly ok: false; readonly result: ResolutionFailure };

function validateLockTopology(input: LockedResolutionInput): readonly Violation[] {
	const violations: Violation[] = [];
	const nodesByRelease = new Map(input.lock.nodes.map((node) => [releaseKey(node.release), node]));
	const edges: ValidEdge[] = [];
	const adjacency = new Map<string, LockedNode[]>();
	for (const node of input.lock.nodes) {
		for (const binding of node.bindings) {
			const target = nodesByRelease.get(releaseKey(binding.target));
			if (target === undefined) violations.push({ pointer: `${binding.sourcePointer}/target`, rule: "dangling-binding" });
			else {
				edges.push({ source: node, binding, target });
				const sourceKey = releaseKey(node.release);
				const targets = adjacency.get(sourceKey);
				if (targets === undefined) adjacency.set(sourceKey, [target]);
				else targets.push(target);
			}
		}
	}

	const rootAgrees = releaseIdsEqual(input.lock.root, input.root.release);
	const rootNode = nodesByRelease.get(releaseKey(input.lock.root));
	if (!rootAgrees) violations.push({ pointer: "/lock/root", rule: "identity-mismatch" });
	else if (rootNode === undefined) violations.push({ pointer: "/lock/root", rule: "missing-root" });
	else {
		const reachable = new Set<string>();
		const pending = [rootNode];
		while (pending.length > 0) {
			const current = pending.pop() as LockedNode;
			const key = releaseKey(current.release);
			if (reachable.has(key)) continue;
			reachable.add(key);
			for (const target of adjacency.get(key) ?? []) pending.push(target);
		}
		for (const node of input.lock.nodes)
			if (!reachable.has(releaseKey(node.release))) violations.push({ pointer: `${node.sourcePointer}/release`, rule: "unreachable-node" });
	}

	for (const edge of edges)
		if (canReach(edge.target, edge.source, adjacency)) violations.push({ pointer: `${edge.binding.sourcePointer}/target`, rule: "cycle" });
	return orderViolationsCanonical(violations);
}

function suppliedRecords(input: LockedResolutionInput): readonly ReleaseRecord[] {
	return input.mode === "replay" ? input.releases : input.catalogs.flatMap((catalog) => catalog.releases);
}

function selectedMetadata(
	input: LockedResolutionInput,
): { readonly ok: true; readonly records: ReadonlyMap<string, ReleaseRecord> } | { readonly ok: false; readonly result: ResolutionFailure } {
	const records = new Map(suppliedRecords(input).map((record) => [releaseKey(record.release), record]));
	const missing = input.lock.nodes
		.filter((node) => !releaseIdsEqual(node.release, input.root.release) && !records.has(releaseKey(node.release)))
		.map((node) => node.release)
		.sort(compareReleaseIdsCanonical);
	if (missing.length > 0)
		return {
			ok: false,
			result: {
				ok: false,
				diagnostic: { code: "incomplete-input", missing: missing.map((release) => ({ kind: "release", release: releaseIdToWire(release) })) },
			},
		};
	records.set(releaseKey(input.root.release), input.root);
	return { ok: true, records };
}

function validateLockMetadata(input: LockedResolutionInput, records: ReadonlyMap<string, ReleaseRecord>): readonly Violation[] {
	const violations: Violation[] = [];
	const nodesByRelease = new Map(input.lock.nodes.map((node) => [releaseKey(node.release), node]));
	for (const node of input.lock.nodes) {
		const record = records.get(releaseKey(node.release));
		if (record === undefined) throw new Error("complete selected metadata omitted a locked release");
		if (!node.irPackageName.equals(record.irPackageName)) violations.push({ pointer: `${node.sourcePointer}/irPackageName`, rule: "identity-mismatch" });
		if (node.manifestDigest.toWire() !== record.manifestDigest.toWire())
			violations.push({ pointer: `${node.sourcePointer}/manifestDigest`, rule: "digest-mismatch" });
		if (node.contentDigest.toWire() !== record.contentDigest.toWire())
			violations.push({ pointer: `${node.sourcePointer}/contentDigest`, rule: "digest-mismatch" });

		const requirements = new Map(record.dependencies.map((requirement) => [requirement.irPackageName.toWire(), requirement]));
		const bindings = new Map(node.bindings.map((binding) => [binding.irPackageName.toWire(), binding]));
		for (const requirement of record.dependencies)
			if (!bindings.has(requirement.irPackageName.toWire())) violations.push({ pointer: `${node.sourcePointer}/bindings`, rule: "binding-mismatch" });

		for (const binding of node.bindings) {
			const requirement = requirements.get(binding.irPackageName.toWire());
			if (requirement === undefined) {
				violations.push({ pointer: `${binding.sourcePointer}/irPackageName`, rule: "binding-mismatch" });
				continue;
			}
			const targetNode = nodesByRelease.get(releaseKey(binding.target));
			if (targetNode === undefined) throw new Error("topology-validated binding had no target node");
			if (!binding.target.packagePath.equals(requirement.packagePath) || !targetNode.irPackageName.equals(requirement.irPackageName)) {
				violations.push({ pointer: `${binding.sourcePointer}/target`, rule: "binding-mismatch" });
				continue;
			}
			if (
				requirement.versionRange.minimumInclusive.compare(binding.target.version) > 0 ||
				binding.target.version.compare(requirement.versionRange.maximumExclusive) >= 0
			)
				violations.push({ pointer: `${binding.sourcePointer}/target`, rule: "requirement-mismatch" });
		}
	}
	return orderViolationsCanonical(violations);
}

/** Validates an old update or replay lock without applying any new exact update target. */
export function validateOldLock<T extends LockedResolutionInput>(input: T): OldLockValidationResult<T> {
	const topologyViolations = validateLockTopology(input);
	if (topologyViolations.length > 0) return { ok: false, result: { ok: false, diagnostic: { code: "invalid-lock", violations: topologyViolations } } };
	const metadata = selectedMetadata(input);
	if (!metadata.ok) return metadata;
	const metadataViolations = validateLockMetadata(input, metadata.records);
	if (metadataViolations.length > 0) return { ok: false, result: { ok: false, diagnostic: { code: "invalid-lock", violations: metadataViolations } } };
	const recordFor = (release: ReleaseId): ReleaseRecord => {
		const record = metadata.records.get(releaseKey(release));
		if (record === undefined) throw new Error("validated lock metadata lookup missed a selected release");
		return record;
	};
	return { ok: true, value: Object.freeze({ [validatedLock]: true as const, input, recordFor }) };
}

export function replayLockedGraph(input: ReplayResolutionInput): ResolutionResult {
	const validated = validateOldLock(input);
	if (!validated.ok) return validated.result;
	return { ok: true, graph: lockedGraphToWire(normalizeLock(validated.value.input.lock)) };
}
