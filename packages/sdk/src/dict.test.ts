// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	type Dict,
	diff,
	empty,
	filter,
	foldl,
	foldr,
	fromList,
	get,
	insert,
	intersect,
	isEmpty,
	keys,
	map,
	member,
	merge,
	partition,
	remove,
	singleton,
	size,
	toList,
	union,
	update,
	values,
} from "./dict.ts";
import { equal } from "./internal/equal.ts";
import { Just, type Maybe, Nothing } from "./maybe.ts";

const abc = fromList<string, number>([
	["b", 2],
	["a", 1],
	["c", 3],
]);

describe("Dict", () => {
	test("empty and singleton", () => {
		expect(toList(empty())).toEqual([]);
		expect(isEmpty(empty())).toBe(true);
		expect(toList(singleton("k", 1))).toEqual([["k", 1]]);
		expect(isEmpty(singleton("k", 1))).toBe(false);
		expect(empty().kind).toBe("Dict");
	});

	test("fromList sorts and later entries win", () => {
		expect(
			toList(
				fromList([
					[2, "b"],
					[1, "a"],
				]),
			),
		).toEqual([
			[1, "a"],
			[2, "b"],
		]);
		expect(
			toList(
				fromList([
					[1, "first"],
					[1, "second"],
				]),
			),
		).toEqual([[1, "second"]]);
	});

	test("string keys sort by code unit", () => {
		const d = fromList<string, number>([
			["b", 1],
			["B", 2],
			["a", 3],
			["A", 4],
			["ab", 5],
		]);
		expect(keys(d)).toEqual(["A", "B", "a", "ab", "b"]);
	});

	test("tuple keys", () => {
		type Key = readonly [number, string];
		const d = fromList<Key, string>([
			[[2, "a"], "x"],
			[[1, "b"], "y"],
			[[1, "a"], "z"],
		]);
		expect(keys(d)).toEqual([
			[1, "a"],
			[1, "b"],
			[2, "a"],
		]);
		expect(get([1, "a"], d)).toEqual(Just("z"));
		expect(get([1, "c"], d)).toEqual(Nothing);
		expect(member([2, "a"], d)).toBe(true);
	});

	test("insert replaces existing key and does not mutate", () => {
		const d1 = insert("a", 10, abc);
		expect(toList(d1)).toEqual([
			["a", 10],
			["b", 2],
			["c", 3],
		]);
		expect(toList(abc)).toEqual([
			["a", 1],
			["b", 2],
			["c", 3],
		]);
		expect(toList(insert("d", 4, abc))).toEqual([
			["a", 1],
			["b", 2],
			["c", 3],
			["d", 4],
		]);
		expect(toList(insert("0", 0, abc))).toEqual([
			["0", 0],
			["a", 1],
			["b", 2],
			["c", 3],
		]);
	});

	test("get and member", () => {
		expect(get("b", abc)).toEqual(Just(2));
		expect(get("z", abc)).toEqual(Nothing);
		expect(get("a", empty<string, number>())).toEqual(Nothing);
		expect(member("c", abc)).toBe(true);
		expect(member("z", abc)).toBe(false);
	});

	test("remove", () => {
		expect(toList(remove("b", abc))).toEqual([
			["a", 1],
			["c", 3],
		]);
		expect(remove("z", abc)).toEqual(abc);
		expect(size(abc)).toBe(3);
	});

	test("update inserts, changes and removes", () => {
		const inc = (m: Maybe<number>): Maybe<number> => (m.kind === "Just" ? Just(m.value + 1) : Just(0));
		expect(toList(update("a", inc, abc))).toEqual([
			["a", 2],
			["b", 2],
			["c", 3],
		]);
		expect(toList(update("d", inc, abc))).toEqual([
			["a", 1],
			["b", 2],
			["c", 3],
			["d", 0],
		]);
		expect(toList(update("b", () => Nothing, abc))).toEqual([
			["a", 1],
			["c", 3],
		]);
		expect(update("z", () => Nothing, abc)).toEqual(abc);
	});

	test("size, keys, values", () => {
		expect(size(empty())).toBe(0);
		expect(size(abc)).toBe(3);
		expect(keys(abc)).toEqual(["a", "b", "c"]);
		expect(values(abc)).toEqual([1, 2, 3]);
	});

	test("map", () => {
		expect(toList(map((k: string, v: number) => `${k}${v}`, abc))).toEqual([
			["a", "a1"],
			["b", "b2"],
			["c", "c3"],
		]);
	});

	test("foldl ascending and foldr descending", () => {
		expect(foldl((k: string, _v: number, acc: string) => acc + k, "", abc)).toBe("abc");
		expect(foldr((k: string, _v: number, acc: string) => acc + k, "", abc)).toBe("cba");
		expect(foldl((_k: string, v: number, acc: number) => acc + v, 0, abc)).toBe(6);
	});

	test("filter and partition", () => {
		expect(toList(filter((_k: string, v: number) => v % 2 === 1, abc))).toEqual([
			["a", 1],
			["c", 3],
		]);
		const [odd, even] = partition((_k: string, v: number) => v % 2 === 1, abc);
		expect(toList(odd)).toEqual([
			["a", 1],
			["c", 3],
		]);
		expect(toList(even)).toEqual([["b", 2]]);
	});

	test("union prefers the first dict", () => {
		const other = fromList<string, number>([
			["b", 20],
			["d", 4],
		]);
		expect(toList(union(abc, other))).toEqual([
			["a", 1],
			["b", 2],
			["c", 3],
			["d", 4],
		]);
		expect(toList(union(other, abc))).toEqual([
			["a", 1],
			["b", 20],
			["c", 3],
			["d", 4],
		]);
	});

	test("intersect keeps values from the first dict", () => {
		const other = fromList<string, string>([
			["b", "x"],
			["c", "y"],
			["d", "z"],
		]);
		expect(toList(intersect(abc, other))).toEqual([
			["b", 2],
			["c", 3],
		]);
	});

	test("diff removes keys found in the second dict", () => {
		const other = fromList<string, string>([
			["b", "x"],
			["z", "y"],
		]);
		expect(toList(diff(abc, other))).toEqual([
			["a", 1],
			["c", 3],
		]);
	});

	test("merge visits keys in ascending order (elm docs example)", () => {
		const left = fromList<string, number>([
			["a", 1],
			["c", 3],
			["b", 2],
		]);
		const right = fromList<string, string>([
			["b", "B"],
			["d", "D"],
			["c", "C"],
		]);
		const result = merge(
			(k: string, a: number, acc: string[]) => [...acc, `left ${k} ${a}`],
			(k: string, a: number, b: string, acc: string[]) => [...acc, `both ${k} ${a} ${b}`],
			(k: string, b: string, acc: string[]) => [...acc, `right ${k} ${b}`],
			left,
			right,
			[] as string[],
		);
		expect(result).toEqual(["left a 1", "both b 2 B", "both c 3 C", "right d D"]);
	});

	test("structural equality is independent of insertion order", () => {
		const d1 = insert("c", 3, insert("a", 1, insert("b", 2, empty<string, number>())));
		const d2 = insert("a", 1, insert("b", 2, insert("c", 3, empty<string, number>())));
		expect(equal(d1, d2)).toBe(true);
		expect(equal(d1, abc)).toBe(true);
		expect(equal(d1, insert("a", 9, d2))).toBe(false);
		const typed: Dict<string, number> = d1;
		expect(typed.entries).toEqual([
			["a", 1],
			["b", 2],
			["c", 3],
		]);
	});
});
