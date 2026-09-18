// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Char: Elm's Char module. A `Char` is a string that holds one
// code point. The classification predicates are ASCII-only, like elm/core.

export type Char = string;

function code(c: Char): number {
	return c.charCodeAt(0);
}

export function isUpper(c: Char): boolean {
	const n = code(c);
	return n >= 0x41 && n <= 0x5a && c.length === 1;
}
export function isLower(c: Char): boolean {
	const n = code(c);
	return n >= 0x61 && n <= 0x7a && c.length === 1;
}
export function isAlpha(c: Char): boolean {
	return isLower(c) || isUpper(c);
}
export function isAlphaNum(c: Char): boolean {
	return isLower(c) || isUpper(c) || isDigit(c);
}
export function isDigit(c: Char): boolean {
	const n = code(c);
	return n >= 0x30 && n <= 0x39 && c.length === 1;
}
export function isOctDigit(c: Char): boolean {
	const n = code(c);
	return n >= 0x30 && n <= 0x37 && c.length === 1;
}
export function isHexDigit(c: Char): boolean {
	const n = code(c);
	return isDigit(c) || (n >= 0x41 && n <= 0x46 && c.length === 1) || (n >= 0x61 && n <= 0x66 && c.length === 1);
}

// Case conversion goes through the JS string methods, as in elm/core. Some
// inputs expand to more than one code point ("ß" -> "SS"); Elm has the same
// behaviour.
export function toUpper(c: Char): Char {
	return c.toUpperCase();
}
export function toLower(c: Char): Char {
	return c.toLowerCase();
}
export function toLocaleUpper(c: Char): Char {
	return c.toLocaleUpperCase();
}
export function toLocaleLower(c: Char): Char {
	return c.toLocaleLowerCase();
}

// toCode yields the full code point, so astral characters ("😃") round-trip.
export function toCode(c: Char): number {
	return c.codePointAt(0) ?? Number.NaN;
}
// fromCode yields U+FFFD for a code outside the Unicode range, like elm/core.
export function fromCode(c: number): Char {
	return Number.isInteger(c) && c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : "�";
}
