// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	fromCode,
	isAlpha,
	isAlphaNum,
	isDigit,
	isHexDigit,
	isLower,
	isOctDigit,
	isUpper,
	toCode,
	toLocaleLower,
	toLocaleUpper,
	toLower,
	toUpper,
} from "./char.ts";

describe("Char", () => {
	test("isUpper is ASCII only", () => {
		expect(isUpper("A")).toBe(true);
		expect(isUpper("B")).toBe(true);
		expect(isUpper("Z")).toBe(true);
		expect(isUpper("0")).toBe(false);
		expect(isUpper("a")).toBe(false);
		expect(isUpper("-")).toBe(false);
		expect(isUpper("Σ")).toBe(false);
	});
	test("isLower is ASCII only", () => {
		expect(isLower("a")).toBe(true);
		expect(isLower("b")).toBe(true);
		expect(isLower("z")).toBe(true);
		expect(isLower("0")).toBe(false);
		expect(isLower("A")).toBe(false);
		expect(isLower("-")).toBe(false);
		expect(isLower("π")).toBe(false);
	});
	test("isAlpha", () => {
		expect(isAlpha("a")).toBe(true);
		expect(isAlpha("b")).toBe(true);
		expect(isAlpha("E")).toBe(true);
		expect(isAlpha("Y")).toBe(true);
		expect(isAlpha("0")).toBe(false);
		expect(isAlpha("-")).toBe(false);
		expect(isAlpha("π")).toBe(false);
	});
	test("isAlphaNum", () => {
		expect(isAlphaNum("a")).toBe(true);
		expect(isAlphaNum("b")).toBe(true);
		expect(isAlphaNum("E")).toBe(true);
		expect(isAlphaNum("Y")).toBe(true);
		expect(isAlphaNum("0")).toBe(true);
		expect(isAlphaNum("7")).toBe(true);
		expect(isAlphaNum("9")).toBe(true);
		expect(isAlphaNum("-")).toBe(false);
		expect(isAlphaNum("π")).toBe(false);
	});
	test("isDigit", () => {
		expect(isDigit("0")).toBe(true);
		expect(isDigit("1")).toBe(true);
		expect(isDigit("9")).toBe(true);
		expect(isDigit("a")).toBe(false);
		expect(isDigit("b")).toBe(false);
		expect(isDigit("A")).toBe(false);
		expect(isDigit("٣")).toBe(false);
	});
	test("isOctDigit", () => {
		expect(isOctDigit("0")).toBe(true);
		expect(isOctDigit("1")).toBe(true);
		expect(isOctDigit("7")).toBe(true);
		expect(isOctDigit("8")).toBe(false);
		expect(isOctDigit("a")).toBe(false);
		expect(isOctDigit("A")).toBe(false);
	});
	test("isHexDigit", () => {
		for (const c of "0123456789abcdefABCDEF") expect(isHexDigit(c)).toBe(true);
		expect(isHexDigit("g")).toBe(false);
		expect(isHexDigit("G")).toBe(false);
		expect(isHexDigit("-")).toBe(false);
	});
	test("toUpper and toLower", () => {
		expect(toUpper("a")).toBe("A");
		expect(toUpper("A")).toBe("A");
		expect(toUpper("é")).toBe("É");
		expect(toUpper("1")).toBe("1");
		expect(toLower("A")).toBe("a");
		expect(toLower("a")).toBe("a");
		expect(toLower("É")).toBe("é");
		expect(toLower("1")).toBe("1");
	});
	test("toLocaleUpper and toLocaleLower", () => {
		expect(toLocaleUpper("a")).toBe("A");
		expect(toLocaleLower("A")).toBe("a");
		expect(toLocaleUpper("ß")).toBe("SS");
	});
	test("toCode yields the code point", () => {
		expect(toCode("A")).toBe(65);
		expect(toCode("B")).toBe(66);
		expect(toCode("木")).toBe(0x6728);
		expect(toCode("𝌆")).toBe(0x1d306);
		expect(toCode("😃")).toBe(0x1f603);
	});
	test("fromCode yields one code point", () => {
		expect(fromCode(65)).toBe("A");
		expect(fromCode(66)).toBe("B");
		expect(fromCode(0x6728)).toBe("木");
		expect(fromCode(0x1d306)).toBe("𝌆");
		expect(fromCode(0x1f603)).toBe("😃");
		expect(fromCode(-1)).toBe("�");
		expect(fromCode(0x110000)).toBe("�");
	});
	test("toCode and fromCode round-trip", () => {
		for (const c of ["a", "Z", "0", " ", "é", "木", "😃"]) expect(fromCode(toCode(c))).toBe(c);
	});
});
