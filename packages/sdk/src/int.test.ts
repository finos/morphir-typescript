// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import * as Int from "./int.ts";
import { type Maybe, Nothing } from "./maybe.ts";

function expectJust(m: Maybe<number>, expected: number): void {
	expect(m.kind).toBe("Just");
	if (m.kind === "Just") expect(m.value).toBe(expected);
}

describe("Int", () => {
	describe("Int8", () => {
		test("accepts the 8 bit range", () => {
			expectJust(Int.toInt8(0), 0);
			expectJust(Int.toInt8(127), 127);
			expectJust(Int.toInt8(-128), -128);
		});
		test("rejects values outside the 8 bit range", () => {
			expect(Int.toInt8(128)).toEqual(Nothing);
			expect(Int.toInt8(-129)).toEqual(Nothing);
		});
		test("rejects non-integers", () => {
			expect(Int.toInt8(1.5)).toEqual(Nothing);
			expect(Int.toInt8(Number.NaN)).toEqual(Nothing);
		});
		test("fromInt8 unwraps", () => {
			const value = Int.toInt8(42);
			expect(value.kind).toBe("Just");
			if (value.kind === "Just") expect(Int.fromInt8(value.value)).toBe(42);
		});
	});

	describe("Int16", () => {
		test("accepts the 16 bit range", () => {
			expectJust(Int.toInt16(32767), 32767);
			expectJust(Int.toInt16(-32768), -32768);
		});
		test("rejects values outside the 16 bit range", () => {
			expect(Int.toInt16(32768)).toEqual(Nothing);
			expect(Int.toInt16(-32769)).toEqual(Nothing);
		});
		test("rejects non-integers", () => {
			expect(Int.toInt16(0.1)).toEqual(Nothing);
		});
		test("fromInt16 unwraps", () => {
			const value = Int.toInt16(-7);
			expect(value.kind).toBe("Just");
			if (value.kind === "Just") expect(Int.fromInt16(value.value)).toBe(-7);
		});
	});

	describe("Int32", () => {
		test("accepts the 32 bit range", () => {
			expectJust(Int.toInt32(2147483647), 2147483647);
			expectJust(Int.toInt32(-2147483648), -2147483648);
		});
		test("rejects values outside the 32 bit range", () => {
			expect(Int.toInt32(2147483648)).toEqual(Nothing);
			expect(Int.toInt32(-2147483649)).toEqual(Nothing);
		});
		test("rejects non-integers", () => {
			expect(Int.toInt32(2.5)).toEqual(Nothing);
		});
		test("fromInt32 unwraps", () => {
			const value = Int.toInt32(100000);
			expect(value.kind).toBe("Just");
			if (value.kind === "Just") expect(Int.fromInt32(value.value)).toBe(100000);
		});
	});

	describe("Int64", () => {
		test("accepts the JS safe integer range", () => {
			expectJust(Int.toInt64(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
			expectJust(Int.toInt64(Number.MIN_SAFE_INTEGER), Number.MIN_SAFE_INTEGER);
		});
		test("rejects values outside the safe integer range", () => {
			expect(Int.toInt64(Number.MAX_SAFE_INTEGER + 2)).toEqual(Nothing);
			expect(Int.toInt64(Number.POSITIVE_INFINITY)).toEqual(Nothing);
		});
		test("rejects non-integers", () => {
			expect(Int.toInt64(3.14)).toEqual(Nothing);
			expect(Int.toInt64(Number.NaN)).toEqual(Nothing);
		});
		test("fromInt64 unwraps", () => {
			const value = Int.toInt64(9007199254740991);
			expect(value.kind).toBe("Just");
			if (value.kind === "Just") expect(Int.fromInt64(value.value)).toBe(9007199254740991);
		});
	});
});
