// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import * as Basics from "./basics.ts";

describe("Basics", () => {
	test("arithmetic", () => {
		expect(Basics.add(1, 2)).toBe(3);
		expect(Basics.subtract(5, 2)).toBe(3);
		expect(Basics.multiply(3, 4)).toBe(12);
		expect(Basics.divide(7, 2)).toBe(3.5);
		expect(Basics.divide(1, 0)).toBe(Number.POSITIVE_INFINITY);
		expect(Basics.integerDivide(7, 2)).toBe(3);
		expect(Basics.integerDivide(-7, 2)).toBe(-3);
		expect(Basics.integerDivide(7, 0)).toBe(0);
		expect(Basics.power(2, 10)).toBe(1024);
		expect(Basics.negate(3)).toBe(-3);
		expect(Basics.abs(-3)).toBe(3);
	});
	test("modBy and remainderBy", () => {
		expect(Basics.modBy(4, -1)).toBe(3);
		expect(Basics.modBy(4, 5)).toBe(1);
		expect(Basics.remainderBy(4, -1)).toBe(-1);
		expect(() => Basics.modBy(0, 1)).toThrow();
		expect(Basics.remainderBy(0, 1)).toBeNaN();
	});
	test("rounding", () => {
		expect(Basics.round(1.5)).toBe(2);
		expect(Basics.round(-1.5)).toBe(-1);
		expect(Basics.round(2.4)).toBe(2);
		expect(Basics.floor(-1.2)).toBe(-2);
		expect(Basics.ceiling(1.2)).toBe(2);
		expect(Basics.truncate(-1.7)).toBe(-1);
		expect(Basics.toFloat(3)).toBe(3);
	});
	test("comparison over comparables", () => {
		expect(Basics.compare(1, 2)).toBe("LT");
		expect(Basics.compare("b", "a")).toBe("GT");
		expect(Basics.lessThan(1, 2)).toBe(true);
		expect(Basics.greaterThanOrEqual(2, 2)).toBe(true);
		expect(Basics.lessThanOrEqual([1, "a"], [1, "b"])).toBe(true);
		expect(Basics.greaterThan("b", "a")).toBe(true);
		expect(Basics.max(1, 2)).toBe(2);
		expect(Basics.min("a", "b")).toBe("a");
		expect(Basics.clamp(0, 10, 15)).toBe(10);
		expect(Basics.clamp(0, 10, -5)).toBe(0);
		expect(Basics.clamp(0, 10, 5)).toBe(5);
	});
	test("equality", () => {
		expect(Basics.equal([1, 2], [1, 2])).toBe(true);
		expect(Basics.notEqual([1, 2], [1, 3])).toBe(true);
	});
	test("booleans", () => {
		expect(Basics.not(true)).toBe(false);
		expect(Basics.and(true, false)).toBe(false);
		expect(Basics.or(true, false)).toBe(true);
		expect(Basics.xor(true, true)).toBe(false);
		expect(Basics.xor(true, false)).toBe(true);
	});
	test("append", () => {
		expect(Basics.append("ab", "cd")).toBe("abcd");
		expect(Basics.append([1], [2, 3])).toEqual([1, 2, 3]);
	});
	test("floats", () => {
		expect(Basics.isNaN(Number.NaN)).toBe(true);
		expect(Basics.isInfinite(Number.NEGATIVE_INFINITY)).toBe(true);
		expect(Basics.sqrt(16)).toBe(4);
		expect(Basics.logBase(10, 1000)).toBeCloseTo(3);
		expect(Basics.logBase(2, 256)).toBeCloseTo(8);
		expect(Basics.e).toBe(Math.E);
		expect(Basics.pi).toBe(Math.PI);
		expect(Basics.cos(0)).toBe(1);
		expect(Basics.sin(0)).toBe(0);
		expect(Basics.tan(0)).toBe(0);
		expect(Basics.acos(1)).toBe(0);
		expect(Basics.asin(0)).toBe(0);
		expect(Basics.atan(0)).toBe(0);
		expect(Basics.atan2(1, 1)).toBeCloseTo(Math.PI / 4);
	});
	test("angles and polar", () => {
		expect(Basics.degrees(180)).toBeCloseTo(Math.PI);
		expect(Basics.radians(Math.PI)).toBe(Math.PI);
		expect(Basics.turns(0.5)).toBeCloseTo(Math.PI);
		const [r, theta] = Basics.toPolar([3, 4]);
		expect(r).toBe(5);
		expect(theta).toBeCloseTo(Math.atan2(4, 3));
		const [x, y] = Basics.fromPolar([5, Math.atan2(4, 3)]);
		expect(x).toBeCloseTo(3);
		expect(y).toBeCloseTo(4);
	});
	test("functions", () => {
		expect(Basics.identity(7)).toBe(7);
		expect(Basics.always(1, "ignored")).toBe(1);
		const inc = (n: number) => n + 1;
		const dbl = (n: number) => n * 2;
		expect(Basics.composeLeft(inc, dbl)(3)).toBe(7);
		expect(Basics.composeRight(inc, dbl)(3)).toBe(8);
		expect(() => Basics.never(undefined as never)).toThrow();
	});
});
