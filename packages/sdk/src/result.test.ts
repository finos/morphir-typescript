// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { Just, Nothing } from "./maybe.ts";
import { andThen, Err, fromMaybe, map, map2, map3, map4, map5, mapError, Ok, toMaybe, withDefault } from "./result.ts";

describe("Result", () => {
	test("withDefault", () => {
		expect(withDefault(0, Ok(123))).toBe(123);
		expect(withDefault(0, Err("no"))).toBe(0);
	});
	test("map and mapError", () => {
		expect(map(Math.sqrt, Ok(4))).toEqual(Ok(2));
		expect(map(Math.sqrt, Err("bad input"))).toEqual(Err("bad input"));
		expect(mapError((e: string) => e.toUpperCase(), Err("bad"))).toEqual(Err("BAD"));
		expect(mapError((e: string) => e.toUpperCase(), Ok(1))).toEqual(Ok(1));
	});
	test("map2..map5", () => {
		const add = (a: number, b: number) => a + b;
		expect(map2(add, Ok(1), Ok(2))).toEqual(Ok(3));
		expect(map2(add, Err("x"), Ok(2))).toEqual(Err("x"));
		expect(map2(add, Ok(1), Err("y"))).toEqual(Err("y"));
		expect(map3((a: number, b: number, c: number) => a + b + c, Ok(1), Ok(2), Ok(3))).toEqual(Ok(6));
		expect(map4((a: number, b: number, c: number, d: number) => a + b + c + d, Ok(1), Ok(2), Ok(3), Ok(4))).toEqual(Ok(10));
		expect(map5((a: number, b: number, c: number, d: number, e: number) => a + b + c + d + e, Ok(1), Ok(2), Ok(3), Ok(4), Ok(5))).toEqual(Ok(15));
	});
	test("andThen", () => {
		const toValidMonth = (m: number) => (m >= 1 && m <= 12 ? Ok(m) : Err("month out of range"));
		expect(andThen(toValidMonth, Ok(5))).toEqual(Ok(5));
		expect(andThen(toValidMonth, Ok(13))).toEqual(Err("month out of range"));
		expect(andThen(toValidMonth, Err("parse"))).toEqual(Err("parse"));
	});
	test("toMaybe and fromMaybe", () => {
		expect(toMaybe(Ok(1))).toEqual(Just(1));
		expect(toMaybe(Err("e"))).toEqual(Nothing);
		expect(fromMaybe("e", Just(1))).toEqual(Ok(1));
		expect(fromMaybe("e", Nothing)).toEqual(Err("e"));
	});
});
