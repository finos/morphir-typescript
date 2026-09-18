// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.List: elm/core's List plus the Morphir extras `innerJoin` and
// `leftJoin`. A List is a readonly array; no function mutates its input.
import { type Comparable, compare, type Order, toNumber } from "./internal/compare.ts";
import { equal } from "./internal/equal.ts";
import { Just, type Maybe, Nothing } from "./maybe.ts";

export type List<A> = readonly A[];

// Create

export function singleton<A>(a: A): List<A> {
	return [a];
}

export function repeat<A>(n: number, a: A): List<A> {
	const out: A[] = [];
	for (let i = 0; i < n; i++) out.push(a);
	return out;
}

// Inclusive on both ends, as in Elm: range(3, 6) = [3, 4, 5, 6].
export function range(from: number, to: number): List<number> {
	const out: number[] = [];
	for (let i = from; i <= to; i++) out.push(i);
	return out;
}

export function cons<A>(head: A, tail: List<A>): List<A> {
	return [head, ...tail];
}

// Transform

export function map<A, B>(f: (a: A) => B, list: List<A>): List<B> {
	return list.map((a) => f(a));
}

export function indexedMap<A, B>(f: (index: number, a: A) => B, list: List<A>): List<B> {
	return list.map((a, i) => f(i, a));
}

// Elm's reducer order: the element comes first, the accumulator second.
export function foldl<A, B>(f: (a: A, acc: B) => B, z: B, list: List<A>): B {
	let acc = z;
	for (const a of list) acc = f(a, acc);
	return acc;
}

export function foldr<A, B>(f: (a: A, acc: B) => B, z: B, list: List<A>): B {
	let acc = z;
	for (let i = list.length - 1; i >= 0; i--) acc = f(list[i] as A, acc);
	return acc;
}

export function filter<A>(f: (a: A) => boolean, list: List<A>): List<A> {
	return list.filter((a) => f(a));
}

export function filterMap<A, B>(f: (a: A) => Maybe<B>, list: List<A>): List<B> {
	const out: B[] = [];
	for (const a of list) {
		const m = f(a);
		if (m.kind === "Just") out.push(m.value);
	}
	return out;
}

// Utilities

export function length<A>(list: List<A>): number {
	return list.length;
}

export function reverse<A>(list: List<A>): List<A> {
	return [...list].reverse();
}

export function member<A>(ref: A, list: List<A>): boolean {
	return list.some((a) => equal(ref, a));
}

export function all<A>(f: (a: A) => boolean, list: List<A>): boolean {
	return list.every((a) => f(a));
}

export function any<A>(f: (a: A) => boolean, list: List<A>): boolean {
	return list.some((a) => f(a));
}

export function maximum<A extends Comparable>(list: List<A>): Maybe<A> {
	let best: Maybe<A> = Nothing;
	for (const a of list) {
		if (best.kind === "Nothing" || compare(a, best.value) === "GT") best = Just(a);
	}
	return best;
}

export function minimum<A extends Comparable>(list: List<A>): Maybe<A> {
	let best: Maybe<A> = Nothing;
	for (const a of list) {
		if (best.kind === "Nothing" || compare(a, best.value) === "LT") best = Just(a);
	}
	return best;
}

export function sum(list: List<number>): number {
	let acc = 0;
	for (const n of list) acc += n;
	return acc;
}

export function product(list: List<number>): number {
	let acc = 1;
	for (const n of list) acc *= n;
	return acc;
}

// Combine

export function append<A>(l1: List<A>, l2: List<A>): List<A> {
	return [...l1, ...l2];
}

export function concat<A>(lists: List<List<A>>): List<A> {
	const out: A[] = [];
	for (const l of lists) out.push(...l);
	return out;
}

export function concatMap<A, B>(f: (a: A) => List<B>, list: List<A>): List<B> {
	const out: B[] = [];
	for (const a of list) out.push(...f(a));
	return out;
}

export function intersperse<A>(sep: A, list: List<A>): List<A> {
	const out: A[] = [];
	let first = true;
	for (const a of list) {
		if (!first) out.push(sep);
		out.push(a);
		first = false;
	}
	return out;
}

// map2..map5 stop at the shortest list, as in Elm.
export function map2<A, B, R>(f: (a: A, b: B) => R, la: List<A>, lb: List<B>): List<R> {
	const n = Math.min(la.length, lb.length);
	const out: R[] = [];
	for (let i = 0; i < n; i++) out.push(f(la[i] as A, lb[i] as B));
	return out;
}

export function map3<A, B, C, R>(f: (a: A, b: B, c: C) => R, la: List<A>, lb: List<B>, lc: List<C>): List<R> {
	const n = Math.min(la.length, lb.length, lc.length);
	const out: R[] = [];
	for (let i = 0; i < n; i++) out.push(f(la[i] as A, lb[i] as B, lc[i] as C));
	return out;
}

export function map4<A, B, C, D, R>(f: (a: A, b: B, c: C, d: D) => R, la: List<A>, lb: List<B>, lc: List<C>, ld: List<D>): List<R> {
	const n = Math.min(la.length, lb.length, lc.length, ld.length);
	const out: R[] = [];
	for (let i = 0; i < n; i++) out.push(f(la[i] as A, lb[i] as B, lc[i] as C, ld[i] as D));
	return out;
}

export function map5<A, B, C, D, E, R>(f: (a: A, b: B, c: C, d: D, e: E) => R, la: List<A>, lb: List<B>, lc: List<C>, ld: List<D>, le: List<E>): List<R> {
	const n = Math.min(la.length, lb.length, lc.length, ld.length, le.length);
	const out: R[] = [];
	for (let i = 0; i < n; i++) out.push(f(la[i] as A, lb[i] as B, lc[i] as C, ld[i] as D, le[i] as E));
	return out;
}

// Sort. Array.prototype.sort is stable, as Elm's merge sort is.

export function sort<A extends Comparable>(list: List<A>): List<A> {
	return [...list].sort((a, b) => toNumber(compare(a, b)));
}

export function sortBy<A, K extends Comparable>(f: (a: A) => K, list: List<A>): List<A> {
	return list
		.map((a) => ({ a, key: f(a) }))
		.sort((x, y) => toNumber(compare(x.key, y.key)))
		.map((x) => x.a);
}

export function sortWith<A>(f: (a: A, b: A) => Order, list: List<A>): List<A> {
	return [...list].sort((a, b) => toNumber(f(a, b)));
}

// Deconstruct

export function isEmpty<A>(list: List<A>): boolean {
	return list.length === 0;
}

export function head<A>(list: List<A>): Maybe<A> {
	return list.length === 0 ? Nothing : Just(list[0] as A);
}

export function tail<A>(list: List<A>): Maybe<List<A>> {
	return list.length === 0 ? Nothing : Just(list.slice(1));
}

export function take<A>(n: number, list: List<A>): List<A> {
	return n <= 0 ? [] : list.slice(0, n);
}

export function drop<A>(n: number, list: List<A>): List<A> {
	return n <= 0 ? list.slice() : list.slice(n);
}

export function partition<A>(f: (a: A) => boolean, list: List<A>): readonly [List<A>, List<A>] {
	const yes: A[] = [];
	const no: A[] = [];
	for (const a of list) (f(a) ? yes : no).push(a);
	return [yes, no];
}

export function unzip<A, B>(list: List<readonly [A, B]>): readonly [List<A>, List<B>] {
	const as: A[] = [];
	const bs: B[] = [];
	for (const [a, b] of list) {
		as.push(a);
		bs.push(b);
	}
	return [as, bs];
}

// Morphir extras (Morphir.SDK.List). Both keep listA's order and yield one
// pair per matching element of listB; leftJoin yields (a, Nothing) when
// nothing in listB matches.

export function innerJoin<A, B>(listB: List<B>, onPredicate: (a: A, b: B) => boolean, listA: List<A>): List<readonly [A, B]> {
	const out: (readonly [A, B])[] = [];
	for (const a of listA) {
		for (const b of listB) if (onPredicate(a, b)) out.push([a, b]);
	}
	return out;
}

export function leftJoin<A, B>(listB: List<B>, onPredicate: (a: A, b: B) => boolean, listA: List<A>): List<readonly [A, Maybe<B>]> {
	const out: (readonly [A, Maybe<B>])[] = [];
	for (const a of listA) {
		let matched = false;
		for (const b of listB) {
			if (onPredicate(a, b)) {
				matched = true;
				out.push([a, Just(b)]);
			}
		}
		if (!matched) out.push([a, Nothing]);
	}
	return out;
}
