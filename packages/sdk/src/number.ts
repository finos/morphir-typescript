// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Number: an arbitrary-precision rational over bigint. Operations
// do not reduce their result; `simplify` does. The Elm name `Number` is
// re-exported as a type alias of `Rational` because a bare `Number`
// declaration would shadow the global.
import { Decimal as BaseDecimal } from "decimal.js";
import { Just, type Maybe, Nothing } from "./maybe.ts";
import { Err, Ok, type Result } from "./result.ts";

export interface Rational {
	readonly kind: "Rational";
	readonly numerator: bigint;
	readonly denominator: bigint;
}

export type { Rational as Number };

export interface DivisionByZero {
	readonly kind: "DivisionByZero";
}

export const DivisionByZero: DivisionByZero = Object.freeze({ kind: "DivisionByZero" } as const);

const Decimal = BaseDecimal.clone({ precision: 50 });

function rational(numerator: bigint, denominator: bigint): Rational {
	return { kind: "Rational", numerator, denominator };
}

export const zero: Rational = rational(0n, 1n);
export const one: Rational = rational(1n, 1n);

export function fromInt(n: number): Rational {
	return rational(BigInt(n), 1n);
}

// Conversion

export function toDecimal(n: Rational): Maybe<BaseDecimal> {
	if (n.denominator === 0n) return Nothing;
	return Just(new Decimal(n.numerator.toString()).div(n.denominator.toString()));
}

export function coerceToDecimal(fallback: BaseDecimal, n: Rational): BaseDecimal {
	const d = toDecimal(n);
	return d.kind === "Just" ? d.value : fallback;
}

export function toFractionalString(n: Rational): string {
	return `${n.numerator}/${n.denominator}`;
}

// Comparison: cross-multiply after moving any negative sign out of the
// denominators, so a/b < c/d holds by value.

function positiveDenominator(n: Rational): Rational {
	return n.denominator < 0n ? rational(-n.numerator, -n.denominator) : n;
}

function crossProducts(a: Rational, b: Rational): readonly [bigint, bigint] {
	const x = positiveDenominator(a);
	const y = positiveDenominator(b);
	return [x.numerator * y.denominator, x.denominator * y.numerator];
}

function compareWith(f: (x: bigint, y: bigint) => boolean, a: Rational, b: Rational): boolean {
	const [x, y] = crossProducts(a, b);
	return f(x, y);
}

export function equal(a: Rational, b: Rational): boolean {
	return compareWith((x, y) => x === y, a, b);
}

export function notEqual(a: Rational, b: Rational): boolean {
	return compareWith((x, y) => x !== y, a, b);
}

export function lessThan(a: Rational, b: Rational): boolean {
	return compareWith((x, y) => x < y, a, b);
}

export function lessThanOrEqual(a: Rational, b: Rational): boolean {
	return compareWith((x, y) => x <= y, a, b);
}

export function greaterThan(a: Rational, b: Rational): boolean {
	return compareWith((x, y) => x > y, a, b);
}

export function greaterThanOrEqual(a: Rational, b: Rational): boolean {
	return compareWith((x, y) => x >= y, a, b);
}

// Arithmetic

function isZero(n: Rational): boolean {
	return n.numerator === 0n;
}

function absBig(x: bigint): bigint {
	return x < 0n ? -x : x;
}

export function negate(n: Rational): Rational {
	return rational(-n.numerator, n.denominator);
}

export function abs(n: Rational): Rational {
	return rational(absBig(n.numerator), absBig(n.denominator));
}

// Elm leaves zero as is rather than producing x/0.
export function reciprocal(n: Rational): Rational {
	return isZero(n) ? n : rational(n.denominator, n.numerator);
}

export function add(a: Rational, b: Rational): Rational {
	return rational(a.numerator * b.denominator + a.denominator * b.numerator, a.denominator * b.denominator);
}

export function subtract(a: Rational, b: Rational): Rational {
	return rational(a.numerator * b.denominator - a.denominator * b.numerator, a.denominator * b.denominator);
}

export function multiply(a: Rational, b: Rational): Rational {
	return rational(a.numerator * b.numerator, a.denominator * b.denominator);
}

export function divide(a: Rational, b: Rational): Result<DivisionByZero, Rational> {
	return isZero(b) ? Err(DivisionByZero) : Ok(rational(a.numerator * b.denominator, a.denominator * b.numerator));
}

// Simplification

function gcd(a: bigint, b: bigint): bigint {
	let x = absBig(a);
	let y = absBig(b);
	while (y !== 0n) {
		[x, y] = [y, x % y];
	}
	return x;
}

export function simplify(n: Rational): Maybe<Rational> {
	if (n.denominator === 0n) return Nothing;
	const factor = gcd(n.numerator, n.denominator);
	const sign = n.denominator < 0n ? -1n : 1n;
	return Just(rational((sign * n.numerator) / factor, (sign * n.denominator) / factor));
}

export function isSimplified(n: Rational): boolean {
	const s = simplify(n);
	return s.kind === "Nothing" || (s.value.numerator === n.numerator && s.value.denominator === n.denominator);
}
