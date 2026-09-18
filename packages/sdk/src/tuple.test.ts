// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { first, mapBoth, mapFirst, mapSecond, pair, second } from "./tuple.ts";

describe("Tuple", () => {
	test("pair, first, second", () => {
		expect(pair(3, 4)).toEqual([3, 4]);
		expect(first([3, 4])).toBe(3);
		expect(second([3, 4])).toBe(4);
	});
	test("mapFirst, mapSecond, mapBoth", () => {
		expect(mapFirst((s: string) => s.toUpperCase(), ["a", 1])).toEqual(["A", 1]);
		expect(mapSecond((n: number) => n + 1, ["a", 1])).toEqual(["a", 2]);
		expect(
			mapBoth(
				(s: string) => s.toUpperCase(),
				(n: number) => n + 1,
				["a", 1],
			),
		).toEqual(["A", 2]);
	});
});
