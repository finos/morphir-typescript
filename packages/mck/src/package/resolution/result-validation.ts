// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import type { LockedGraphWire, ReleaseIdWire, ResolutionWitnessWire } from "./model.ts";

function releaseKey(value: ReleaseIdWire): string {
	return `${value.packagePath}\0${value.version}`;
}

function occurrenceKey(value: readonly string[]): string {
	return JSON.stringify(value);
}

function occurrencesEqual(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((part, index) => part === right[index]);
}

export function validateLockedGraph(graph: LockedGraphWire): void {
	if (graph.nodes.length === 0) throw new Error("resolution graph must contain nodes");
	const identities = new Map<string, LockedGraphWire["nodes"][number]>();
	const packagePaths = new Set<string>();
	const irNames = new Set<string>();
	for (const node of graph.nodes) {
		const identity = releaseKey(node.release);
		if (identities.has(identity)) throw new Error(`duplicate resolution graph release ${identity}`);
		if (packagePaths.has(node.release.packagePath)) throw new Error(`duplicate resolution graph package path ${node.release.packagePath}`);
		if (irNames.has(node.irPackageName)) throw new Error(`duplicate resolution graph IR package name ${node.irPackageName}`);
		identities.set(identity, node);
		packagePaths.add(node.release.packagePath);
		irNames.add(node.irPackageName);
		const bindingNames = new Set<string>();
		for (const binding of node.bindings) {
			if (bindingNames.has(binding.irPackageName)) throw new Error(`duplicate resolution graph binding ${binding.irPackageName}`);
			bindingNames.add(binding.irPackageName);
		}
	}

	const rootKey = releaseKey(graph.root);
	if (!identities.has(rootKey)) throw new Error("resolution graph root is missing");
	for (const node of graph.nodes) {
		for (const binding of node.bindings) {
			const target = identities.get(releaseKey(binding.target));
			if (target === undefined) throw new Error("resolution graph has a dangling binding");
			if (binding.irPackageName !== target.irPackageName) throw new Error("resolution graph binding name does not match its target node");
		}
	}

	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (identity: string): void => {
		if (visiting.has(identity)) throw new Error("resolution graph contains a cycle");
		if (visited.has(identity)) return;
		visiting.add(identity);
		for (const binding of (identities.get(identity) as LockedGraphWire["nodes"][number]).bindings) visit(releaseKey(binding.target));
		visiting.delete(identity);
		visited.add(identity);
	};
	visit(rootKey);
	if (visited.size !== graph.nodes.length) throw new Error("resolution graph contains unreachable nodes");
}

export function validateResolutionWitness(witness: ResolutionWitnessWire): void {
	if (witness.nodes.length === 0) throw new Error("resolution witness must contain nodes");
	const nodesByOccurrence = new Map<string, ResolutionWitnessWire["nodes"][number]>();
	for (const node of witness.nodes) {
		const key = occurrenceKey(node.occurrence);
		if (nodesByOccurrence.has(key)) throw new Error(`duplicate resolution witness occurrence ${key}`);
		nodesByOccurrence.set(key, node);
		const bindingNames = new Set<string>();
		for (const binding of node.bindings) {
			if (bindingNames.has(binding.irPackageName)) throw new Error(`duplicate resolution witness binding ${binding.irPackageName}`);
			bindingNames.add(binding.irPackageName);
		}
	}

	const rootKey = occurrenceKey([]);
	if (!nodesByOccurrence.has(rootKey)) throw new Error("resolution witness root occurrence is missing");
	for (const node of witness.nodes) {
		for (const binding of node.bindings) {
			const expected = [...node.occurrence, binding.irPackageName];
			if (!occurrencesEqual(binding.targetOccurrence, expected)) throw new Error("resolution witness binding has a noncanonical target occurrence");
			if (!nodesByOccurrence.has(occurrenceKey(binding.targetOccurrence))) throw new Error("resolution witness has a dangling binding");
		}
	}

	const visited = new Set<string>();
	const visit = (key: string, ancestorReleases: ReadonlySet<string>): void => {
		const node = nodesByOccurrence.get(key) as ResolutionWitnessWire["nodes"][number];
		const identity = releaseKey(node.release);
		if (ancestorReleases.has(identity)) throw new Error("resolution witness repeats a release on an ancestor path");
		if (visited.has(key)) return;
		visited.add(key);
		const nextAncestors = new Set(ancestorReleases);
		nextAncestors.add(identity);
		for (const binding of node.bindings) visit(occurrenceKey(binding.targetOccurrence), nextAncestors);
	};
	visit(rootKey, new Set());
	if (visited.size !== witness.nodes.length) throw new Error("resolution witness contains unreachable occurrences");
}
