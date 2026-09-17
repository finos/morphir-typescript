// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { type ReleaseId, type ReleaseRecord, type ResolutionResult, releaseIdsEqual, type UpdateResolutionInput, type Violation } from "./model.ts";
import { compareCanonicalReleaseLists, orderViolationsCanonical } from "./order.ts";
import { validateOldLock } from "./replay.ts";
import { type FlatSelectionPolicy, type InitialSearchResult, searchFlatLibrary } from "./search.ts";

type ResolutionFailure = Extract<ResolutionResult, { readonly ok: false }>;

export type UpdateLockedGraphResult = InitialSearchResult | { readonly kind: "rejection"; readonly result: ResolutionFailure };

function validateTargetMembership(input: UpdateResolutionInput): readonly Violation[] {
	const oldPaths = new Set(input.lock.nodes.map((node) => node.release.packagePath.toWire()));
	const rootPath = input.root.release.packagePath.toWire();
	return orderViolationsCanonical(
		input.targets
			.filter((target) => target.packagePath.toWire() === rootPath || !oldPaths.has(target.packagePath.toWire()))
			.map((target) => ({ pointer: `${target.sourcePointer}/packagePath`, rule: "identity-mismatch" as const })),
	);
}

/** Old target closure whose releases are permitted to change during a supported update. */
export function unlockedOldPaths(input: UpdateResolutionInput): ReadonlySet<string> {
	const nodesByPath = new Map(input.lock.nodes.map((node) => [node.release.packagePath.toWire(), node]));
	const unlocked = new Set<string>();
	const pending = input.targets.map((target) => target.packagePath.toWire());
	while (pending.length > 0) {
		const path = pending.pop() as string;
		if (unlocked.has(path)) continue;
		unlocked.add(path);
		const node = nodesByPath.get(path);
		if (node === undefined) throw new Error("membership-validated update target was absent from the old lock");
		for (const binding of node.bindings) pending.push(binding.target.packagePath.toWire());
	}
	return unlocked;
}

function countChangedOldNonTargets(selectionByPath: ReadonlyMap<string, ReleaseRecord>, oldNonTargets: ReadonlyMap<string, ReleaseId>): number {
	let changed = 0;
	for (const [path, previous] of oldNonTargets) {
		const selected = selectionByPath.get(path);
		if (selected === undefined || !releaseIdsEqual(previous, selected.release)) changed += 1;
	}
	return changed;
}

export type UpdateSelectionPurpose =
	| { readonly kind: "supported-update" }
	| {
			readonly kind: "diagnostic-witness";
			readonly compareSelections: FlatSelectionPolicy["compareSelections"];
	  };

/** Builds either the supported scoped-update policy or the pin-relaxed diagnostic policy. */
export function updateSelectionPolicy(input: UpdateResolutionInput, purpose: UpdateSelectionPurpose): FlatSelectionPolicy {
	const unlocked = unlockedOldPaths(input);
	const targetPaths = [...input.targets].map((target) => target.packagePath.toWire()).sort();
	const targetPathSet = new Set(targetPaths);
	const exactTargets = new Map(
		input.targets.filter((target) => target.kind === "exact").map((target) => [target.packagePath.toWire(), target.version] as const),
	);
	const pinnedVersions = new Map(
		input.lock.nodes
			.filter((node) => !unlocked.has(node.release.packagePath.toWire()))
			.map((node) => [node.release.packagePath.toWire(), node.release.version] as const),
	);
	const rootPath = input.root.release.packagePath.toWire();
	const oldNonTargets = new Map(
		input.lock.nodes
			.filter((node) => node.release.packagePath.toWire() !== rootPath && !targetPathSet.has(node.release.packagePath.toWire()))
			.map((node) => [node.release.packagePath.toWire(), node.release] as const),
	);
	const byPath = (selection: readonly ReleaseRecord[]) => new Map(selection.map((record) => [record.release.packagePath.toWire(), record]));

	return {
		allowsCandidate: (candidate) => {
			const path = candidate.release.packagePath.toWire();
			const exact = exactTargets.get(path);
			if (exact !== undefined && candidate.release.version.compare(exact) !== 0) return false;
			if (purpose.kind === "diagnostic-witness") return true;
			const pinned = pinnedVersions.get(path);
			return pinned === undefined || candidate.release.version.compare(pinned) === 0;
		},
		allowsSelection: (selection) => {
			const selectedPaths = new Set(selection.map((record) => record.release.packagePath.toWire()));
			return targetPaths.every((path) => selectedPaths.has(path));
		},
		compareSelections: (left, right) => {
			if (purpose.kind === "diagnostic-witness") return purpose.compareSelections(left, right);
			const leftByPath = byPath(left);
			const rightByPath = byPath(right);
			for (const path of targetPaths) {
				const leftTarget = leftByPath.get(path);
				const rightTarget = rightByPath.get(path);
				if (leftTarget === undefined || rightTarget === undefined) throw new Error("accepted update selection omitted a target");
				const version = leftTarget.release.version.compare(rightTarget.release.version);
				if (version !== 0) return version > 0 ? -1 : 1;
			}
			const leftChanges = countChangedOldNonTargets(leftByPath, oldNonTargets);
			const rightChanges = countChangedOldNonTargets(rightByPath, oldNonTargets);
			if (leftChanges !== rightChanges) return leftChanges - rightChanges;
			return compareCanonicalReleaseLists(
				left.map((record) => record.release),
				right.map((record) => record.release),
			);
		},
	};
}

/** Validates phases 6 through 10 and searches the supported scoped update boundary. */
export function updateLockedGraph(input: UpdateResolutionInput): UpdateLockedGraphResult {
	const oldLock = validateOldLock(input);
	if (!oldLock.ok) return { kind: "rejection", result: oldLock.result };
	const membershipViolations = validateTargetMembership(oldLock.value.input);
	if (membershipViolations.length > 0)
		return {
			kind: "rejection",
			result: { ok: false, diagnostic: { code: "invalid-input", violations: membershipViolations } },
		};
	return searchFlatLibrary(oldLock.value.input, updateSelectionPolicy(oldLock.value.input, { kind: "supported-update" }));
}
