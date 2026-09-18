// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { Just, type Maybe, Nothing } from "./maybe.ts";
import { any, anyOf, chain, is, noneOf, type Rule } from "./rule.ts";

describe("chain", () => {
	const never: Rule<number, string> = () => Nothing;
	const evenOnly: Rule<number, string> = (a) => (a % 2 === 0 ? Just("even") : Nothing);
	const always: Rule<number, string> = (a) => Just(`any ${a}`);

	test("no rules never match", () => {
		expect(chain<number, string>([])(42)).toEqual(Nothing);
	});
	test("the doc example", () => {
		const identityRule = (a: number): Maybe<number> => Just(a);
		expect(chain([() => Nothing, identityRule])(42)).toEqual(Just(42));
	});
	test("the first rule that matches is applied", () => {
		const rules = chain([never, evenOnly, always]);
		expect(rules(2)).toEqual(Just("even"));
		expect(rules(3)).toEqual(Just("any 3"));
	});
	test("no matching rule gives Nothing", () => {
		expect(chain([never, evenOnly])(3)).toEqual(Nothing);
	});
	test("rules after the first match are not evaluated", () => {
		let calls = 0;
		const counting: Rule<number, string> = () => {
			calls += 1;
			return Nothing;
		};
		expect(chain([always, counting])(1)).toEqual(Just("any 1"));
		expect(calls).toBe(0);
	});
	test("a long chain does not overflow the stack", () => {
		const rules: Rule<number, string>[] = Array.from({ length: 100000 }, () => never);
		expect(chain([...rules, always])(7)).toEqual(Just("any 7"));
	});
});

describe("any", () => {
	test("is true for every input", () => {
		expect(any(1)).toBe(true);
		expect(any("x")).toBe(true);
		expect(any(Nothing)).toBe(true);
		expect(any([1, 2])).toBe(true);
	});
});

describe("is", () => {
	test("exact match on primitives", () => {
		expect(is(1, 1)).toBe(true);
		expect(is(1, 2)).toBe(false);
		expect(is("a", "a")).toBe(true);
	});
	test("equality is structural", () => {
		expect(is([1, "a"] as const, [1, "a"] as const)).toBe(true);
		expect(is({ x: Just(1) }, { x: Just(1) })).toBe(true);
		expect(is({ x: Just(1) }, { x: Just(2) })).toBe(false);
	});
});

describe("anyOf", () => {
	test("true when the value is in the list", () => {
		expect(anyOf([1, 2, 3], 2)).toBe(true);
		expect(anyOf([1, 2, 3], 4)).toBe(false);
		expect(anyOf<number>([], 4)).toBe(false);
	});
	test("membership is structural", () => {
		expect(anyOf([Just(1), Nothing], Just(1))).toBe(true);
		expect(anyOf([Just(1), Nothing], Just(2))).toBe(false);
	});
});

describe("noneOf", () => {
	test("true when the value is not in the list", () => {
		expect(noneOf([1, 2, 3], 2)).toBe(false);
		expect(noneOf([1, 2, 3], 4)).toBe(true);
		expect(noneOf<number>([], 4)).toBe(true);
	});
	test("membership is structural", () => {
		expect(noneOf([[1, 2]], [1, 2])).toBe(false);
		expect(noneOf([[1, 2]], [2, 1])).toBe(true);
	});
});

describe("decision table", () => {
	test("predicates combine into rules", () => {
		const rule =
			(country: (c: string) => boolean, amount: (n: number) => boolean, out: string): Rule<readonly [string, number], string> =>
			([c, n]) =>
				country(c) && amount(n) ? Just(out) : Nothing;
		const table = chain([
			rule(
				(c) => is("US", c),
				(n) => anyOf([1, 2], n),
				"us-small",
			),
			rule((c) => noneOf(["US", "CA"], c), any, "foreign"),
			rule(any, any, "other"),
		]);
		expect(table(["US", 2])).toEqual(Just("us-small"));
		expect(table(["FR", 2])).toEqual(Just("foreign"));
		expect(table(["CA", 9])).toEqual(Just("other"));
	});
});
