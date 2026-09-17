// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { type Binding, type LockedNode, type ReleaseId, releaseIdsEqual, type Violation } from "./model.ts";

function compareAscii(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function compareUnicodeScalars(left: string, right: string): number {
	const leftScalars = left[Symbol.iterator]();
	const rightScalars = right[Symbol.iterator]();
	for (;;) {
		const leftScalar = leftScalars.next();
		const rightScalar = rightScalars.next();
		if (leftScalar.done || rightScalar.done) return leftScalar.done === rightScalar.done ? 0 : leftScalar.done ? -1 : 1;
		const leftCodePoint = leftScalar.value.codePointAt(0) as number;
		const rightCodePoint = rightScalar.value.codePointAt(0) as number;
		if (leftCodePoint !== rightCodePoint) return leftCodePoint < rightCodePoint ? -1 : 1;
	}
}

export function orderViolationsCanonical(violations: readonly Violation[]): readonly Violation[] {
	const unique = new Map(violations.map((violation) => [`${violation.pointer}\u0000${violation.rule}`, violation]));
	return Object.freeze([...unique.values()].sort((left, right) => compareUnicodeScalars(left.pointer, right.pointer) || compareAscii(left.rule, right.rule)));
}

export function compareReleaseIdsCanonical(left: ReleaseId, right: ReleaseId): number {
	const pathComparison = left.packagePath.compare(right.packagePath);
	if (pathComparison !== 0) return pathComparison;
	const versionComparison = left.version.compare(right.version);
	return versionComparison === 0 ? 0 : versionComparison < 0 ? 1 : -1;
}

export function compareCanonicalReleaseLists(left: readonly ReleaseId[], right: readonly ReleaseId[]): number {
	const orderedLeft = [...left].sort(compareReleaseIdsCanonical);
	const orderedRight = [...right].sort(compareReleaseIdsCanonical);
	const sharedLength = Math.min(orderedLeft.length, orderedRight.length);
	for (let index = 0; index < sharedLength; index += 1) {
		const comparison = compareReleaseIdsCanonical(orderedLeft[index] as ReleaseId, orderedRight[index] as ReleaseId);
		if (comparison !== 0) return comparison;
	}
	return orderedLeft.length < orderedRight.length ? -1 : orderedLeft.length > orderedRight.length ? 1 : 0;
}

export function orderReleaseIdsForOutput(root: ReleaseId, releases: readonly ReleaseId[]): readonly ReleaseId[] {
	return [root, ...releases.filter((release) => !releaseIdsEqual(release, root)).sort(compareReleaseIdsCanonical)];
}

export function orderLockedNodesForOutput(root: ReleaseId, nodes: readonly LockedNode[]): readonly LockedNode[] {
	const rootNode = nodes.find((node) => releaseIdsEqual(node.release, root));
	const remaining = nodes.filter((node) => !releaseIdsEqual(node.release, root)).sort((left, right) => compareReleaseIdsCanonical(left.release, right.release));
	return rootNode === undefined ? remaining : [rootNode, ...remaining];
}

export function orderBindingsForOutput(bindings: readonly Binding[]): readonly Binding[] {
	return [...bindings].sort((left, right) => left.irPackageName.compare(right.irPackageName));
}
