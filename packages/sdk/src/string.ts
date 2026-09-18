// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.String: Elm's String module. Strings are JS strings, so
// `length` and `slice` count UTF-16 code units like elm/core. Functions that
// walk characters (`toList`, `map`, `foldl`, ...) step by code point via
// `Array.from`, so astral characters stay whole.
import type { Char } from "./char.ts";
import { Just, type Maybe, Nothing } from "./maybe.ts";

function chars(s: string): Char[] {
	return Array.from(s);
}

// Basics

export function isEmpty(s: string): boolean {
	return s.length === 0;
}
export function length(s: string): number {
	return s.length;
}
export function reverse(s: string): string {
	return chars(s).reverse().join("");
}
export function repeat(n: number, s: string): string {
	return n > 0 ? s.repeat(n) : "";
}
export function replace(match: string, replacement: string, s: string): string {
	return s.split(match).join(replacement);
}

// Building and splitting

export function append(s1: string, s2: string): string {
	return s1 + s2;
}
export function concat(list: readonly string[]): string {
	return list.join("");
}
export function split(sep: string, s: string): readonly string[] {
	return s.split(sep);
}
export function join(sep: string, list: readonly string[]): string {
	return list.join(sep);
}
// As in elm/core: trim, then split on whitespace runs, so an empty or
// all-whitespace input yields [""].
export function words(s: string): readonly string[] {
	return s.trim().split(/\s+/);
}
export function lines(s: string): readonly string[] {
	return s.split(/\r\n|\r|\n/);
}

// Substrings

export function slice(start: number, end: number, s: string): string {
	return s.slice(start, end);
}
export function left(n: number, s: string): string {
	return n < 1 ? "" : s.slice(0, n);
}
export function right(n: number, s: string): string {
	return n < 1 ? "" : s.slice(-n);
}
export function dropLeft(n: number, s: string): string {
	return n < 1 ? s : s.slice(n);
}
export function dropRight(n: number, s: string): string {
	return n < 1 ? s : s.slice(0, -n);
}

// Checks

export function contains(ref: string, s: string): boolean {
	return s.includes(ref);
}
export function startsWith(ref: string, s: string): boolean {
	return s.startsWith(ref);
}
export function endsWith(ref: string, s: string): boolean {
	return s.endsWith(ref);
}
// Matches do not overlap: indexes("aa", "aaaa") is [0, 2], as in elm/core.
export function indexes(ref: string, s: string): readonly number[] {
	if (ref.length < 1) return [];
	const found: number[] = [];
	let i = s.indexOf(ref, 0);
	while (i > -1) {
		found.push(i);
		i = s.indexOf(ref, i + ref.length);
	}
	return found;
}
export const indices: (ref: string, s: string) => readonly number[] = indexes;

// Int conversions

// Elm accepts an optional sign and then digits only: no whitespace, no
// decimal point, no exponent, no radix prefix.
export function toInt(s: string): Maybe<number> {
	return /^[+-]?\d+$/.test(s) ? Just(Number.parseInt(s, 10)) : Nothing;
}
export function fromInt(a: number): string {
	return String(a);
}

// Float conversions

// elm/core rejects the empty string and anything with whitespace or a radix
// letter (x, b, o), then converts with JS `+s` and rejects NaN. So ".5" and
// "1." are accepted, and " 1", "0x10", "31a" are not.
export function toFloat(s: string): Maybe<number> {
	if (s.length === 0 || /[\sxbo]/.test(s)) return Nothing;
	const n = +s;
	return Number.isNaN(n) ? Nothing : Just(n);
}
// Elm prints through JS number-to-string, so 1.0 prints as "1".
export function fromFloat(a: number): string {
	return String(a);
}

// Char conversions

export function fromChar(ch: Char): string {
	return ch;
}
export function cons(ch: Char, s: string): string {
	return ch + s;
}
export function uncons(s: string): Maybe<readonly [Char, string]> {
	const first = s.codePointAt(0);
	if (first === undefined) return Nothing;
	const head = String.fromCodePoint(first);
	return Just([head, s.slice(head.length)]);
}
export function toList(s: string): readonly Char[] {
	return chars(s);
}
export function fromList(a: readonly Char[]): string {
	return a.join("");
}

// Formatting

export function toUpper(s: string): string {
	return s.toUpperCase();
}
export function toLower(s: string): string {
	return s.toLowerCase();
}
// The extra character of an odd padding goes on the left, as in elm/core.
export function pad(n: number, ch: Char, s: string): string {
	const half = (n - s.length) / 2;
	return repeat(Math.ceil(half), ch) + s + repeat(Math.floor(half), ch);
}
export function padLeft(n: number, ch: Char, s: string): string {
	return repeat(n - s.length, ch) + s;
}
export function padRight(n: number, ch: Char, s: string): string {
	return s + repeat(n - s.length, ch);
}
export function trim(s: string): string {
	return s.trim();
}
export function trimLeft(s: string): string {
	return s.trimStart();
}
export function trimRight(s: string): string {
	return s.trimEnd();
}

// Higher-order helpers

export function map(f: (ch: Char) => Char, s: string): string {
	return chars(s).map(f).join("");
}
export function filter(f: (ch: Char) => boolean, s: string): string {
	return chars(s).filter(f).join("");
}
export function foldl<B>(f: (ch: Char, acc: B) => B, z: B, s: string): B {
	let acc = z;
	for (const ch of chars(s)) acc = f(ch, acc);
	return acc;
}
export function foldr<B>(f: (ch: Char, acc: B) => B, z: B, s: string): B {
	let acc = z;
	const cs = chars(s);
	for (let i = cs.length - 1; i >= 0; i--) acc = f(cs[i] as Char, acc);
	return acc;
}
export function any(f: (ch: Char) => boolean, s: string): boolean {
	return chars(s).some(f);
}
export function all(f: (ch: Char) => boolean, s: string): boolean {
	return chars(s).every(f);
}
