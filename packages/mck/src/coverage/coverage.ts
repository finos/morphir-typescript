// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The coverage rule (see the kit README's coverage description and
// `mck coverage`): every variant the v4 reader recognizes, and
// every member spelling it accepts, has at least one kit case. A JSON fence
// covers a variant when the variant's name is an object key anywhere in it,
// and covers a member spelling when that member is a key of the object under
// the variant's key. A pending case covers what its title or prose names.
//
// "Anywhere in it" is a precision limit, not a design goal: a record field
// (or any other member) that happens to be spelled the same as a variant tag
// — "Record": { "fields": { "Tuple": ... } } — would count as covering
// Tuple even though it names a field, not the Tuple variant. The kit's own
// naming conventions make a real collision unlikely; nothing here detects
// one.
import type { VocabularyEntry } from "../../../ir/src/versions/v4/vocabulary.ts";
import type { KitCase } from "../kit/case.ts";
import type { Kit } from "../kit/load.ts";

export interface CoverageGap {
	readonly node: string;
	readonly variant: string;
	readonly member?: string;
}

type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };

function parse(body: string): Json | undefined {
	try {
		return JSON.parse(body) as Json;
	} catch {
		return undefined;
	}
}

function walk(v: Json, visit: (key: string, payload: Json) => void): void {
	if (Array.isArray(v)) for (const x of v) walk(x, visit);
	else if (v !== null && typeof v === "object") {
		for (const [k, x] of Object.entries(v)) {
			visit(k, x);
			walk(x, visit);
		}
	}
}

function jsonFences(c: KitCase): readonly Json[] {
	return c.fences
		.filter((f) => f.info.language === "json")
		.map((f) => parse(f.body))
		.filter((v): v is Json => v !== undefined);
}

export function coverageGaps(kit: Kit, vocabulary: readonly VocabularyEntry[], resolveNode: (name: string) => string | null): readonly CoverageGap[] {
	const byNode = new Map<string, KitCase[]>();
	const activeCases: KitCase[] = [];
	for (const c of kit.cases) {
		const node = c.node === null ? null : resolveNode(c.node);
		if (node === null) continue;
		byNode.set(node, [...(byNode.get(node) ?? []), c]);
		if (c.status !== "pending") activeCases.push(c);
	}

	// A variant tag is ambiguous when more than one node kind in the manifest
	// uses it (e.g. "Record" is both a Type and a Value variant). An
	// unambiguous tag can only ever mean one thing, so any active case's JSON
	// fence may cover it wherever the tag turns up — a kit case tagged
	// node=AccessControlledTypeDefinition legitimately nests a
	// TypeAliasDefinition's tag inside it, for instance, and that should
	// still count. An ambiguous variant, and every member spelling regardless
	// of ambiguity, stays scoped to cases whose own resolved node matches the
	// entry's node, or a Value/Record fence would wrongly silence a
	// Type/Record gap (and member searches inside the wrong node's payload
	// would be meaningless either way).
	const variantNodes = new Map<string, Set<string>>();
	for (const entry of vocabulary) {
		const nodes = variantNodes.get(entry.variant) ?? new Set<string>();
		nodes.add(entry.node);
		variantNodes.set(entry.variant, nodes);
	}
	const ambiguousVariants = new Set([...variantNodes].filter(([, nodes]) => nodes.size > 1).map(([variant]) => variant));

	const gaps: CoverageGap[] = [];
	for (const entry of vocabulary) {
		const scoped = byNode.get(entry.node) ?? [];
		const variantSeen = { value: false };
		const memberSeen = new Set<string>();

		const variantScope = ambiguousVariants.has(entry.variant) ? scoped.filter((c) => c.status !== "pending") : activeCases;
		for (const c of variantScope) {
			for (const json of jsonFences(c)) {
				walk(json, (key) => {
					if (key === entry.variant) variantSeen.value = true;
				});
			}
		}

		// Member spellings always stay node-scoped, so this walk repeats the
		// variant-key search for unambiguous variants too — the cost is a
		// second pass over a typically small case set, not a correctness
		// concern.
		for (const c of scoped) {
			if (c.status === "pending") continue;
			for (const json of jsonFences(c)) {
				walk(json, (key, payload) => {
					if (key !== entry.variant) return;
					variantSeen.value = true;
					if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) for (const k of Object.keys(payload)) memberSeen.add(k);
				});
			}
		}

		for (const c of scoped) {
			if (c.status !== "pending") continue;
			const text = `${c.title}\n${c.prose.join("\n")}`;
			if (text.includes(entry.variant)) {
				variantSeen.value = true;
				for (const m of entry.members) if (text.includes(m.name)) memberSeen.add(m.name);
			}
		}

		if (!variantSeen.value) gaps.push({ node: entry.node, variant: entry.variant });
		for (const m of entry.members) if (!memberSeen.has(m.name)) gaps.push({ node: entry.node, variant: entry.variant, member: m.name });
	}
	return gaps;
}

export function formatGap(g: CoverageGap): string {
	return g.member === undefined ? `${g.node}/${g.variant} has no case` : `${g.node}/${g.variant} member ${g.member} has no case`;
}
