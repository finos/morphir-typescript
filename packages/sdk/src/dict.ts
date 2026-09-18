// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Dict: a mapping from comparable keys to values, following
// elm/core 1.0.5. The representation is a plain object whose `entries` are
// sorted ascending by `compare` on the key with no duplicate keys, so
// `internal/equal.ts` compares two dicts structurally without extra code.
// Every function returns a new object; nothing is mutated.
import { type Comparable, compare } from "./internal/compare.ts";
import { Just, type Maybe, Nothing } from "./maybe.ts";

export type Entry<K, V> = readonly [K, V];

export interface Dict<K extends Comparable, V> {
	readonly kind: "Dict";
	readonly entries: readonly Entry<K, V>[];
}

function make<K extends Comparable, V>(entries: readonly Entry<K, V>[]): Dict<K, V> {
	return { kind: "Dict", entries };
}

// Binary search over the sorted entries. `found` is true when the key is
// present at `index`; otherwise `index` is the position where the key would be
// inserted to keep the entries sorted.
function search<K extends Comparable, V>(key: K, entries: readonly Entry<K, V>[]): { readonly found: boolean; readonly index: number } {
	let lo = 0;
	let hi = entries.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		const entry = entries[mid];
		if (entry === undefined) break;
		const o = compare(entry[0], key);
		if (o === "EQ") return { found: true, index: mid };
		if (o === "LT") lo = mid + 1;
		else hi = mid;
	}
	return { found: false, index: lo };
}

export function empty<K extends Comparable, V>(): Dict<K, V> {
	return make([]);
}

export function singleton<K extends Comparable, V>(key: K, value: V): Dict<K, V> {
	return make([[key, value]]);
}

export function insert<K extends Comparable, V>(key: K, value: V, dict: Dict<K, V>): Dict<K, V> {
	const { found, index } = search(key, dict.entries);
	const entries = dict.entries;
	const entry: Entry<K, V> = [key, value];
	return make(found ? [...entries.slice(0, index), entry, ...entries.slice(index + 1)] : [...entries.slice(0, index), entry, ...entries.slice(index)]);
}

export function update<K extends Comparable, V>(key: K, alter: (m: Maybe<V>) => Maybe<V>, dict: Dict<K, V>): Dict<K, V> {
	const next = alter(get(key, dict));
	return next.kind === "Just" ? insert(key, next.value, dict) : remove(key, dict);
}

export function remove<K extends Comparable, V>(key: K, dict: Dict<K, V>): Dict<K, V> {
	const { found, index } = search(key, dict.entries);
	if (!found) return dict;
	return make([...dict.entries.slice(0, index), ...dict.entries.slice(index + 1)]);
}

export function isEmpty<K extends Comparable, V>(dict: Dict<K, V>): boolean {
	return dict.entries.length === 0;
}

export function member<K extends Comparable, V>(key: K, dict: Dict<K, V>): boolean {
	return search(key, dict.entries).found;
}

export function get<K extends Comparable, V>(key: K, dict: Dict<K, V>): Maybe<V> {
	const { found, index } = search(key, dict.entries);
	if (!found) return Nothing;
	const entry = dict.entries[index];
	return entry === undefined ? Nothing : Just(entry[1]);
}

export function size<K extends Comparable, V>(dict: Dict<K, V>): number {
	return dict.entries.length;
}

export function keys<K extends Comparable, V>(dict: Dict<K, V>): readonly K[] {
	return dict.entries.map(([k]) => k);
}

export function values<K extends Comparable, V>(dict: Dict<K, V>): readonly V[] {
	return dict.entries.map(([, v]) => v);
}

export function toList<K extends Comparable, V>(dict: Dict<K, V>): readonly Entry<K, V>[] {
	return dict.entries;
}

// Later entries win, as in Elm where `fromList` folds `insert` over the list.
export function fromList<K extends Comparable, V>(list: readonly Entry<K, V>[]): Dict<K, V> {
	let result: Dict<K, V> = empty();
	for (const [k, v] of list) result = insert(k, v, result);
	return result;
}

export function map<K extends Comparable, A, B>(f: (key: K, value: A) => B, dict: Dict<K, A>): Dict<K, B> {
	return make(dict.entries.map(([k, v]): Entry<K, B> => [k, f(k, v)]));
}

export function foldl<K extends Comparable, V, R>(f: (key: K, value: V, acc: R) => R, init: R, dict: Dict<K, V>): R {
	let acc = init;
	for (const [k, v] of dict.entries) acc = f(k, v, acc);
	return acc;
}

export function foldr<K extends Comparable, V, R>(f: (key: K, value: V, acc: R) => R, init: R, dict: Dict<K, V>): R {
	let acc = init;
	for (let i = dict.entries.length - 1; i >= 0; i--) {
		const entry = dict.entries[i];
		if (entry !== undefined) acc = f(entry[0], entry[1], acc);
	}
	return acc;
}

export function filter<K extends Comparable, V>(pred: (key: K, value: V) => boolean, dict: Dict<K, V>): Dict<K, V> {
	return make(dict.entries.filter(([k, v]) => pred(k, v)));
}

export function partition<K extends Comparable, V>(pred: (key: K, value: V) => boolean, dict: Dict<K, V>): readonly [Dict<K, V>, Dict<K, V>] {
	const yes: Entry<K, V>[] = [];
	const no: Entry<K, V>[] = [];
	for (const entry of dict.entries) (pred(entry[0], entry[1]) ? yes : no).push(entry);
	return [make(yes), make(no)];
}

// Walks two sorted entry lists in one pass, calling `onLeft`, `onBoth` or
// `onRight` for each key in ascending order. This is the engine behind
// `union`, `intersect`, `diff` and `merge`.
function walk<K extends Comparable, A, B>(
	left: readonly Entry<K, A>[],
	right: readonly Entry<K, B>[],
	onLeft: (key: K, a: A) => void,
	onBoth: (key: K, a: A, b: B) => void,
	onRight: (key: K, b: B) => void,
): void {
	let i = 0;
	let j = 0;
	while (i < left.length || j < right.length) {
		const l = left[i];
		const r = right[j];
		if (l === undefined) {
			if (r !== undefined) onRight(r[0], r[1]);
			j++;
		} else if (r === undefined) {
			onLeft(l[0], l[1]);
			i++;
		} else {
			const o = compare(l[0], r[0]);
			if (o === "LT") {
				onLeft(l[0], l[1]);
				i++;
			} else if (o === "GT") {
				onRight(r[0], r[1]);
				j++;
			} else {
				onBoth(l[0], l[1], r[1]);
				i++;
				j++;
			}
		}
	}
}

// Prefers the first dict when a key is in both.
export function union<K extends Comparable, V>(a: Dict<K, V>, b: Dict<K, V>): Dict<K, V> {
	const out: Entry<K, V>[] = [];
	walk(
		a.entries,
		b.entries,
		(k, v) => out.push([k, v]),
		(k, v) => out.push([k, v]),
		(k, v) => out.push([k, v]),
	);
	return make(out);
}

// Keeps the values from the first dict.
export function intersect<K extends Comparable, V, W>(a: Dict<K, V>, b: Dict<K, W>): Dict<K, V> {
	const out: Entry<K, V>[] = [];
	walk(
		a.entries,
		b.entries,
		() => undefined,
		(k, v) => out.push([k, v]),
		() => undefined,
	);
	return make(out);
}

// Keeps the entries of the first dict whose keys are not in the second.
export function diff<K extends Comparable, V, W>(a: Dict<K, V>, b: Dict<K, W>): Dict<K, V> {
	const out: Entry<K, V>[] = [];
	walk(
		a.entries,
		b.entries,
		(k, v) => out.push([k, v]),
		() => undefined,
		() => undefined,
	);
	return make(out);
}

export function merge<K extends Comparable, A, B, R>(
	leftStep: (key: K, a: A, acc: R) => R,
	bothStep: (key: K, a: A, b: B, acc: R) => R,
	rightStep: (key: K, b: B, acc: R) => R,
	left: Dict<K, A>,
	right: Dict<K, B>,
	init: R,
): R {
	let acc = init;
	walk(
		left.entries,
		right.entries,
		(k, a) => {
			acc = leftStep(k, a, acc);
		},
		(k, a, b) => {
			acc = bothStep(k, a, b, acc);
		},
		(k, b) => {
			acc = rightStep(k, b, acc);
		},
	);
	return acc;
}
