// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import * as Instant from "./instant.ts";
import { compare } from "./internal/compare.ts";

describe("Instant", () => {
	test("fromMillisecondsSinceEpoch and toMillisecondsSinceEpoch are inverses", () => {
		for (const ms of [0, 1, -1, 1643374590000, -62135596800000]) {
			expect(Instant.toMillisecondsSinceEpoch(Instant.fromMillisecondsSinceEpoch(ms))).toBe(ms);
		}
	});
	test("an Instant is a plain number at run time", () => {
		const instant: Instant.Instant = Instant.fromMillisecondsSinceEpoch(1643374590000);
		expect(typeof instant).toBe("number");
		expect(new Date(instant).toISOString()).toBe("2022-01-28T12:56:30.000Z");
	});
	test("fractions of a millisecond are dropped", () => {
		expect(Instant.toMillisecondsSinceEpoch(Instant.fromMillisecondsSinceEpoch(1.9))).toBe(1);
		expect(Instant.toMillisecondsSinceEpoch(Instant.fromMillisecondsSinceEpoch(-1.9))).toBe(-1);
		expect(Instant.toMillisecondsSinceEpoch(Instant.fromMillisecondsSinceEpoch(-0.5))).toBe(0);
	});
	test("rejects a value that is not finite", () => {
		expect(() => Instant.fromMillisecondsSinceEpoch(Number.NaN)).toThrow(RangeError);
		expect(() => Instant.fromMillisecondsSinceEpoch(Number.POSITIVE_INFINITY)).toThrow(RangeError);
	});
	test("instants are ordered by Basics.compare, as numbers are", () => {
		const at = Instant.fromMillisecondsSinceEpoch;
		expect(compare(at(1), at(2))).toBe("LT");
		expect(compare(at(2), at(2))).toBe("EQ");
		expect(compare(at(3), at(2))).toBe("GT");
	});
});
