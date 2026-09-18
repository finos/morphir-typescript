// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Elm's `compare` over the comparable types: numbers, strings (a Char is a
// one-code-point string), and tuples or lists of comparables, ordered
// lexicographically. Anything else is a programming error, as in Elm where the
// type checker rejects it; here it throws.

export type Order = "LT" | "EQ" | "GT";

export type Comparable = number | string | bigint | readonly Comparable[];

export function compare<A extends Comparable>(a: A, b: A): Order {
	if (typeof a === "number" && typeof b === "number") return a < b ? "LT" : a > b ? "GT" : "EQ";
	if (typeof a === "string" && typeof b === "string") return a < b ? "LT" : a > b ? "GT" : "EQ";
	if (typeof a === "bigint" && typeof b === "bigint") return a < b ? "LT" : a > b ? "GT" : "EQ";
	if (Array.isArray(a) && Array.isArray(b)) {
		const n = Math.min(a.length, b.length);
		for (let i = 0; i < n; i++) {
			const o = compare(a[i] as Comparable, b[i] as Comparable);
			if (o !== "EQ") return o;
		}
		return a.length < b.length ? "LT" : a.length > b.length ? "GT" : "EQ";
	}
	throw new TypeError(`compare: values are not comparable (${describe(a)} and ${describe(b)})`);
}

export function toNumber(o: Order): -1 | 0 | 1 {
	return o === "LT" ? -1 : o === "GT" ? 1 : 0;
}

function describe(v: unknown): string {
	return Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
}
