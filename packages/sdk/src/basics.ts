// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Basics: Elm's Basics module. Operators appear under the names
// the Morphir IR SDK specification gives them (`add`, `equal`, `append`, ...).
// Int and Float are both `number`; the Int operations assume integral inputs.
import { type Comparable, compare as compareValues, type Order } from "./internal/compare.ts";
import { equal as equalValues } from "./internal/equal.ts";

export type { Comparable, Order };
export type Appendable = string | readonly unknown[];

// Numbers

export function add(a: number, b: number): number {
	return a + b;
}
export function subtract(a: number, b: number): number {
	return a - b;
}
export function multiply(a: number, b: number): number {
	return a * b;
}
export function divide(a: number, b: number): number {
	return a / b;
}
// Elm's `//` truncates toward zero and yields 0 on a zero divisor.
export function integerDivide(a: number, b: number): number {
	return b === 0 ? 0 : Math.trunc(a / b);
}
export function power(a: number, b: number): number {
	return a ** b;
}
export function toFloat(a: number): number {
	return a;
}
export function round(a: number): number {
	return Math.round(a);
}
export function floor(a: number): number {
	return Math.floor(a);
}
export function ceiling(a: number): number {
	return Math.ceil(a);
}
export function truncate(a: number): number {
	return Math.trunc(a);
}
// Elm's modBy raises on a zero modulus; remainderBy yields NaN.
export function modBy(modulus: number, a: number): number {
	if (modulus === 0) throw new RangeError("modBy: cannot perform mod 0");
	const r = a % modulus;
	return r === 0 || r > 0 === modulus > 0 ? r : r + modulus;
}
export function remainderBy(divisor: number, a: number): number {
	return a % divisor;
}
export function negate(a: number): number {
	return -a;
}
export function abs(a: number): number {
	return Math.abs(a);
}
export function clamp<A extends Comparable>(low: A, high: A, a: A): A {
	return lessThan(a, low) ? low : greaterThan(a, high) ? high : a;
}
// Exported under Elm's name `isNaN`; declared under another name so it does
// not shadow the global.
function isNotANumber(a: number): boolean {
	return Number.isNaN(a);
}

export { isNotANumber as isNaN };
export function isInfinite(a: number): boolean {
	return a === Number.POSITIVE_INFINITY || a === Number.NEGATIVE_INFINITY;
}
export function sqrt(a: number): number {
	return Math.sqrt(a);
}
export function logBase(base: number, a: number): number {
	return Math.log(a) / Math.log(base);
}
export const e: number = Math.E;
export const pi: number = Math.PI;
export function cos(a: number): number {
	return Math.cos(a);
}
export function sin(a: number): number {
	return Math.sin(a);
}
export function tan(a: number): number {
	return Math.tan(a);
}
export function acos(a: number): number {
	return Math.acos(a);
}
export function asin(a: number): number {
	return Math.asin(a);
}
export function atan(a: number): number {
	return Math.atan(a);
}
export function atan2(y: number, x: number): number {
	return Math.atan2(y, x);
}
export function degrees(a: number): number {
	return (a * Math.PI) / 180;
}
export function radians(a: number): number {
	return a;
}
export function turns(a: number): number {
	return a * 2 * Math.PI;
}
export function toPolar(point: readonly [number, number]): readonly [number, number] {
	const [x, y] = point;
	return [Math.sqrt(x * x + y * y), Math.atan2(y, x)];
}
export function fromPolar(polar: readonly [number, number]): readonly [number, number] {
	const [r, theta] = polar;
	return [r * Math.cos(theta), r * Math.sin(theta)];
}

// Equality and ordering

export function equal<A>(a: A, b: A): boolean {
	return equalValues(a, b);
}
export function notEqual<A>(a: A, b: A): boolean {
	return !equalValues(a, b);
}
export function compare<A extends Comparable>(a: A, b: A): Order {
	return compareValues(a, b);
}
export function lessThan<A extends Comparable>(a: A, b: A): boolean {
	return compareValues(a, b) === "LT";
}
export function greaterThan<A extends Comparable>(a: A, b: A): boolean {
	return compareValues(a, b) === "GT";
}
export function lessThanOrEqual<A extends Comparable>(a: A, b: A): boolean {
	return compareValues(a, b) !== "GT";
}
export function greaterThanOrEqual<A extends Comparable>(a: A, b: A): boolean {
	return compareValues(a, b) !== "LT";
}
export function max<A extends Comparable>(a: A, b: A): A {
	return greaterThan(a, b) ? a : b;
}
export function min<A extends Comparable>(a: A, b: A): A {
	return lessThan(a, b) ? a : b;
}

// Booleans

export function not(a: boolean): boolean {
	return !a;
}
export function and(a: boolean, b: boolean): boolean {
	return a && b;
}
export function or(a: boolean, b: boolean): boolean {
	return a || b;
}
export function xor(a: boolean, b: boolean): boolean {
	return a !== b;
}

// Appendables

export function append(a: string, b: string): string;
export function append<A>(a: readonly A[], b: readonly A[]): readonly A[];
export function append(a: Appendable, b: Appendable): Appendable {
	if (typeof a === "string" && typeof b === "string") return a + b;
	return [...(a as readonly unknown[]), ...(b as readonly unknown[])];
}

// Functions

export function identity<A>(a: A): A {
	return a;
}
export function always<A, B>(a: A, _b: B): A {
	return a;
}
// composeLeft(g, f) is Elm's `g << f`; composeRight(f, g) is `f >> g`.
export function composeLeft<A, B, C>(g: (b: B) => C, f: (a: A) => B): (a: A) => C {
	return (a) => g(f(a));
}
export function composeRight<A, B, C>(f: (a: A) => B, g: (b: B) => C): (a: A) => C {
	return (a) => g(f(a));
}
export function never(_a: never): never {
	throw new Error("never: a value of type Never was constructed");
}
