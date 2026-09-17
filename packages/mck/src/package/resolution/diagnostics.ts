// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import {
	type ChangedPin,
	type InitialResolutionInput,
	type IRPackageName,
	type ReleaseId,
	type ReleaseRecord,
	type ResolutionResult,
	type ResolutionWitness,
	type ResolutionWitnessWire,
	releaseIdsEqual,
	releaseIdToWire,
	type UpdateResolutionInput,
} from "./model.ts";
import { compareCanonicalReleaseLists, compareReleaseIdsCanonical } from "./order.ts";
import { candidateSatisfiesRequirement, type FlatLibrarySearchInput, type FlatSelectionPolicy, indexCandidateUniverse, searchFlatLibrary } from "./search.ts";
import { unlockedOldPaths, updateSelectionPolicy } from "./update.ts";
import { releaseRecordToWire, requirementToWire } from "./wire.ts";

type ResolutionFailure = Extract<ResolutionResult, { readonly ok: false }>;

function compareOccurrence(left: readonly IRPackageName[], right: readonly IRPackageName[]): number {
	const sharedLength = Math.min(left.length, right.length);
	for (let index = 0; index < sharedLength; index += 1) {
		const comparison = (left[index] as IRPackageName).compare(right[index] as IRPackageName);
		if (comparison !== 0) return comparison;
	}
	return left.length - right.length;
}

function normalizeWitness(witness: ResolutionWitness): ResolutionWitness {
	return {
		nodes: [...witness.nodes]
			.map((node) => ({ ...node, bindings: [...node.bindings].sort((left, right) => left.irPackageName.compare(right.irPackageName)) }))
			.sort((left, right) => compareOccurrence(left.occurrence, right.occurrence)),
	};
}

function compareBindings(left: ResolutionWitness["nodes"][number]["bindings"], right: ResolutionWitness["nodes"][number]["bindings"]): number {
	const sharedLength = Math.min(left.length, right.length);
	for (let index = 0; index < sharedLength; index += 1) {
		const leftBinding = left[index] as (typeof left)[number];
		const rightBinding = right[index] as (typeof right)[number];
		const name = leftBinding.irPackageName.compare(rightBinding.irPackageName);
		if (name !== 0) return name;
		const target = compareOccurrence(leftBinding.targetOccurrence, rightBinding.targetOccurrence);
		if (target !== 0) return target;
	}
	return left.length - right.length;
}

function compareWitnesses(left: ResolutionWitness, right: ResolutionWitness): number {
	const releaseList = compareCanonicalReleaseLists(
		left.nodes.map((node) => node.release),
		right.nodes.map((node) => node.release),
	);
	if (releaseList !== 0) return releaseList;
	const normalizedLeft = normalizeWitness(left);
	const normalizedRight = normalizeWitness(right);
	const sharedLength = Math.min(normalizedLeft.nodes.length, normalizedRight.nodes.length);
	for (let index = 0; index < sharedLength; index += 1) {
		const leftNode = normalizedLeft.nodes[index] as ResolutionWitness["nodes"][number];
		const rightNode = normalizedRight.nodes[index] as ResolutionWitness["nodes"][number];
		const occurrence = compareOccurrence(leftNode.occurrence, rightNode.occurrence);
		if (occurrence !== 0) return occurrence;
		const release = compareReleaseIdsCanonical(leftNode.release, rightNode.release);
		if (release !== 0) return release;
		const bindings = compareBindings(leftNode.bindings, rightNode.bindings);
		if (bindings !== 0) return bindings;
	}
	return normalizedLeft.nodes.length - normalizedRight.nodes.length;
}

function flatWitness(root: ReleaseRecord, selection: readonly ReleaseRecord[]): ResolutionWitness {
	const byPath = new Map(selection.map((record) => [record.release.packagePath.toWire(), record]));
	const nodes: ResolutionWitness["nodes"][number][] = [];
	const unfold = (record: ReleaseRecord, occurrence: readonly IRPackageName[]): void => {
		nodes.push({
			occurrence,
			release: record.release,
			bindings: record.dependencies.map((dependency) => ({
				irPackageName: dependency.irPackageName,
				targetOccurrence: [...occurrence, dependency.irPackageName],
			})),
		});
		for (const dependency of record.dependencies) {
			const target = byPath.get(dependency.packagePath.toWire());
			if (target === undefined) throw new Error("complete flat selection omitted a witness occurrence target");
			unfold(target, [...occurrence, dependency.irPackageName]);
		}
	};
	unfold(root, []);
	return normalizeWitness({ nodes });
}

function selectionForGraph(
	input: FlatLibrarySearchInput,
	graph: Extract<ReturnType<typeof searchFlatLibrary>, { readonly kind: "selection" }>["graph"],
): readonly ReleaseRecord[] {
	const records = [input.root, ...input.catalogs.flatMap((catalog) => catalog.releases)];
	const byIdentity = new Map(records.map((record) => [`${record.release.packagePath.toWire()}@${record.release.version.toWire()}`, record]));
	return graph.nodes.map((node) => {
		const record = byIdentity.get(`${node.release.packagePath}@${node.release.version}`);
		if (record === undefined) throw new Error("selected diagnostic graph had no candidate metadata");
		return record;
	});
}

function diagnosticFlatComparator(root: ReleaseRecord): FlatSelectionPolicy["compareSelections"] {
	return (left, right) => compareWitnesses(flatWitness(root, left), flatWitness(root, right));
}

interface PendingOccurrence {
	readonly occurrence: readonly IRPackageName[];
	readonly requirement: ReleaseRecord["dependencies"][number];
	readonly ancestors: readonly ReleaseId[];
}

function abstractCoexistenceWitness(input: InitialResolutionInput | UpdateResolutionInput): ResolutionWitness | undefined {
	const universe = indexCandidateUniverse(input);
	if (universe.missing.length > 0) throw new Error("diagnostic occurrence search received incomplete candidate input");
	const rootPath = input.root.release.packagePath.toWire();
	const exactTargets = new Map(
		input.mode === "update"
			? input.targets.filter((target) => target.kind === "exact").map((target) => [target.packagePath.toWire(), target.version] as const)
			: [],
	);
	const targetPaths = input.mode === "update" ? input.targets.map((target) => target.packagePath.toWire()) : [];
	const candidatesFor = (path: string): readonly ReleaseRecord[] => {
		const catalogCandidates = universe.byPath.get(path) ?? [];
		return path === rootPath
			? [input.root, ...catalogCandidates].sort((left, right) => compareReleaseIdsCanonical(left.release, right.release))
			: catalogCandidates;
	};
	const rootNode: ResolutionWitness["nodes"][number] = {
		occurrence: [],
		release: input.root.release,
		bindings: input.root.dependencies.map((dependency) => ({ irPackageName: dependency.irPackageName, targetOccurrence: [dependency.irPackageName] })),
	};
	let best: ResolutionWitness | undefined;

	const visit = (nodes: readonly ResolutionWitness["nodes"][number][], pending: readonly PendingOccurrence[]): void => {
		if (pending.length === 0) {
			const selectedPaths = new Set(nodes.map((node) => node.release.packagePath.toWire()));
			if (!targetPaths.every((path) => selectedPaths.has(path))) return;
			const witness = normalizeWitness({ nodes });
			if (best === undefined || compareWitnesses(witness, best) < 0) best = witness;
			return;
		}
		const ordered = [...pending].sort((left, right) => compareOccurrence(left.occurrence, right.occurrence));
		const current = ordered[0] as PendingOccurrence;
		const remaining = ordered.slice(1);
		for (const candidate of candidatesFor(current.requirement.packagePath.toWire())) {
			if (!candidateSatisfiesRequirement(candidate, current.requirement)) continue;
			const exact = exactTargets.get(candidate.release.packagePath.toWire());
			if (exact !== undefined && candidate.release.version.compare(exact) !== 0) continue;
			if (current.ancestors.some((ancestor) => releaseIdsEqual(ancestor, candidate.release))) continue;
			const bindings = candidate.dependencies.map((dependency) => ({
				irPackageName: dependency.irPackageName,
				targetOccurrence: [...current.occurrence, dependency.irPackageName],
			}));
			const descendants = candidate.dependencies.map((dependency) => ({
				occurrence: [...current.occurrence, dependency.irPackageName],
				requirement: dependency,
				ancestors: [...current.ancestors, candidate.release],
			}));
			visit([...nodes, { occurrence: current.occurrence, release: candidate.release, bindings }], [...remaining, ...descendants]);
		}
	};

	visit(
		[rootNode],
		input.root.dependencies.map((dependency) => ({ occurrence: [dependency.irPackageName], requirement: dependency, ancestors: [input.root.release] })),
	);
	return best;
}

function changedPins(input: UpdateResolutionInput, witness: ResolutionWitness): readonly ChangedPin[] {
	const unlocked = unlockedOldPaths(input);
	const selectedByPath = new Map<string, ResolutionWitness["nodes"][number][]>();
	for (const occurrence of witness.nodes) {
		const path = occurrence.release.packagePath.toWire();
		const selected = selectedByPath.get(path);
		if (selected === undefined) selectedByPath.set(path, [occurrence]);
		else selected.push(occurrence);
	}
	const changed: ChangedPin[] = [];
	for (const node of input.lock.nodes) {
		const path = node.release.packagePath.toWire();
		if (unlocked.has(path)) continue;
		const occurrences = selectedByPath.get(path) ?? [];
		if (occurrences.length === 0) {
			changed.push({ kind: "removed", previous: node.release });
			continue;
		}
		const differing = new Map<string, ReleaseId>();
		for (const occurrence of occurrences) {
			if (!releaseIdsEqual(node.release, occurrence.release)) differing.set(occurrence.release.version.toWire(), occurrence.release);
		}
		for (const selected of differing.values()) changed.push({ kind: "changed", previous: node.release, selected });
	}
	return changed.sort((left, right) => {
		const path = left.previous.packagePath.compare(right.previous.packagePath);
		if (path !== 0) return path;
		if (left.kind === "removed" || right.kind === "removed") return left.kind === right.kind ? 0 : left.kind === "removed" ? 1 : -1;
		const version = left.selected.version.compare(right.selected.version);
		return version === 0 ? 0 : version > 0 ? -1 : 1;
	});
}

function witnessToWire(witness: ResolutionWitness): ResolutionWitnessWire {
	return {
		nodes: normalizeWitness(witness).nodes.map((node) => ({
			occurrence: node.occurrence.map((segment) => segment.toWire()),
			release: releaseIdToWire(node.release),
			bindings: node.bindings.map((binding) => ({
				irPackageName: binding.irPackageName.toWire(),
				targetOccurrence: binding.targetOccurrence.map((segment) => segment.toWire()),
			})),
		})),
	};
}

function changedPinsToWire(changed: readonly ChangedPin[]) {
	return changed.map((item) =>
		item.kind === "changed"
			? { kind: item.kind, previous: releaseIdToWire(item.previous), selected: releaseIdToWire(item.selected) }
			: { kind: item.kind, previous: releaseIdToWire(item.previous) },
	);
}

function normalizedUnsatisfiable(input: InitialResolutionInput | UpdateResolutionInput): ResolutionFailure {
	const universe = indexCandidateUniverse(input);
	if (universe.missing.length > 0) throw new Error("unsatisfiable projection received incomplete candidate input");
	const normalizeRecord = (record: ReleaseRecord) => ({
		...releaseRecordToWire(record),
		dependencies: [...record.dependencies].sort((left, right) => left.irPackageName.compare(right.irPackageName)).map(requirementToWire),
	});
	return {
		ok: false,
		diagnostic: {
			code: "unsatisfiable-requirements",
			root: normalizeRecord(input.root),
			catalogs: universe.reachableCatalogs.map((candidateCatalog) => ({
				packagePath: candidateCatalog.packagePath.toWire(),
				releases: [...candidateCatalog.releases].sort((left, right) => compareReleaseIdsCanonical(left.release, right.release)).map(normalizeRecord),
			})),
			targets:
				input.mode === "initial"
					? []
					: [...input.targets]
							.sort((left, right) => left.packagePath.compare(right.packagePath))
							.map((target) =>
								target.kind === "exact"
									? { kind: target.kind, packagePath: target.packagePath.toWire(), version: target.version.toWire() }
									: { kind: target.kind, packagePath: target.packagePath.toWire() },
							),
		},
	};
}

/** Diagnoses a failed supported search after validation and completeness have succeeded. */
export function diagnoseResolutionFailure(input: InitialResolutionInput | UpdateResolutionInput): ResolutionFailure {
	if (input.mode === "update") {
		const relaxed = searchFlatLibrary(
			input,
			updateSelectionPolicy(input, { kind: "diagnostic-witness", compareSelections: diagnosticFlatComparator(input.root) }),
		);
		if (relaxed.kind === "incomplete-input") throw new Error("pin-relaxed diagnostic search received incomplete candidate input");
		if (relaxed.kind === "selection") {
			const witness = flatWitness(input.root, selectionForGraph(input, relaxed.graph));
			return {
				ok: false,
				diagnostic: { code: "update-scope-conflict", changedPins: changedPinsToWire(changedPins(input, witness)), witness: witnessToWire(witness) },
			};
		}
	}

	const coexistence = abstractCoexistenceWitness(input);
	if (coexistence !== undefined)
		return {
			ok: false,
			diagnostic: {
				code: "unsupported-capability",
				requiredCapabilities: ["graph-aware-coexistence"],
				changedPins: input.mode === "initial" ? [] : changedPinsToWire(changedPins(input, coexistence)),
				witness: witnessToWire(coexistence),
			},
		};
	return normalizedUnsatisfiable(input);
}
