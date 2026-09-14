// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The coverage rule (spec S7): every variant the v4 reader recognizes, and
// every member spelling it accepts, has at least one kit case. A JSON fence
// covers a variant when the variant's name is an object key anywhere in it,
// and covers a member spelling when that member is a key of the object under
// the variant's key. A pending case covers what its title or prose names.
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
	for (const c of kit.cases) {
		const node = c.node === null ? null : resolveNode(c.node);
		if (node === null) continue;
		byNode.set(node, [...(byNode.get(node) ?? []), c]);
	}
	const gaps: CoverageGap[] = [];
	for (const entry of vocabulary) {
		const cases = byNode.get(entry.node) ?? [];
		const variantSeen = { value: false };
		const memberSeen = new Set<string>();
		for (const c of cases) {
			if (c.status === "pending") {
				const text = `${c.title}\n${c.prose.join("\n")}`;
				if (text.includes(entry.variant)) {
					variantSeen.value = true;
					for (const m of entry.members) if (text.includes(m.name)) memberSeen.add(m.name);
				}
				continue;
			}
			for (const json of jsonFences(c)) {
				walk(json, (key, payload) => {
					if (key !== entry.variant) return;
					variantSeen.value = true;
					if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) for (const k of Object.keys(payload)) memberSeen.add(k);
				});
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
