// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { Err, Ok, type Result } from "./result.ts";
import { errors, filter, filterOrFail, fromList, keepAllErrors, keepFirstError, map, mapOrFail, partition, type ResultList, successes } from "./result-list.ts";

const isOdd = (a: number): boolean => a % 2 !== 0;
const allOk: ResultList<string, number> = [Ok(1), Ok(2), Ok(3), Ok(4)];
const mixed: ResultList<string, number> = [Ok(1), Err("foo"), Ok(3), Err("bar")];
const allErr: ResultList<string, number> = [Err("foo"), Err("bar")];

describe("fromList", () => {
	test("wraps every item in Ok", () => {
		expect(fromList([1, 2, 3])).toEqual([Ok(1), Ok(2), Ok(3)]);
		expect(fromList([])).toEqual([]);
	});
});

describe("errors", () => {
	test("extracts the errors in order", () => {
		expect(errors(allOk)).toEqual([]);
		expect(errors(mixed)).toEqual(["foo", "bar"]);
		expect(errors(allErr)).toEqual(["foo", "bar"]);
	});
});

describe("successes", () => {
	test("extracts the successes in order", () => {
		expect(successes(allOk)).toEqual([1, 2, 3, 4]);
		expect(successes(mixed)).toEqual([1, 3]);
		expect(successes(allErr)).toEqual([]);
	});
});

describe("partition", () => {
	test("splits into errors and successes", () => {
		expect(partition(allOk)).toEqual([[], [1, 2, 3, 4]]);
		expect(partition(mixed)).toEqual([
			["foo", "bar"],
			[1, 3],
		]);
		expect(partition(allErr)).toEqual([["foo", "bar"], []]);
		expect(partition([])).toEqual([[], []]);
	});
});

describe("filter", () => {
	test("filters the successes", () => {
		expect(filter(isOdd, [Ok(1), Ok(2), Ok(3)])).toEqual([Ok(1), Ok(3)]);
	});
	test("retains all previously failed items", () => {
		expect(filter(isOdd, [Err("foo"), Ok(2), Ok(3)])).toEqual([Err("foo"), Ok(3)]);
	});
});

describe("filterOrFail", () => {
	const divide = (a: number): Result<string, boolean> => (a === 0 ? Err("division by zero") : Ok(isOdd(a)));

	test("the doc example", () => {
		expect(filterOrFail(divide, [Ok(-1), Ok(0), Err("earlier"), Ok(2)])).toEqual([Ok(-1), Err("division by zero"), Err("earlier")]);
	});
	test("the predicate does not run on failed items", () => {
		let calls = 0;
		const counting = (_a: number): Result<string, boolean> => {
			calls += 1;
			return Ok(true);
		};
		expect(filterOrFail(counting, allErr)).toEqual(allErr);
		expect(calls).toBe(0);
	});
});

describe("map", () => {
	test("maps the successes", () => {
		expect(map((a: number) => a * 2, [Ok(1), Ok(2), Ok(3)])).toEqual([Ok(2), Ok(4), Ok(6)]);
	});
	test("retains all previously failed items", () => {
		expect(map((a: number) => a * 2, [Err("foo"), Ok(2), Ok(3)])).toEqual([Err("foo"), Ok(4), Ok(6)]);
	});
});

describe("mapOrFail", () => {
	const divide = (a: number): Result<string, number> => (a === 0 ? Err("division by zero") : Ok(100 / a));

	test("the doc example", () => {
		expect(mapOrFail(divide, [Ok(-1), Ok(0), Err("earlier")])).toEqual([Ok(-100), Err("division by zero"), Err("earlier")]);
	});
});

describe("keepAllErrors", () => {
	test("all successes give Ok with every value", () => {
		expect(keepAllErrors(allOk)).toEqual(Ok([1, 2, 3, 4]));
	});
	test("any error gives Err with every error in order", () => {
		expect(keepAllErrors(mixed)).toEqual(Err(["foo", "bar"]));
		expect(keepAllErrors(allErr)).toEqual(Err(["foo", "bar"]));
	});
	test("the empty list is Ok []", () => {
		expect(keepAllErrors([])).toEqual(Ok([]));
	});
});

describe("keepFirstError", () => {
	test("all successes give Ok with every value", () => {
		expect(keepFirstError(allOk)).toEqual(Ok([1, 2, 3, 4]));
	});
	test("any error gives the first error only", () => {
		expect(keepFirstError(mixed)).toEqual(Err("foo"));
		expect(keepFirstError([Ok(1), Ok(2), Err("late")])).toEqual(Err("late"));
	});
	test("the empty list is Ok []", () => {
		expect(keepFirstError([])).toEqual(Ok([]));
	});
});
