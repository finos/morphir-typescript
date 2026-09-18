// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { Decimal } from "decimal.js";
import { Just, Nothing } from "../maybe.ts";
import { equal } from "./equal.ts";

describe("equal", () => {
	test("primitives", () => {
		expect(equal(1, 1)).toBe(true);
		expect(equal(1, 2)).toBe(false);
		expect(equal("a", "a")).toBe(true);
		expect(equal(Number.NaN, Number.NaN)).toBe(false);
		expect(equal(true, false)).toBe(false);
		expect(equal(1n, 1n)).toBe(true);
	});
	test("arrays and tuples", () => {
		expect(equal([1, [2, 3]], [1, [2, 3]])).toBe(true);
		expect(equal([1, 2], [1, 2, 3])).toBe(false);
	});
	test("tagged unions and records", () => {
		expect(equal(Just(1), Just(1))).toBe(true);
		expect(equal(Just(1), Nothing)).toBe(false);
		expect(equal({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(true);
		expect(equal({ a: 1 }, { a: 1, b: 2 })).toBe(false);
	});
	test("Decimal by numeric value", () => {
		expect(equal(new Decimal("1.50"), new Decimal("1.5"))).toBe(true);
		expect(equal(new Decimal("1.5"), new Decimal("1.6"))).toBe(false);
	});
	test("functions throw", () => {
		expect(() =>
			equal(
				() => 1,
				() => 1,
			),
		).toThrow();
	});
});
