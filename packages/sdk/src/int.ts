// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Int: fixed precision integers. Each width is a branded `number`;
// `toIntN` range-checks and `fromIntN` unwraps. Int64 covers the JS safe
// integer range, not the full 64 bits.
import { Just, type Maybe, Nothing } from "./maybe.ts";

declare const brand: unique symbol;

export type Int8 = number & { readonly [brand]: "Int8" };
export type Int16 = number & { readonly [brand]: "Int16" };
export type Int32 = number & { readonly [brand]: "Int32" };
export type Int64 = number & { readonly [brand]: "Int64" };

function inRange(low: number, high: number, n: number): boolean {
	return Number.isInteger(n) && n >= low && n <= high;
}

export function fromInt8(x: Int8): number {
	return x;
}

export function toInt8(n: number): Maybe<Int8> {
	return inRange(-128, 127, n) ? Just(n as Int8) : Nothing;
}

export function fromInt16(x: Int16): number {
	return x;
}

export function toInt16(n: number): Maybe<Int16> {
	return inRange(-32768, 32767, n) ? Just(n as Int16) : Nothing;
}

export function fromInt32(x: Int32): number {
	return x;
}

export function toInt32(n: number): Maybe<Int32> {
	return inRange(-2147483648, 2147483647, n) ? Just(n as Int32) : Nothing;
}

export function fromInt64(x: Int64): number {
	return x;
}

export function toInt64(n: number): Maybe<Int64> {
	return Number.isSafeInteger(n) ? Just(n as Int64) : Nothing;
}
