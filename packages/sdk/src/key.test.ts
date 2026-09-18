// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { fromList, get } from "./dict.ts";
import { compare } from "./internal/compare.ts";
import {
	type Key0,
	type Key2,
	type Key3,
	type Key16,
	key0,
	key2,
	key3,
	key4,
	key5,
	key6,
	key7,
	key8,
	key9,
	key10,
	key11,
	key12,
	key13,
	key14,
	key15,
	key16,
	noKey,
} from "./key.ts";
import { Just, Nothing } from "./maybe.ts";

type Entity = { readonly foo: string; readonly bar: number; readonly baz: number };
const entity: Entity = { foo: "f", bar: 1, baz: 2.5 };
const foo = (e: Entity): string => e.foo;
const bar = (e: Entity): number => e.bar;
const baz = (e: Entity): number => e.baz;

// Getter n returns n * 10 + the input, so every position is distinguishable.
const g =
	(n: number) =>
	(a: number): number =>
		n * 10 + a;
const expected = (n: number): readonly number[] => Array.from({ length: n }, (_, i) => (i + 1) * 10 + 1);

describe("key0 and noKey", () => {
	test("both give the constant 0 for any input", () => {
		const k: Key0 = key0(entity);
		expect(k).toBe(0);
		expect(key0("anything")).toBe(0);
		expect(noKey(entity)).toBe(0);
		expect(noKey(42)).toBe(0);
	});
});

describe("key2 and key3", () => {
	test("the doc example", () => {
		const myKey: Key3<number, string, number> = key3(bar, foo, baz, entity);
		expect(myKey).toEqual([1, "f", 2.5]);
	});
	test("key2 applies the getters in order", () => {
		const k: Key2<string, number> = key2(foo, bar, entity);
		expect(k).toEqual(["f", 1]);
	});
});

describe("key4 to key16", () => {
	test("each applies every getter in order", () => {
		expect<readonly number[]>(key4(g(1), g(2), g(3), g(4), 1)).toEqual(expected(4));
		expect<readonly number[]>(key5(g(1), g(2), g(3), g(4), g(5), 1)).toEqual(expected(5));
		expect<readonly number[]>(key6(g(1), g(2), g(3), g(4), g(5), g(6), 1)).toEqual(expected(6));
		expect<readonly number[]>(key7(g(1), g(2), g(3), g(4), g(5), g(6), g(7), 1)).toEqual(expected(7));
		expect<readonly number[]>(key8(g(1), g(2), g(3), g(4), g(5), g(6), g(7), g(8), 1)).toEqual(expected(8));
		expect<readonly number[]>(key9(g(1), g(2), g(3), g(4), g(5), g(6), g(7), g(8), g(9), 1)).toEqual(expected(9));
		expect<readonly number[]>(key10(g(1), g(2), g(3), g(4), g(5), g(6), g(7), g(8), g(9), g(10), 1)).toEqual(expected(10));
		expect<readonly number[]>(key11(g(1), g(2), g(3), g(4), g(5), g(6), g(7), g(8), g(9), g(10), g(11), 1)).toEqual(expected(11));
		expect<readonly number[]>(key12(g(1), g(2), g(3), g(4), g(5), g(6), g(7), g(8), g(9), g(10), g(11), g(12), 1)).toEqual(expected(12));
		expect<readonly number[]>(key13(g(1), g(2), g(3), g(4), g(5), g(6), g(7), g(8), g(9), g(10), g(11), g(12), g(13), 1)).toEqual(expected(13));
		expect<readonly number[]>(key14(g(1), g(2), g(3), g(4), g(5), g(6), g(7), g(8), g(9), g(10), g(11), g(12), g(13), g(14), 1)).toEqual(expected(14));
		expect<readonly number[]>(key15(g(1), g(2), g(3), g(4), g(5), g(6), g(7), g(8), g(9), g(10), g(11), g(12), g(13), g(14), g(15), 1)).toEqual(expected(15));
		expect<readonly number[]>(key16(g(1), g(2), g(3), g(4), g(5), g(6), g(7), g(8), g(9), g(10), g(11), g(12), g(13), g(14), g(15), g(16), 1)).toEqual(
			expected(16),
		);
	});
	test("element types are kept per position", () => {
		const s = (a: number): string => `s${a}`;
		const k: Key16<number, string, number, string, number, string, number, string, number, string, number, string, number, string, number, string> = key16(
			g(1),
			s,
			g(3),
			s,
			g(5),
			s,
			g(7),
			s,
			g(9),
			s,
			g(11),
			s,
			g(13),
			s,
			g(15),
			s,
			1,
		);
		expect(k[0]).toBe(11);
		expect(k[15]).toBe("s1");
	});
});

describe("keys are comparable", () => {
	test("composite keys order element by element", () => {
		expect(compare(key2(foo, bar, entity), key2(foo, bar, { ...entity, bar: 2 }))).toBe("LT");
		expect(compare(key3(bar, foo, baz, entity), key3(bar, foo, baz, { ...entity }))).toBe("EQ");
		expect(compare(key0(1), noKey(2))).toBe("EQ");
	});
	test("composite keys work as Dict keys", () => {
		const other: Entity = { foo: "g", bar: 1, baz: 0 };
		const dict = fromList([
			[key2(foo, bar, entity), "first"],
			[key2(foo, bar, other), "second"],
		]);
		expect(get(key2(foo, bar, { foo: "g", bar: 1, baz: 99 }), dict)).toEqual(Just("second"));
		expect(get(key2(foo, bar, { foo: "h", bar: 1, baz: 99 }), dict)).toEqual(Nothing);
	});
});
