// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Tuple: pairs are readonly two-element arrays.

export type Tuple<A, B> = readonly [A, B];

export function pair<A, B>(a: A, b: B): Tuple<A, B> {
	return [a, b];
}

export function first<A, B>(t: Tuple<A, B>): A {
	return t[0];
}

export function second<A, B>(t: Tuple<A, B>): B {
	return t[1];
}

export function mapFirst<A, B, X>(f: (a: A) => X, t: Tuple<A, B>): Tuple<X, B> {
	return [f(t[0]), t[1]];
}

export function mapSecond<A, B, Y>(f: (b: B) => Y, t: Tuple<A, B>): Tuple<A, Y> {
	return [t[0], f(t[1])];
}

export function mapBoth<A, B, X, Y>(f: (a: A) => X, g: (b: B) => Y, t: Tuple<A, B>): Tuple<X, Y> {
	return [f(t[0]), g(t[1])];
}
