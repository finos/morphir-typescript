// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { compare } from "./compare.ts";

describe("compare", () => {
	test("numbers", () => {
		expect(compare(1, 2)).toBe("LT");
		expect(compare(2, 2)).toBe("EQ");
		expect(compare(3, 2)).toBe("GT");
	});
	test("strings by code unit", () => {
		expect(compare("a", "b")).toBe("LT");
		expect(compare("B", "a")).toBe("LT");
		expect(compare("abc", "ab")).toBe("GT");
	});
	test("tuples and lists lexicographically", () => {
		expect(compare([1, "b"], [1, "a"])).toBe("GT");
		expect(compare([1, "a"], [2, "a"])).toBe("LT");
		expect(compare([1, 2], [1, 2, 3])).toBe("LT");
		expect(compare([], [])).toBe("EQ");
	});
	test("mixed kinds throw", () => {
		expect(() => compare(1 as unknown as string, "a")).toThrow();
		expect(() => compare({} as unknown as number, 1)).toThrow();
	});
});
