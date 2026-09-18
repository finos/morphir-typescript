// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { andThen, hasValue, Just, map, map2, map3, map4, map5, Nothing, withDefault } from "./maybe.ts";

describe("Maybe", () => {
	test("withDefault", () => {
		expect(withDefault(100, Just(42))).toBe(42);
		expect(withDefault(100, Nothing)).toBe(100);
	});
	test("map", () => {
		expect(map(Math.sqrt, Just(9))).toEqual(Just(3));
		expect(map(Math.sqrt, Nothing)).toEqual(Nothing);
	});
	test("map2..map5", () => {
		const add = (a: number, b: number) => a + b;
		expect(map2(add, Just(3), Just(4))).toEqual(Just(7));
		expect(map2(add, Just(3), Nothing)).toEqual(Nothing);
		expect(map3((a: number, b: number, c: number) => a + b + c, Just(1), Just(2), Just(3))).toEqual(Just(6));
		expect(map4((a: number, b: number, c: number, d: number) => a + b + c + d, Just(1), Just(2), Just(3), Just(4))).toEqual(Just(10));
		expect(map5((a: number, b: number, c: number, d: number, e: number) => a + b + c + d + e, Just(1), Just(2), Just(3), Just(4), Just(5))).toEqual(Just(15));
		expect(map5((a: number, b: number, c: number, d: number, e: number) => a + b + c + d + e, Just(1), Just(2), Just(3), Just(4), Nothing)).toEqual(Nothing);
	});
	test("andThen", () => {
		const toValidMonth = (m: number) => (m >= 1 && m <= 12 ? Just(m) : Nothing);
		expect(andThen(toValidMonth, Just(5))).toEqual(Just(5));
		expect(andThen(toValidMonth, Just(13))).toEqual(Nothing);
		expect(andThen(toValidMonth, Nothing)).toEqual(Nothing);
	});
	test("hasValue", () => {
		expect(hasValue(Just(1))).toBe(true);
		expect(hasValue(Nothing)).toBe(false);
	});
	test("Nothing is frozen", () => {
		expect(Object.isFrozen(Nothing)).toBe(true);
	});
});
