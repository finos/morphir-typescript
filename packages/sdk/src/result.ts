// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Result: a computation that may fail. The type parameter order
// is Elm's: the error first, then the value.
import { Just, type Maybe, Nothing } from "./maybe.ts";

export type Result<E, A> = { readonly kind: "Ok"; readonly value: A } | { readonly kind: "Err"; readonly error: E };

export function Ok<A>(value: A): Result<never, A> {
	return { kind: "Ok", value };
}

export function Err<E>(error: E): Result<E, never> {
	return { kind: "Err", error };
}

export function isOk<E, A>(r: Result<E, A>): r is { readonly kind: "Ok"; readonly value: A } {
	return r.kind === "Ok";
}

export function withDefault<E, A>(fallback: A, r: Result<E, A>): A {
	return r.kind === "Ok" ? r.value : fallback;
}

export function map<E, A, B>(f: (a: A) => B, r: Result<E, A>): Result<E, B> {
	return r.kind === "Ok" ? Ok(f(r.value)) : r;
}

export function map2<E, A, B, R>(f: (a: A, b: B) => R, ra: Result<E, A>, rb: Result<E, B>): Result<E, R> {
	if (ra.kind === "Err") return ra;
	if (rb.kind === "Err") return rb;
	return Ok(f(ra.value, rb.value));
}

export function map3<E, A, B, C, R>(f: (a: A, b: B, c: C) => R, ra: Result<E, A>, rb: Result<E, B>, rc: Result<E, C>): Result<E, R> {
	if (ra.kind === "Err") return ra;
	if (rb.kind === "Err") return rb;
	if (rc.kind === "Err") return rc;
	return Ok(f(ra.value, rb.value, rc.value));
}

export function map4<E, A, B, C, D, R>(f: (a: A, b: B, c: C, d: D) => R, ra: Result<E, A>, rb: Result<E, B>, rc: Result<E, C>, rd: Result<E, D>): Result<E, R> {
	if (ra.kind === "Err") return ra;
	if (rb.kind === "Err") return rb;
	if (rc.kind === "Err") return rc;
	if (rd.kind === "Err") return rd;
	return Ok(f(ra.value, rb.value, rc.value, rd.value));
}

export function map5<E, A, B, C, D, F, R>(
	f: (a: A, b: B, c: C, d: D, e: F) => R,
	ra: Result<E, A>,
	rb: Result<E, B>,
	rc: Result<E, C>,
	rd: Result<E, D>,
	re: Result<E, F>,
): Result<E, R> {
	if (ra.kind === "Err") return ra;
	if (rb.kind === "Err") return rb;
	if (rc.kind === "Err") return rc;
	if (rd.kind === "Err") return rd;
	if (re.kind === "Err") return re;
	return Ok(f(ra.value, rb.value, rc.value, rd.value, re.value));
}

export function andThen<E, A, B>(f: (a: A) => Result<E, B>, r: Result<E, A>): Result<E, B> {
	return r.kind === "Ok" ? f(r.value) : r;
}

export function mapError<E, F, A>(f: (e: E) => F, r: Result<E, A>): Result<F, A> {
	return r.kind === "Err" ? Err(f(r.error)) : r;
}

export function toMaybe<E, A>(r: Result<E, A>): Maybe<A> {
	return r.kind === "Ok" ? Just(r.value) : Nothing;
}

export function fromMaybe<E, A>(error: E, m: Maybe<A>): Result<E, A> {
	return m.kind === "Just" ? Ok(m.value) : Err(error);
}
