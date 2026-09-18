// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	all,
	any,
	append,
	concat,
	concatMap,
	cons,
	drop,
	filter,
	filterMap,
	foldl,
	foldr,
	head,
	indexedMap,
	innerJoin,
	intersperse,
	isEmpty,
	leftJoin,
	length,
	map,
	map2,
	map3,
	map4,
	map5,
	maximum,
	member,
	minimum,
	partition,
	product,
	range,
	repeat,
	reverse,
	singleton,
	sort,
	sortBy,
	sortWith,
	sum,
	tail,
	take,
	unzip,
} from "./list.ts";
import { Just, type Maybe, Nothing } from "./maybe.ts";

const isEven = (n: number) => n % 2 === 0;

describe("List", () => {
	describe("create", () => {
		test("singleton", () => {
			expect(singleton(1234)).toEqual([1234]);
			expect(singleton("hi")).toEqual(["hi"]);
		});
		test("repeat", () => {
			expect(repeat(3, 0)).toEqual([0, 0, 0]);
			expect(repeat(0, "x")).toEqual([]);
			expect(repeat(-2, "x")).toEqual([]);
		});
		test("range is inclusive", () => {
			expect(range(3, 6)).toEqual([3, 4, 5, 6]);
			expect(range(3, 3)).toEqual([3]);
			expect(range(6, 3)).toEqual([]);
			expect(range(3, 2)).toEqual([]);
		});
		test("cons does not mutate", () => {
			const xs = [2, 3];
			expect(cons(1, xs)).toEqual([1, 2, 3]);
			expect(xs).toEqual([2, 3]);
			expect(cons(1, [])).toEqual([1]);
		});
	});

	describe("transform", () => {
		test("map", () => {
			expect(map(Math.sqrt, [1, 4, 9])).toEqual([1, 2, 3]);
			expect(map((x: number) => x + 1, [])).toEqual([]);
		});
		test("indexedMap gives index first", () => {
			expect(indexedMap((i: number, s: string) => `${i}:${s}`, ["Tom", "Sue", "Bob"])).toEqual(["0:Tom", "1:Sue", "2:Bob"]);
		});
		test("foldl takes element then accumulator", () => {
			expect(foldl((x: number, acc: number) => x + acc, 0, [1, 2, 3])).toBe(6);
			expect(foldl<number, readonly number[]>(cons, [], [1, 2, 3])).toEqual([3, 2, 1]);
			expect(foldl((x: number, acc: number) => acc - x, 10, [1, 2, 3])).toBe(4);
		});
		test("foldr", () => {
			expect(foldr((x: number, acc: number) => x + acc, 0, [1, 2, 3])).toBe(6);
			expect(foldr<number, readonly number[]>(cons, [], [1, 2, 3])).toEqual([1, 2, 3]);
			expect(foldr((x: number, acc: number) => acc - x, 10, [1, 2, 3])).toBe(4);
		});
		test("filter", () => {
			expect(filter(isEven, [1, 2, 3, 4, 5, 6])).toEqual([2, 4, 6]);
			expect(filter(isEven, [])).toEqual([]);
		});
		test("filterMap", () => {
			const toInt = (s: string): Maybe<number> => (/^-?\d+$/.test(s) ? Just(Number(s)) : Nothing);
			expect(filterMap(toInt, ["3", "hi", "12", "4th", "May"])).toEqual([3, 12]);
			expect(filterMap(toInt, [])).toEqual([]);
		});
	});

	describe("utilities", () => {
		test("length", () => {
			expect(length([1, 2, 3])).toBe(3);
			expect(length([])).toBe(0);
		});
		test("reverse does not mutate", () => {
			const xs = [1, 2, 3, 4];
			expect(reverse(xs)).toEqual([4, 3, 2, 1]);
			expect(xs).toEqual([1, 2, 3, 4]);
		});
		test("member uses structural equality", () => {
			expect(member(9, [1, 2, 3, 4])).toBe(false);
			expect(member(4, [1, 2, 3, 4])).toBe(true);
			expect(member([1, 2], [[0], [1, 2]])).toBe(true);
			expect(member({ kind: "Just", value: 1 }, [Just(1)])).toBe(true);
			expect(member(1, [])).toBe(false);
		});
		test("all", () => {
			expect(all(isEven, [2, 4])).toBe(true);
			expect(all(isEven, [2, 3])).toBe(false);
			expect(all(isEven, [])).toBe(true);
		});
		test("any", () => {
			expect(any(isEven, [2, 3])).toBe(true);
			expect(any(isEven, [1, 3])).toBe(false);
			expect(any(isEven, [])).toBe(false);
		});
		test("maximum", () => {
			expect(maximum([1, 4, 2])).toEqual(Just(4));
			expect(maximum([])).toEqual(Nothing);
			expect(maximum(["b", "c", "a"])).toEqual(Just("c"));
			expect(
				maximum([
					[1, 2],
					[1, 3],
					[0, 9],
				] as const),
			).toEqual(Just([1, 3]));
		});
		test("minimum", () => {
			expect(minimum([3, 2, 1])).toEqual(Just(1));
			expect(minimum([])).toEqual(Nothing);
			expect(minimum(["b", "c", "a"])).toEqual(Just("a"));
			expect(
				minimum([
					[1, 2],
					[1, 3],
					[0, 9],
				] as const),
			).toEqual(Just([0, 9]));
		});
		test("sum", () => {
			expect(sum([1, 2, 3])).toBe(6);
			expect(sum([1, 1, 1])).toBe(3);
			expect(sum([])).toBe(0);
		});
		test("product", () => {
			expect(product([2, 2, 2])).toBe(8);
			expect(product([3, 3, 3])).toBe(27);
			expect(product([])).toBe(1);
		});
	});

	describe("combine", () => {
		test("append", () => {
			expect(append([1, 1, 2], [3, 5, 8])).toEqual([1, 1, 2, 3, 5, 8]);
			expect(append([1, 1, 2], [])).toEqual([1, 1, 2]);
			expect(append([], [1])).toEqual([1]);
		});
		test("concat", () => {
			expect(concat([[1, 2], [3], [4, 5]])).toEqual([1, 2, 3, 4, 5]);
			expect(concat([])).toEqual([]);
		});
		test("concatMap", () => {
			expect(concatMap((x: number) => [x, x], [1, 2])).toEqual([1, 1, 2, 2]);
			expect(concatMap((_x: number) => [], [1, 2])).toEqual([]);
		});
		test("intersperse", () => {
			expect(intersperse("on", ["turtles", "turtles", "turtles"])).toEqual(["turtles", "on", "turtles", "on", "turtles"]);
			expect(intersperse(0, [1])).toEqual([1]);
			expect(intersperse(0, [])).toEqual([]);
		});
		test("map2 truncates to the shortest", () => {
			const add = (a: number, b: number) => a + b;
			expect(map2(add, [1, 2, 3], [1, 2, 3, 4])).toEqual([2, 4, 6]);
			expect(map2(add, [1, 2, 3], [1, 2])).toEqual([2, 4]);
			expect(map2((a: number, b: string) => [a, b] as const, [1, 2], ["a", "b"])).toEqual([
				[1, "a"],
				[2, "b"],
			]);
			expect(map2(add, [], [1])).toEqual([]);
		});
		test("map3", () => {
			expect(map3((a: number, b: number, c: number) => a + b + c, [1, 2], [10, 20, 30], [100, 200])).toEqual([111, 222]);
		});
		test("map4", () => {
			expect(map4((a: number, b: number, c: number, d: number) => a + b + c + d, [1, 2], [10, 20], [100, 200], [1000])).toEqual([1111]);
		});
		test("map5", () => {
			expect(map5((a: number, b: number, c: number, d: number, e: number) => a + b + c + d + e, [1], [10], [100], [1000], [10000, 1])).toEqual([11111]);
			expect(map5((a: number, b: number, c: number, d: number, e: number) => a + b + c + d + e, [1], [10], [100], [1000], [])).toEqual([]);
		});
	});

	describe("sort", () => {
		test("sort by compare, no mutation", () => {
			const xs = [3, 1, 5];
			expect(sort(xs)).toEqual([1, 3, 5]);
			expect(xs).toEqual([3, 1, 5]);
			expect(sort(["b", "a", "c"])).toEqual(["a", "b", "c"]);
			expect(sort([10, 9, 100])).toEqual([9, 10, 100]);
			expect(
				sort([
					[2, 1],
					[1, 2],
					[1, 1],
				] as const),
			).toEqual([
				[1, 1],
				[1, 2],
				[2, 1],
			]);
			expect(sort([])).toEqual([]);
		});
		test("sortBy is stable", () => {
			expect(sortBy((s: string) => s.length, ["mouse", "cat", "chuck", "cow", "alpha"])).toEqual(["cat", "cow", "mouse", "chuck", "alpha"]);
			expect(sortBy((s: string) => s, ["chuck", "alice", "bob"])).toEqual(["alice", "bob", "chuck"]);
			const people = [
				{ name: "b", age: 2 },
				{ name: "a", age: 1 },
			];
			expect(sortBy((p: { name: string; age: number }) => p.age, people)).toEqual([
				{ name: "a", age: 1 },
				{ name: "b", age: 2 },
			]);
		});
		test("sortWith uses Order", () => {
			const flippedComparison = (a: number, b: number) => (a < b ? "GT" : a > b ? "LT" : "EQ");
			expect(sortWith(flippedComparison, [1, 2, 3, 4, 5])).toEqual([5, 4, 3, 2, 1]);
			expect(sortWith((_a: number, _b: number) => "EQ", [3, 1, 2])).toEqual([3, 1, 2]);
		});
	});

	describe("deconstruct", () => {
		test("isEmpty", () => {
			expect(isEmpty([])).toBe(true);
			expect(isEmpty([1])).toBe(false);
		});
		test("head", () => {
			expect(head([1, 2, 3])).toEqual(Just(1));
			expect(head([])).toEqual(Nothing);
		});
		test("tail", () => {
			expect(tail([1, 2, 3])).toEqual(Just([2, 3]));
			expect(tail([1])).toEqual(Just([]));
			expect(tail([])).toEqual(Nothing);
		});
		test("take", () => {
			expect(take(2, [1, 2, 3, 4])).toEqual([1, 2]);
			expect(take(0, [1, 2])).toEqual([]);
			expect(take(-1, [1, 2])).toEqual([]);
			expect(take(5, [1, 2])).toEqual([1, 2]);
		});
		test("drop", () => {
			expect(drop(2, [1, 2, 3, 4])).toEqual([3, 4]);
			expect(drop(0, [1, 2])).toEqual([1, 2]);
			expect(drop(-1, [1, 2])).toEqual([1, 2]);
			expect(drop(5, [1, 2])).toEqual([]);
		});
		test("partition", () => {
			expect(partition((x: number) => x < 3, [0, 1, 2, 3, 4, 5])).toEqual([
				[0, 1, 2],
				[3, 4, 5],
			]);
			expect(partition(isEven, [0, 1, 2, 3, 4, 5])).toEqual([
				[0, 2, 4],
				[1, 3, 5],
			]);
			expect(partition(isEven, [])).toEqual([[], []]);
		});
		test("unzip", () => {
			expect(
				unzip([
					[0, true],
					[17, false],
					[1337, true],
				]),
			).toEqual([
				[0, 17, 1337],
				[true, false, true],
			]);
			expect(unzip([])).toEqual([[], []]);
		});
	});

	describe("joins (Morphir.SDK.List)", () => {
		const eq = (a: number, b: number) => a === b;
		test("inner filters left", () => {
			expect(innerJoin([1, 3], eq, [1, 2, 3])).toEqual([
				[1, 1],
				[3, 3],
			]);
		});
		test("inner filters right", () => {
			expect(innerJoin([1, 2, 3], eq, [1, 2])).toEqual([
				[1, 1],
				[2, 2],
			]);
		});
		test("inner filters both", () => {
			expect(innerJoin([1, 3], eq, [1, 2])).toEqual([[1, 1]]);
		});
		test("inner yields every matching pair", () => {
			expect(innerJoin([1, 1], eq, [1])).toEqual([
				[1, 1],
				[1, 1],
			]);
		});
		test("left outer keeps left", () => {
			expect(leftJoin([1, 3], eq, [1, 2])).toEqual([
				[1, Just(1)],
				[2, Nothing],
			]);
		});
		test("left outer yields every matching pair", () => {
			expect(leftJoin([1, 1, 3], eq, [1, 2])).toEqual([
				[1, Just(1)],
				[1, Just(1)],
				[2, Nothing],
			]);
		});
	});
});
