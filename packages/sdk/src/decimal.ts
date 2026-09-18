// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Decimal: arbitrary-precision decimal numbers over decimal.js.
//
// All values are built through a local decimal.js clone `D` configured with
// 50 significant digits and half-up rounding. The clone keeps the global
// decimal.js configuration untouched, so other users of the library are not
// affected, and `div` yields 50 significant digits for inexact quotients.
// `toString` always prints plain positional notation (no exponent), as the
// Elm runtime does.
import { Decimal } from "decimal.js";
import type { Order } from "./internal/compare.ts";
import { Just, type Maybe, Nothing, withDefault } from "./maybe.ts";

export type { Decimal };

const D = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

// Elm's grammar: [<sign>]<digits>[.<digits>][e[<sign>]<digits>]. decimal.js
// alone would also accept hex, binary, octal, Infinity, NaN and surrounding
// whitespace, none of which Elm parses.
const ELM_DECIMAL = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;

// Constants

export const zero: Decimal = new D(0);
export const one: Decimal = new D(1);
export const minusOne: Decimal = new D(-1);

// Convert from

export function fromInt(n: number): Decimal {
	return new D(n);
}

// Negative zero collapses to zero, as in the Elm runtime.
export function fromFloat(f: number): Decimal {
	const dec = new D(f);
	return dec.isZero() ? zero : dec;
}

export function fromString(s: string): Maybe<Decimal> {
	if (!ELM_DECIMAL.test(s)) return Nothing;
	try {
		return Just(new D(s));
	} catch {
		return Nothing;
	}
}

// Convert from known exponent

export function hundred(n: number): Decimal {
	return new D(n).times(100);
}
export function thousand(n: number): Decimal {
	return new D(n).times(1000);
}
export function million(n: number): Decimal {
	return new D(n).times(1000000);
}
export function tenth(n: number): Decimal {
	return new D(n).times("0.1");
}
export function hundredth(n: number): Decimal {
	return new D(n).times("0.01");
}
export function thousandth(n: number): Decimal {
	return new D(n).times("0.001");
}
// Basis points: n ten-thousandths.
export function bps(n: number): Decimal {
	return new D(n).times("0.0001");
}
export function millionth(n: number): Decimal {
	return new D(n).times("0.000001");
}

// Convert to

// Exported under Elm's name `toString`; declared under another name so it
// does not shadow the global.
function decimalToString(d: Decimal): string {
	return d.toFixed();
}

export { decimalToString as toString };

// May lose precision.
export function toFloat(d: Decimal): number {
	return d.toNumber();
}

// Arithmetic

export function add(a: Decimal, b: Decimal): Decimal {
	return a.plus(b);
}
export function sub(a: Decimal, b: Decimal): Decimal {
	return a.minus(b);
}
export function mul(a: Decimal, b: Decimal): Decimal {
	return a.times(b);
}
export function div(a: Decimal, b: Decimal): Maybe<Decimal> {
	return b.isZero() ? Nothing : Just(a.div(b));
}
export function divWithDefault(fallback: Decimal, a: Decimal, b: Decimal): Decimal {
	return withDefault(fallback, div(a, b));
}
export function shiftDecimalLeft(n: number, d: Decimal): Decimal {
	return d.div(new D(10).pow(n));
}
export function shiftDecimalRight(n: number, d: Decimal): Decimal {
	return d.times(new D(10).pow(n));
}
export function negate(d: Decimal): Decimal {
	return d.negated();
}
export function abs(d: Decimal): Decimal {
	return d.abs();
}

// Rounding

// Toward zero.
export function truncate(d: Decimal): Decimal {
	return d.truncated();
}
// Half up (ties go away from zero).
export function round(d: Decimal): Decimal {
	return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

// Comparing

export function compare(a: Decimal, b: Decimal): Order {
	const c = a.comparedTo(b);
	return c < 0 ? "LT" : c > 0 ? "GT" : "EQ";
}
export function eq(a: Decimal, b: Decimal): boolean {
	return a.eq(b);
}
export function neq(a: Decimal, b: Decimal): boolean {
	return !a.eq(b);
}
export function gt(a: Decimal, b: Decimal): boolean {
	return a.gt(b);
}
export function gte(a: Decimal, b: Decimal): boolean {
	return a.gte(b);
}
export function lt(a: Decimal, b: Decimal): boolean {
	return a.lt(b);
}
export function lte(a: Decimal, b: Decimal): boolean {
	return a.lte(b);
}
