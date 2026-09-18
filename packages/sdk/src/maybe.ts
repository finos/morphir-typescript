// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Maybe: a value that may or may not exist. `Nothing` is one
// shared frozen constant so structural equality and identity agree.

export type Maybe<A> = { readonly kind: "Just"; readonly value: A } | { readonly kind: "Nothing" };

export const Nothing: Maybe<never> = Object.freeze({ kind: "Nothing" } as const);

export function Just<A>(value: A): Maybe<A> {
	return { kind: "Just", value };
}

export function isJust<A>(m: Maybe<A>): m is { readonly kind: "Just"; readonly value: A } {
	return m.kind === "Just";
}

export function withDefault<A>(fallback: A, m: Maybe<A>): A {
	return m.kind === "Just" ? m.value : fallback;
}

export function hasValue<A>(m: Maybe<A>): boolean {
	return m.kind === "Just";
}

export function map<A, B>(f: (a: A) => B, m: Maybe<A>): Maybe<B> {
	return m.kind === "Just" ? Just(f(m.value)) : Nothing;
}

export function map2<A, B, R>(f: (a: A, b: B) => R, ma: Maybe<A>, mb: Maybe<B>): Maybe<R> {
	return ma.kind === "Just" && mb.kind === "Just" ? Just(f(ma.value, mb.value)) : Nothing;
}

export function map3<A, B, C, R>(f: (a: A, b: B, c: C) => R, ma: Maybe<A>, mb: Maybe<B>, mc: Maybe<C>): Maybe<R> {
	return ma.kind === "Just" && mb.kind === "Just" && mc.kind === "Just" ? Just(f(ma.value, mb.value, mc.value)) : Nothing;
}

export function map4<A, B, C, D, R>(f: (a: A, b: B, c: C, d: D) => R, ma: Maybe<A>, mb: Maybe<B>, mc: Maybe<C>, md: Maybe<D>): Maybe<R> {
	return ma.kind === "Just" && mb.kind === "Just" && mc.kind === "Just" && md.kind === "Just" ? Just(f(ma.value, mb.value, mc.value, md.value)) : Nothing;
}

export function map5<A, B, C, D, E, R>(f: (a: A, b: B, c: C, d: D, e: E) => R, ma: Maybe<A>, mb: Maybe<B>, mc: Maybe<C>, md: Maybe<D>, me: Maybe<E>): Maybe<R> {
	return ma.kind === "Just" && mb.kind === "Just" && mc.kind === "Just" && md.kind === "Just" && me.kind === "Just"
		? Just(f(ma.value, mb.value, mc.value, md.value, me.value))
		: Nothing;
}

export function andThen<A, B>(f: (a: A) => Maybe<B>, m: Maybe<A>): Maybe<B> {
	return m.kind === "Just" ? f(m.value) : Nothing;
}
