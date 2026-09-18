// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Aggregate: functions to aggregate large data sets. An
// `Aggregation` holds a key function, a filter and an operator (count, sum,
// average, minimum, maximum, weighted average). `aggregateMap` to
// `aggregateMap4` give each row the aggregated value of its group, and
// `groupBy` with `aggregate` reduce each group to one row. Aggregated values
// are floats, and a group with no value gives 0, as in Elm.
//
// Keys are comparables and the groups are an SDK `Dict`. Elm's runtime uses an
// association list here, so `aggregate` there gives its rows in the insertion
// order of the keys; here the rows are in ascending key order, as the entries
// of a `Dict` are. Elm's `groupBy` prepends each row, so its groups hold the
// rows in reverse; here each group keeps the rows in list order, as the Elm
// documentation shows. No aggregated value depends on that order.
//
// This module does not port `AggregationCall`, `AggregateValue`,
// `ConstructAggregationError` and `constructAggregationCall`. They inspect
// Morphir IR `TypedValue`s, so they belong to tooling and not to the runtime,
// and the IR SDK specification has no entry for them.
import type { Dict, Entry } from "./dict.ts";
import { type Comparable, compare, toNumber } from "./internal/compare.ts";
import { type Key0, key0 } from "./key.ts";
import type { List } from "./list.ts";

export type Operator<A> =
	| { readonly kind: "Count" }
	| { readonly kind: "Sum"; readonly getValue: (a: A) => number }
	| { readonly kind: "Avg"; readonly getValue: (a: A) => number }
	| { readonly kind: "Min"; readonly getValue: (a: A) => number }
	| { readonly kind: "Max"; readonly getValue: (a: A) => number }
	| { readonly kind: "WAvg"; readonly getWeight: (a: A) => number; readonly getValue: (a: A) => number };

export interface Aggregation<A, K extends Comparable> {
	readonly key: (a: A) => K;
	readonly filter: (a: A) => boolean;
	readonly operator: Operator<A>;
}

export type Aggregator<A, K extends Comparable> = (agg: Aggregation<A, K>) => number;

function operatorToAggregation<A>(operator: Operator<A>): Aggregation<A, Key0> {
	return { key: key0, filter: () => true, operator };
}

// Elm's `count` is a polymorphic constant. An aggregation only reads its row
// type, so the `unknown` row type fits an aggregation over any row type. With
// `count`, give the row type on the filter: `withFilter((a: Row) => ..., count)`.
export const count: Aggregation<unknown, Key0> = operatorToAggregation({ kind: "Count" });

export function sumOf<A>(getValue: (a: A) => number): Aggregation<A, Key0> {
	return operatorToAggregation({ kind: "Sum", getValue });
}

export function averageOf<A>(getValue: (a: A) => number): Aggregation<A, Key0> {
	return operatorToAggregation({ kind: "Avg", getValue });
}

export function minimumOf<A>(getValue: (a: A) => number): Aggregation<A, Key0> {
	return operatorToAggregation({ kind: "Min", getValue });
}

export function maximumOf<A>(getValue: (a: A) => number): Aggregation<A, Key0> {
	return operatorToAggregation({ kind: "Max", getValue });
}

export function weightedAverageOf<A>(getWeight: (a: A) => number, getValue: (a: A) => number): Aggregation<A, Key0> {
	return operatorToAggregation({ kind: "WAvg", getWeight, getValue });
}

export function byKey<A, K extends Comparable>(key: (a: A) => K, agg: Aggregation<A, Key0>): Aggregation<A, K> {
	return { key, filter: agg.filter, operator: agg.operator };
}

export function withFilter<A, K extends Comparable>(filter: (a: A) => boolean, agg: Aggregation<A, K>): Aggregation<A, K> {
	return { key: agg.key, filter, operator: agg.operator };
}

export function aggregateMap<A, B, K1 extends Comparable>(agg1: Aggregation<A, K1>, f: (v1: number, a: A) => B, list: List<A>): List<B> {
	const get1 = lookup(agg1, list);
	return list.map((a) => f(get1(a), a));
}

export function aggregateMap2<A, B, K1 extends Comparable, K2 extends Comparable>(
	agg1: Aggregation<A, K1>,
	agg2: Aggregation<A, K2>,
	f: (v1: number, v2: number, a: A) => B,
	list: List<A>,
): List<B> {
	const get1 = lookup(agg1, list);
	const get2 = lookup(agg2, list);
	return list.map((a) => f(get1(a), get2(a), a));
}

export function aggregateMap3<A, B, K1 extends Comparable, K2 extends Comparable, K3 extends Comparable>(
	agg1: Aggregation<A, K1>,
	agg2: Aggregation<A, K2>,
	agg3: Aggregation<A, K3>,
	f: (v1: number, v2: number, v3: number, a: A) => B,
	list: List<A>,
): List<B> {
	const get1 = lookup(agg1, list);
	const get2 = lookup(agg2, list);
	const get3 = lookup(agg3, list);
	return list.map((a) => f(get1(a), get2(a), get3(a), a));
}

export function aggregateMap4<A, B, K1 extends Comparable, K2 extends Comparable, K3 extends Comparable, K4 extends Comparable>(
	agg1: Aggregation<A, K1>,
	agg2: Aggregation<A, K2>,
	agg3: Aggregation<A, K3>,
	agg4: Aggregation<A, K4>,
	f: (v1: number, v2: number, v3: number, v4: number, a: A) => B,
	list: List<A>,
): List<B> {
	const get1 = lookup(agg1, list);
	const get2 = lookup(agg2, list);
	const get3 = lookup(agg3, list);
	const get4 = lookup(agg4, list);
	return list.map((a) => f(get1(a), get2(a), get3(a), get4(a), a));
}

// A stable sort by key and one sweep, so a large list costs O(n log n). The
// entries are ascending by `compare` with no duplicate key, which is the
// invariant of `Dict`.
export function groupBy<A, K extends Comparable>(getKey: (a: A) => K, list: List<A>): Dict<K, List<A>> {
	const keyed = list.map((a): Entry<K, A> => [getKey(a), a]);
	keyed.sort((x, y) => toNumber(compare(x[0], y[0])));
	const entries: Entry<K, A[]>[] = [];
	let current: Entry<K, A[]> | undefined;
	for (const [key, a] of keyed) {
		if (current !== undefined && compare(current[0], key) === "EQ") {
			current[1].push(a);
		} else {
			current = [key, [a]];
			entries.push(current);
		}
	}
	return { kind: "Dict", entries };
}

export function aggregate<A, B, K extends Comparable>(f: (key: K, aggregator: Aggregator<A, Key0>) => B, dict: Dict<K, List<A>>): List<B> {
	return dict.entries.map(([key, items]) => f(key, (agg) => (aggregateHelp(agg, items)[0] ?? [0, 0])[1]));
}

// The aggregated value of each group of the rows that pass the filter.
function aggregateHelp<A, K extends Comparable>(agg: Aggregation<A, K>, list: List<A>): readonly Entry<K, number>[] {
	return groupBy(agg.key, list.filter(agg.filter)).entries.map(([key, items]): Entry<K, number> => [key, reduce(agg.operator, items)]);
}

// The value of one group. Each fold goes left to right and starts from the
// first row, as Elm's does, so the floating-point result is the same.
function reduce<A>(op: Operator<A>, items: List<A>): number {
	const fold = (getValue: (a: A) => number, o: (acc: number, v: number) => number): number => {
		const [first, ...rest] = items;
		return first === undefined ? 0 : rest.reduce((acc, a) => o(acc, getValue(a)), getValue(first));
	};
	const sum = (getValue: (a: A) => number): number => fold(getValue, (acc, v) => acc + v);
	switch (op.kind) {
		case "Count":
			return sum(() => 1);
		case "Sum":
			return sum(op.getValue);
		case "Avg":
			return sum(op.getValue) / sum(() => 1);
		case "Min":
			return fold(op.getValue, (acc, v) => (acc < v ? acc : v));
		case "Max":
			return fold(op.getValue, (acc, v) => (acc > v ? acc : v));
		case "WAvg":
			return sum((a) => op.getWeight(a) * op.getValue(a)) / sum(op.getWeight);
	}
}

// The function from a row to the aggregated value of its group, or 0 when the
// filter removed every row of the group.
function lookup<A, K extends Comparable>(agg: Aggregation<A, K>, list: List<A>): (a: A) => number {
	const entries = aggregateHelp(agg, list);
	return (a) => {
		const key = agg.key(a);
		let lo = 0;
		let hi = entries.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			const entry = entries[mid];
			if (entry === undefined) break;
			const o = compare(entry[0], key);
			if (o === "EQ") return entry[1];
			if (o === "LT") lo = mid + 1;
			else hi = mid;
		}
		return 0;
	};
}
