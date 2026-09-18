// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	type Aggregation,
	type Aggregator,
	aggregate,
	aggregateMap,
	aggregateMap2,
	aggregateMap3,
	aggregateMap4,
	averageOf,
	byKey,
	count,
	groupBy,
	maximumOf,
	minimumOf,
	sumOf,
	weightedAverageOf,
	withFilter,
} from "./aggregate.ts";
import * as Dict from "./dict.ts";
import { type Key0, key0, key2 } from "./key.ts";

type TestInput1 = { readonly key1: string; readonly key2: string; readonly value: number };

function input(k1: string, k2: string, value: number): TestInput1 {
	return { key1: k1, key2: k2, value };
}

const testDataSet: readonly TestInput1[] = [
	input("k1_1", "k2_1", 1),
	input("k1_1", "k2_1", 2),
	input("k1_1", "k2_2", 3),
	input("k1_1", "k2_2", 4),
	input("k1_2", "k2_1", 5),
	input("k1_2", "k2_1", 6),
	input("k1_2", "k2_2", 7),
	input("k1_2", "k2_2", 8),
];

const key1 = (a: TestInput1): string => a.key1;
const key2Of = (a: TestInput1): string => a.key2;
const value = (a: TestInput1): number => a.value;
const bothKeys = (a: TestInput1) => key2(key1, key2Of, a);

// The expected list: one pair per row of the data set, in order.
function rows(results: readonly number[]): readonly (readonly [TestInput1, number])[] {
	return testDataSet.map((a, i) => [a, results[i] ?? Number.NaN] as const);
}

describe("aggregateMap", () => {
	test("aggregate by single key", () => {
		expect(aggregateMap(byKey(key1, sumOf(value)), (totalValue, a) => [a, totalValue / a.value] as const, testDataSet)).toEqual(
			rows([10 / 1, 10 / 2, 10 / 3, 10 / 4, 26 / 5, 26 / 6, 26 / 7, 26 / 8]),
		);
	});
	test("aggregate by composite key", () => {
		expect(aggregateMap(byKey(bothKeys, sumOf(value)), (totalValue, a) => [a, totalValue / a.value] as const, testDataSet)).toEqual(
			rows([3 / 1, 3 / 2, 7 / 3, 7 / 4, 11 / 5, 11 / 6, 15 / 7, 15 / 8]),
		);
	});
	test("aggregate by no key and filter", () => {
		expect(
			aggregateMap(
				withFilter((a) => a.value > 3, sumOf(value)),
				(totalValue, a) => [a, totalValue / a.value] as const,
				testDataSet,
			),
		).toEqual(rows([30 / 1, 30 / 2, 30 / 3, 30 / 4, 30 / 5, 30 / 6, 30 / 7, 30 / 8]));
	});
	test("aggregate 2", () => {
		expect(
			aggregateMap2(
				byKey(key1, sumOf(value)),
				byKey(key2Of, maximumOf(value)),
				(totalValue, maxValue, a) => [a, (totalValue * maxValue) / a.value] as const,
				testDataSet,
			),
		).toEqual(rows([(10 * 6) / 1, (10 * 6) / 2, (10 * 8) / 3, (10 * 8) / 4, (26 * 6) / 5, (26 * 6) / 6, (26 * 8) / 7, (26 * 8) / 8]));
	});
	test("aggregate 3", () => {
		expect(
			aggregateMap3(
				byKey(key1, sumOf(value)),
				byKey(key2Of, maximumOf(value)),
				byKey(bothKeys, minimumOf(value)),
				(totalValue, maxValue, minValue, a) => [a, (totalValue * maxValue) / a.value + minValue] as const,
				testDataSet,
			),
		).toEqual(
			rows([(10 * 6) / 1 + 1, (10 * 6) / 2 + 1, (10 * 8) / 3 + 3, (10 * 8) / 4 + 3, (26 * 6) / 5 + 5, (26 * 6) / 6 + 5, (26 * 8) / 7 + 7, (26 * 8) / 8 + 7]),
		);
	});
	test("aggregate 4", () => {
		expect(
			aggregateMap4(
				byKey(key1, sumOf(value)),
				byKey(key2Of, maximumOf(value)),
				byKey(bothKeys, minimumOf(value)),
				byKey(bothKeys, averageOf(value)),
				(totalValue, maxValue, minValue, average, a) => [a, (totalValue * maxValue) / a.value + minValue + average] as const,
				testDataSet,
			),
		).toEqual(
			rows([
				(10 * 6) / 1 + 1 + 1.5,
				(10 * 6) / 2 + 1 + 1.5,
				(10 * 8) / 3 + 3 + 3.5,
				(10 * 8) / 4 + 3 + 3.5,
				(26 * 6) / 5 + 5 + 5.5,
				(26 * 6) / 6 + 5 + 5.5,
				(26 * 8) / 7 + 7 + 7.5,
				(26 * 8) / 8 + 7 + 7.5,
			]),
		);
	});
	test("count by single key", () => {
		expect(aggregateMap(byKey(key1, count), (totalValue, a: TestInput1) => [a, totalValue] as const, testDataSet)).toEqual(rows([4, 4, 4, 4, 4, 4, 4, 4]));
	});
	test("sum by single key", () => {
		expect(aggregateMap(byKey(key1, sumOf(value)), (totalValue, a) => [a, totalValue] as const, testDataSet)).toEqual(rows([10, 10, 10, 10, 26, 26, 26, 26]));
	});
	test("avg by single key", () => {
		expect(aggregateMap(byKey(key1, averageOf(value)), (totalValue, a) => [a, totalValue] as const, testDataSet)).toEqual(
			rows([2.5, 2.5, 2.5, 2.5, 6.5, 6.5, 6.5, 6.5]),
		);
	});
	test("min by single key", () => {
		expect(aggregateMap(byKey(key1, minimumOf(value)), (totalValue, a) => [a, totalValue] as const, testDataSet)).toEqual(rows([1, 1, 1, 1, 5, 5, 5, 5]));
	});
	test("max by single key", () => {
		expect(aggregateMap(byKey(key1, maximumOf(value)), (totalValue, a) => [a, totalValue] as const, testDataSet)).toEqual(rows([4, 4, 4, 4, 8, 8, 8, 8]));
	});
	test("weighted average by single key", () => {
		expect(aggregateMap(byKey(key1, weightedAverageOf(value, value)), (totalValue, a) => [a, totalValue] as const, testDataSet)).toEqual(
			rows([3, 3, 3, 3, 174 / 26, 174 / 26, 174 / 26, 174 / 26]),
		);
	});
	test("a row whose group is filtered out completely gets 0", () => {
		expect(
			aggregateMap(
				withFilter((a) => a.key1 === "k1_2", byKey(key1, sumOf(value))),
				(totalValue, a) => [a, totalValue] as const,
				testDataSet,
			),
		).toEqual(rows([0, 0, 0, 0, 26, 26, 26, 26]));
	});
	test("the empty list maps to the empty list", () => {
		expect(aggregateMap(sumOf(value), (totalValue, a) => [a, totalValue] as const, [])).toEqual([]);
	});
});

describe("operators", () => {
	test("an operator has no key and no filter", () => {
		const agg: Aggregation<TestInput1, Key0> = count;
		expect(agg.key(input("a", "b", 1))).toBe(key0(null));
		expect(agg.filter(input("a", "b", 1))).toBe(true);
		expect(agg.operator).toEqual({ kind: "Count" });
		expect(sumOf(value).operator).toEqual({ kind: "Sum", getValue: value });
		expect(averageOf(value).operator).toEqual({ kind: "Avg", getValue: value });
		expect(minimumOf(value).operator).toEqual({ kind: "Min", getValue: value });
		expect(maximumOf(value).operator).toEqual({ kind: "Max", getValue: value });
		expect(weightedAverageOf(value, value).operator).toEqual({ kind: "WAvg", getWeight: value, getValue: value });
	});
	test("byKey changes the key and keeps the rest", () => {
		const filtered = withFilter((a: TestInput1) => a.value < 0, count);
		const keyed = byKey(key1, filtered);
		expect(keyed.key).toBe(key1);
		expect(keyed.filter).toBe(filtered.filter);
		expect(keyed.operator).toBe(filtered.operator);
	});
	test("withFilter replaces the filter and keeps the rest", () => {
		const keyed = byKey(key1, sumOf(value));
		const negative = (a: TestInput1): boolean => a.value < 0;
		const filtered = withFilter(negative, keyed);
		expect(filtered.filter).toBe(negative);
		expect(filtered.key).toBe(key1);
		expect(filtered.operator).toBe(keyed.operator);
		expect(keyed.filter(input("a", "b", 1))).toBe(true);
	});
});

describe("groupBy", () => {
	test("groups by a single key", () => {
		expect(groupBy(key1, testDataSet)).toEqual(
			Dict.fromList([
				["k1_1", testDataSet.slice(0, 4)],
				["k1_2", testDataSet.slice(4)],
			]),
		);
	});
	test("groups by a composite key", () => {
		const grouped = groupBy(bothKeys, testDataSet);
		expect(Dict.keys(grouped)).toEqual([
			["k1_1", "k2_1"],
			["k1_1", "k2_2"],
			["k1_2", "k2_1"],
			["k1_2", "k2_2"],
		]);
		expect(Dict.get(["k1_2", "k2_1"] as const, grouped)).toEqual({ kind: "Just", value: [input("k1_2", "k2_1", 5), input("k1_2", "k2_1", 6)] });
	});
	test("the empty list gives the empty dict", () => {
		expect(groupBy(key1, [])).toEqual(Dict.empty());
	});
});

describe("aggregate", () => {
	const summarise = (key: string, inputs: Aggregator<TestInput1, Key0>) => ({
		key,
		count: inputs(withFilter((a: TestInput1) => a.value < 7, count)),
		sum: inputs(sumOf(value)),
		max: inputs(maximumOf(value)),
		min: inputs(minimumOf(value)),
	});

	test("the doc example", () => {
		expect(aggregate(summarise, groupBy(key1, testDataSet))).toEqual([
			{ key: "k1_1", count: 4, sum: 10, max: 4, min: 1 },
			{ key: "k1_2", count: 2, sum: 26, max: 8, min: 5 },
		]);
	});
	test("an aggregator gives 0 when the filter removes every item", () => {
		expect(
			aggregate(
				(key: string, inputs: Aggregator<TestInput1, Key0>) => [key, inputs(withFilter((a) => a.value > 100, averageOf(value)))] as const,
				groupBy(key1, testDataSet),
			),
		).toEqual([
			["k1_1", 0],
			["k1_2", 0],
		]);
	});
	test("averages and weighted averages per group", () => {
		expect(
			aggregate(
				(key: string, inputs: Aggregator<TestInput1, Key0>) => [key, inputs(averageOf(value)), inputs(weightedAverageOf(value, value))] as const,
				groupBy(key2Of, testDataSet),
			),
		).toEqual([
			["k2_1", 3.5, 66 / 14],
			["k2_2", 5.5, 138 / 22],
		]);
	});
	test("the result follows the key order of the dict", () => {
		const grouped = groupBy(key1, [input("z", "", 1), input("a", "", 2)]);
		expect(aggregate((key: string, inputs: Aggregator<TestInput1, Key0>) => [key, inputs(count)] as const, grouped)).toEqual([
			["a", 1],
			["z", 1],
		]);
	});
	test("the empty dict gives the empty list", () => {
		expect(aggregate((key: string, _inputs: Aggregator<TestInput1, Key0>) => key, Dict.empty())).toEqual([]);
	});
});
