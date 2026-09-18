// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { equal } from "./internal/equal.ts";
import {
	diff,
	empty,
	filter,
	foldl,
	foldr,
	fromList,
	insert,
	intersect,
	isEmpty,
	type Set as MorphirSet,
	map,
	member,
	partition,
	remove,
	singleton,
	size,
	toList,
	union,
} from "./set.ts";

const s123 = fromList([3, 1, 2]);

describe("Set", () => {
	test("empty and singleton", () => {
		expect(toList(empty())).toEqual([]);
		expect(isEmpty(empty())).toBe(true);
		expect(toList(singleton(5))).toEqual([5]);
		expect(isEmpty(singleton(5))).toBe(false);
		expect(empty().kind).toBe("Set");
	});

	test("fromList sorts and dedups", () => {
		expect(toList(fromList([3, 1, 2, 1, 3]))).toEqual([1, 2, 3]);
		expect(toList(fromList(["b", "B", "a", "A", "ab"]))).toEqual(["A", "B", "a", "ab", "b"]);
	});

	test("tuple elements", () => {
		type Elem = readonly [number, string];
		const s = fromList<Elem>([
			[2, "a"],
			[1, "b"],
			[1, "a"],
			[1, "a"],
		]);
		expect(toList(s)).toEqual([
			[1, "a"],
			[1, "b"],
			[2, "a"],
		]);
		expect(member([1, "b"], s)).toBe(true);
		expect(member([1, "c"], s)).toBe(false);
	});

	test("insert is idempotent and does not mutate", () => {
		expect(toList(insert(2, s123))).toEqual([1, 2, 3]);
		expect(toList(insert(0, s123))).toEqual([0, 1, 2, 3]);
		expect(toList(insert(4, s123))).toEqual([1, 2, 3, 4]);
		expect(toList(s123)).toEqual([1, 2, 3]);
	});

	test("remove", () => {
		expect(toList(remove(2, s123))).toEqual([1, 3]);
		expect(remove(9, s123)).toEqual(s123);
	});

	test("member and size", () => {
		expect(member(3, s123)).toBe(true);
		expect(member(4, s123)).toBe(false);
		expect(size(s123)).toBe(3);
		expect(size(empty())).toBe(0);
	});

	test("map re-sorts and dedups", () => {
		expect(toList(map((n: number) => -n, s123))).toEqual([-3, -2, -1]);
		expect(toList(map((n: number) => n % 2, s123))).toEqual([0, 1]);
	});

	test("foldl ascending and foldr descending", () => {
		expect(foldl((n: number, acc: string) => acc + n, "", s123)).toBe("123");
		expect(foldr((n: number, acc: string) => acc + n, "", s123)).toBe("321");
	});

	test("filter and partition", () => {
		expect(toList(filter((n: number) => n > 1, s123))).toEqual([2, 3]);
		const [big, small] = partition((n: number) => n > 1, s123);
		expect(toList(big)).toEqual([2, 3]);
		expect(toList(small)).toEqual([1]);
	});

	test("union, intersect, diff", () => {
		const s234 = fromList([4, 3, 2]);
		expect(toList(union(s123, s234))).toEqual([1, 2, 3, 4]);
		expect(toList(intersect(s123, s234))).toEqual([2, 3]);
		expect(toList(diff(s123, s234))).toEqual([1]);
		expect(toList(diff(s234, s123))).toEqual([4]);
		expect(toList(union(empty(), s123))).toEqual([1, 2, 3]);
	});

	test("structural equality is independent of insertion order", () => {
		const a = insert(1, insert(3, insert(2, empty<number>())));
		const b = insert(3, insert(2, insert(1, empty<number>())));
		expect(equal(a, b)).toBe(true);
		expect(equal(a, s123)).toBe(true);
		expect(equal(a, insert(4, b))).toBe(false);
		const typed: MorphirSet<number> = a;
		expect(typed.entries).toEqual([1, 2, 3]);
	});
});
