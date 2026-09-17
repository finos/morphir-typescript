// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import {
	type Catalog,
	type InitialResolutionInput,
	type LockedGraphWire,
	type MissingResolutionItem,
	type PackagePath,
	type ReleaseId,
	type ReleaseRecord,
	type Requirement,
	releaseIdToWire,
} from "./model.ts";
import { compareCanonicalReleaseLists, compareReleaseIdsCanonical, orderReleaseIdsForOutput } from "./order.ts";

export type InitialSearchResult =
	| { readonly kind: "selection"; readonly graph: LockedGraphWire }
	| { readonly kind: "incomplete-input"; readonly missing: readonly MissingResolutionItem[] }
	| { readonly kind: "no-selection" };

/** A coherent selection boundary and ranking for the shared bounded flat-graph search. */
export interface FlatSelectionPolicy {
	readonly allowsCandidate: (candidate: ReleaseRecord) => boolean;
	readonly allowsSelection: (selection: readonly ReleaseRecord[]) => boolean;
	/** Negative means the left complete selection ranks before the right. */
	readonly compareSelections: (left: readonly ReleaseRecord[], right: readonly ReleaseRecord[]) => number;
}

export interface FlatLibrarySearchInput {
	readonly root: ReleaseRecord;
	readonly catalogs: readonly Catalog[];
}

export interface CandidateUniverse {
	readonly byPath: ReadonlyMap<string, readonly ReleaseRecord[]>;
	readonly missing: readonly MissingResolutionItem[];
	readonly reachableCatalogs: readonly Catalog[];
}

interface PendingRequirement {
	readonly consumer: ReleaseId;
	readonly requirement: Requirement;
}

interface SelectedEdge {
	readonly consumerKey: string;
	readonly targetKey: string;
}

interface SearchState {
	readonly assignments: ReadonlyMap<string, ReleaseRecord>;
	readonly irAssignments: ReadonlyMap<string, string>;
	readonly pending: readonly PendingRequirement[];
	readonly edges: readonly SelectedEdge[];
}

function releaseKey(release: ReleaseId): string {
	return `${release.packagePath.toWire()}@${release.version.toWire()}`;
}

function requirementsFor(record: ReleaseRecord): readonly PendingRequirement[] {
	return record.dependencies.map((requirement) => ({ consumer: record.release, requirement }));
}

/** Indexes the complete candidate universe reachable from the fixed root's requirements. */
export function indexCandidateUniverse(input: FlatLibrarySearchInput): CandidateUniverse {
	const byPath = new Map(
		input.catalogs.map((catalog) => [
			catalog.packagePath.toWire(),
			Object.freeze([...catalog.releases].sort((left, right) => compareReleaseIdsCanonical(left.release, right.release))),
		]),
	);
	const rootPath = input.root.release.packagePath.toWire();
	const visited = new Set<string>();
	const catalogsByPath = new Map(input.catalogs.map((catalog) => [catalog.packagePath.toWire(), catalog]));
	const missing = new Map<string, PackagePath>();
	const pending = input.root.dependencies.map((dependency) => dependency.packagePath);

	while (pending.length > 0) {
		const packagePath = pending.pop() as PackagePath;
		const path = packagePath.toWire();
		if (visited.has(path)) continue;
		visited.add(path);
		const releases = byPath.get(path);
		if (releases === undefined) {
			if (path !== rootPath) missing.set(path, packagePath);
			continue;
		}
		for (const release of releases) for (const dependency of release.dependencies) pending.push(dependency.packagePath);
	}

	return {
		byPath,
		missing: Object.freeze(
			[...missing.values()].sort((left, right) => left.compare(right)).map((packagePath) => Object.freeze({ kind: "catalog" as const, packagePath })),
		),
		reachableCatalogs: Object.freeze(
			[...visited]
				.map((path) => catalogsByPath.get(path))
				.filter((catalog): catalog is Catalog => catalog !== undefined)
				.sort((left, right) => left.packagePath.compare(right.packagePath)),
		),
	};
}

function comparePending(left: PendingRequirement, right: PendingRequirement): number {
	const path = left.requirement.packagePath.compare(right.requirement.packagePath);
	if (path !== 0) return path;
	const irName = left.requirement.irPackageName.compare(right.requirement.irPackageName);
	if (irName !== 0) return irName;
	const minimum = left.requirement.versionRange.minimumInclusive.compare(right.requirement.versionRange.minimumInclusive);
	if (minimum !== 0) return minimum;
	const maximum = left.requirement.versionRange.maximumExclusive.compare(right.requirement.versionRange.maximumExclusive);
	if (maximum !== 0) return maximum;
	return compareReleaseIdsCanonical(left.consumer, right.consumer);
}

export function candidateSatisfiesRequirement(record: ReleaseRecord, requirement: Requirement): boolean {
	return (
		record.irPackageName.equals(requirement.irPackageName) &&
		requirement.versionRange.minimumInclusive.compare(record.release.version) <= 0 &&
		record.release.version.compare(requirement.versionRange.maximumExclusive) < 0
	);
}

function introducesCycle(edges: readonly SelectedEdge[], consumerKey: string, targetKey: string): boolean {
	if (consumerKey === targetKey) return true;
	const adjacent = new Map<string, string[]>();
	for (const edge of edges) {
		const targets = adjacent.get(edge.consumerKey);
		if (targets === undefined) adjacent.set(edge.consumerKey, [edge.targetKey]);
		else targets.push(edge.targetKey);
	}
	const pending = [targetKey];
	const visited = new Set<string>();
	while (pending.length > 0) {
		const current = pending.pop() as string;
		if (current === consumerKey) return true;
		if (visited.has(current)) continue;
		visited.add(current);
		for (const next of adjacent.get(current) ?? []) pending.push(next);
	}
	return false;
}

function addSatisfiedEdge(state: SearchState, item: PendingRequirement, target: ReleaseRecord): SearchState | undefined {
	if (!candidateSatisfiesRequirement(target, item.requirement)) return undefined;
	const targetKey = releaseKey(target.release);
	const associatedRelease = state.irAssignments.get(item.requirement.irPackageName.toWire());
	if (associatedRelease !== targetKey) return undefined;
	const consumerKey = releaseKey(item.consumer);
	if (introducesCycle(state.edges, consumerKey, targetKey)) return undefined;
	return { ...state, edges: Object.freeze([...state.edges, Object.freeze({ consumerKey, targetKey })]) };
}

function withCandidate(state: SearchState, item: PendingRequirement, candidate: ReleaseRecord): SearchState | undefined {
	if (!candidateSatisfiesRequirement(candidate, item.requirement)) return undefined;
	const path = candidate.release.packagePath.toWire();
	const candidateKey = releaseKey(candidate.release);
	if (state.irAssignments.has(candidate.irPackageName.toWire())) return undefined;
	const consumerKey = releaseKey(item.consumer);
	if (introducesCycle(state.edges, consumerKey, candidateKey)) return undefined;
	return {
		assignments: new Map(state.assignments).set(path, candidate),
		irAssignments: new Map(state.irAssignments).set(candidate.irPackageName.toWire(), candidateKey),
		pending: Object.freeze([...state.pending, ...requirementsFor(candidate)]),
		edges: Object.freeze([...state.edges, Object.freeze({ consumerKey, targetKey: candidateKey })]),
	};
}

function graphFromAssignments(input: FlatLibrarySearchInput, assignments: ReadonlyMap<string, ReleaseRecord>): LockedGraphWire {
	const recordsByKey = new Map([...assignments.values()].map((record) => [releaseKey(record.release), record]));
	const orderedReleases = orderReleaseIdsForOutput(
		input.root.release,
		[...assignments.values()].map((record) => record.release),
	);
	return {
		root: releaseIdToWire(input.root.release),
		nodes: orderedReleases.map((release) => {
			const record = recordsByKey.get(releaseKey(release));
			if (record === undefined) throw new Error("selected release metadata was absent while projecting a graph");
			return {
				release: releaseIdToWire(record.release),
				irPackageName: record.irPackageName.toWire(),
				manifestDigest: record.manifestDigest.toWire(),
				contentDigest: record.contentDigest.toWire(),
				bindings: [...record.dependencies]
					.sort((left, right) => left.irPackageName.compare(right.irPackageName))
					.map((requirement) => {
						const target = assignments.get(requirement.packagePath.toWire());
						if (target === undefined) throw new Error("complete selection omitted a requirement target");
						return { irPackageName: requirement.irPackageName.toWire(), target: releaseIdToWire(target.release) };
					}),
			};
		}),
	};
}

/** Exhaustively searches a complete bounded flat-library candidate universe. */
export function searchFlatLibrary(input: FlatLibrarySearchInput, policy: FlatSelectionPolicy): InitialSearchResult {
	const index = indexCandidateUniverse(input);
	if (index.missing.length > 0) return { kind: "incomplete-input", missing: index.missing };

	const rootPath = input.root.release.packagePath.toWire();
	const rootKey = releaseKey(input.root.release);
	let best: ReadonlyMap<string, ReleaseRecord> | undefined;

	const visit = (state: SearchState): void => {
		if (state.pending.length === 0) {
			const selection = [...state.assignments.values()];
			if (!policy.allowsSelection(selection)) return;
			if (best === undefined || policy.compareSelections(selection, [...best.values()]) < 0) best = state.assignments;
			return;
		}

		const ordered = [...state.pending].sort(comparePending);
		const item = ordered[0] as PendingRequirement;
		const remaining = Object.freeze(ordered.slice(1));
		const path = item.requirement.packagePath.toWire();
		const assigned = state.assignments.get(path);
		if (assigned !== undefined) {
			const next = addSatisfiedEdge({ ...state, pending: remaining }, item, assigned);
			if (next !== undefined) visit(next);
			return;
		}

		for (const candidate of index.byPath.get(path) ?? []) {
			if (!policy.allowsCandidate(candidate)) continue;
			const next = withCandidate({ ...state, pending: remaining }, item, candidate);
			if (next !== undefined) visit(next);
		}
	};

	visit({
		assignments: new Map([[rootPath, input.root]]),
		irAssignments: new Map([[input.root.irPackageName.toWire(), rootKey]]),
		pending: Object.freeze(requirementsFor(input.root)),
		edges: Object.freeze([]),
	});

	return best === undefined ? { kind: "no-selection" } : { kind: "selection", graph: graphFromAssignments(input, best) };
}

const initialSelectionPolicy: FlatSelectionPolicy = {
	allowsCandidate: () => true,
	allowsSelection: () => true,
	compareSelections: (left, right) =>
		compareCanonicalReleaseLists(
			left.map((record) => record.release),
			right.map((record) => record.release),
		),
};

/** Exhaustively searches the complete bounded initial candidate universe. */
export function searchInitialLibrary(input: InitialResolutionInput): InitialSearchResult {
	return searchFlatLibrary(input, initialSelectionPolicy);
}
