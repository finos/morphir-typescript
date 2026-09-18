// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Set: a collection of unique comparable values, following
// elm/core 1.0.5. The representation is a plain object whose `entries` are
// sorted ascending by `compare` with no duplicates, so `internal/equal.ts`
// compares two sets structurally without extra code. Every function returns a
// new object; nothing is mutated.
import { type Comparable, compare } from "./internal/compare.ts";

export interface Set<A extends Comparable> {
	readonly kind: "Set";
	readonly entries: readonly A[];
}

function make<A extends Comparable>(entries: readonly A[]): Set<A> {
	return { kind: "Set", entries };
}

// Binary search over the sorted entries. `found` is true when the value is
// present at `index`; otherwise `index` is the position where the value would
// be inserted to keep the entries sorted.
function search<A extends Comparable>(value: A, entries: readonly A[]): { readonly found: boolean; readonly index: number } {
	let lo = 0;
	let hi = entries.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		const entry = entries[mid];
		if (entry === undefined) break;
		const o = compare(entry, value);
		if (o === "EQ") return { found: true, index: mid };
		if (o === "LT") lo = mid + 1;
		else hi = mid;
	}
	return { found: false, index: lo };
}

export function empty<A extends Comparable>(): Set<A> {
	return make([]);
}

export function singleton<A extends Comparable>(value: A): Set<A> {
	return make([value]);
}

export function insert<A extends Comparable>(value: A, set: Set<A>): Set<A> {
	const { found, index } = search(value, set.entries);
	if (found) return set;
	return make([...set.entries.slice(0, index), value, ...set.entries.slice(index)]);
}

export function remove<A extends Comparable>(value: A, set: Set<A>): Set<A> {
	const { found, index } = search(value, set.entries);
	if (!found) return set;
	return make([...set.entries.slice(0, index), ...set.entries.slice(index + 1)]);
}

export function isEmpty<A extends Comparable>(set: Set<A>): boolean {
	return set.entries.length === 0;
}

export function member<A extends Comparable>(value: A, set: Set<A>): boolean {
	return search(value, set.entries).found;
}

export function size<A extends Comparable>(set: Set<A>): number {
	return set.entries.length;
}

export function toList<A extends Comparable>(set: Set<A>): readonly A[] {
	return set.entries;
}

export function fromList<A extends Comparable>(list: readonly A[]): Set<A> {
	let result: Set<A> = empty();
	for (const value of list) result = insert(value, result);
	return result;
}

// The mapped values are re-sorted and deduplicated, as in Elm where `map`
// rebuilds the set with `fromList`.
export function map<A extends Comparable, B extends Comparable>(f: (a: A) => B, set: Set<A>): Set<B> {
	return fromList(set.entries.map(f));
}

export function foldl<A extends Comparable, R>(f: (a: A, acc: R) => R, init: R, set: Set<A>): R {
	let acc = init;
	for (const value of set.entries) acc = f(value, acc);
	return acc;
}

export function foldr<A extends Comparable, R>(f: (a: A, acc: R) => R, init: R, set: Set<A>): R {
	let acc = init;
	for (let i = set.entries.length - 1; i >= 0; i--) {
		const value = set.entries[i];
		if (value !== undefined) acc = f(value, acc);
	}
	return acc;
}

export function filter<A extends Comparable>(pred: (a: A) => boolean, set: Set<A>): Set<A> {
	return make(set.entries.filter(pred));
}

export function partition<A extends Comparable>(pred: (a: A) => boolean, set: Set<A>): readonly [Set<A>, Set<A>] {
	const yes: A[] = [];
	const no: A[] = [];
	for (const value of set.entries) (pred(value) ? yes : no).push(value);
	return [make(yes), make(no)];
}

// Walks two sorted lists in one pass and keeps each value according to
// whether it is in the left only, in both, or in the right only.
function walk<A extends Comparable>(left: readonly A[], right: readonly A[], keepLeft: boolean, keepBoth: boolean, keepRight: boolean): Set<A> {
	const out: A[] = [];
	let i = 0;
	let j = 0;
	while (i < left.length || j < right.length) {
		const l = left[i];
		const r = right[j];
		if (l === undefined) {
			if (r !== undefined && keepRight) out.push(r);
			j++;
		} else if (r === undefined) {
			if (keepLeft) out.push(l);
			i++;
		} else {
			const o = compare(l, r);
			if (o === "LT") {
				if (keepLeft) out.push(l);
				i++;
			} else if (o === "GT") {
				if (keepRight) out.push(r);
				j++;
			} else {
				if (keepBoth) out.push(l);
				i++;
				j++;
			}
		}
	}
	return make(out);
}

export function union<A extends Comparable>(a: Set<A>, b: Set<A>): Set<A> {
	return walk(a.entries, b.entries, true, true, true);
}

export function intersect<A extends Comparable>(a: Set<A>, b: Set<A>): Set<A> {
	return walk(a.entries, b.entries, false, true, false);
}

export function diff<A extends Comparable>(a: Set<A>, b: Set<A>): Set<A> {
	return walk(a.entries, b.entries, true, false, false);
}
