// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import * as Decimal from "./decimal.ts";
import { Just, Nothing, withDefault } from "./maybe.ts";

const { fromInt, fromFloat, fromString } = Decimal;
const show = Decimal.toString;

function expectDecimalEqual(actual: Decimal.Decimal, expected: Decimal.Decimal): void {
	if (!Decimal.eq(actual, expected)) {
		throw new Error(`${show(actual)} Expect.equal ${show(expected)}`);
	}
}

const sampleInts = [0, 1, -1, 7, -42, 1000, 123456789, -987654321];
const sampleDecimals = [
	fromFloat(0),
	fromFloat(1.5),
	fromFloat(-2.25),
	fromFloat(3.14),
	fromFloat(-1000.001),
	withDefault(Decimal.zero, fromString("123456789.987654321")),
];

describe("Decimal", () => {
	describe("abs", () => {
		test("abs of negative value", () => {
			expectDecimalEqual(Decimal.abs(fromInt(-42)), fromInt(42));
		});
		test("abs of positive value", () => {
			expectDecimalEqual(Decimal.abs(fromInt(42)), fromInt(42));
		});
		test("abs of zero value", () => {
			expectDecimalEqual(Decimal.abs(fromInt(0)), fromInt(0));
		});
	});

	describe("add", () => {
		test("mirrors normal addition", () => {
			for (const a of sampleInts) {
				for (const b of sampleInts) {
					expectDecimalEqual(Decimal.add(fromInt(a), fromInt(b)), fromInt(a + b));
				}
			}
		});
		test("is commutative", () => {
			for (const a of sampleDecimals) {
				for (const b of sampleDecimals) {
					expectDecimalEqual(Decimal.add(a, b), Decimal.add(b, a));
				}
			}
		});
		test("is exact where floats are not", () => {
			expect(show(Decimal.add(fromFloat(0.1), fromFloat(0.2)))).toBe("0.3");
		});
	});

	describe("sub", () => {
		test("mirrors normal subtraction", () => {
			for (const a of sampleInts) {
				for (const b of sampleInts) {
					expectDecimalEqual(Decimal.sub(fromInt(a), fromInt(b)), fromInt(a - b));
				}
			}
		});
		test("switching orders is the same as the negation", () => {
			for (const a of sampleDecimals) {
				for (const b of sampleDecimals) {
					expectDecimalEqual(Decimal.sub(a, b), Decimal.negate(Decimal.sub(b, a)));
				}
			}
		});
	});

	describe("mul", () => {
		test("mirrors normal multiplication", () => {
			const safeInts = [0, 1, -1, 3, -7, 46340, -46340];
			for (const a of safeInts) {
				for (const b of safeInts) {
					expect(Decimal.eq(Decimal.mul(fromInt(a), fromInt(b)), fromInt(a * b))).toBe(true);
				}
			}
		});
		test("is commutative", () => {
			for (const a of sampleDecimals) {
				for (const b of sampleDecimals) {
					expectDecimalEqual(Decimal.mul(a, b), Decimal.mul(b, a));
				}
			}
		});
	});

	describe("div", () => {
		test("divides exactly", () => {
			expect(Decimal.div(fromInt(10), fromInt(4))).toEqual(Just(fromFloat(2.5)));
		});
		test("Nothing on a zero divisor", () => {
			expect(Decimal.div(fromInt(1), Decimal.zero)).toEqual(Nothing);
		});
		test("gives 50 significant digits", () => {
			const third = withDefault(Decimal.zero, Decimal.div(Decimal.one, fromInt(3)));
			expect(show(third)).toBe(`0.${"3".repeat(50)}`);
		});
		test("divWithDefault falls back on a zero divisor", () => {
			expectDecimalEqual(Decimal.divWithDefault(Decimal.minusOne, fromInt(1), Decimal.zero), Decimal.minusOne);
			expectDecimalEqual(Decimal.divWithDefault(Decimal.minusOne, fromInt(6), fromInt(3)), fromInt(2));
		});
	});

	describe("construction", () => {
		test("it should support construction from an Int", () => {
			for (const n of sampleInts) {
				expect(show(fromInt(n))).toBe(String(n));
			}
		});
	});

	describe("fromString", () => {
		test("positive integer", () => {
			expect(fromString("42")).toEqual(Just(fromInt(42)));
		});
		test("negative integer", () => {
			expect(fromString("-21")).toEqual(Just(fromInt(-21)));
		});
		test("zero", () => {
			expect(fromString("0")).toEqual(Just(fromInt(0)));
		});
		test("non-number", () => {
			expect(fromString("esdf")).toEqual(Nothing);
		});
		test("decimal", () => {
			expect(fromString("1.1")).toEqual(Just(fromFloat(1.1)));
		});
		test("exponent and explicit sign", () => {
			expect(fromString("1.5e3")).toEqual(Just(fromInt(1500)));
			expect(fromString("+7")).toEqual(Just(fromInt(7)));
			expect(fromString("2E-2")).toEqual(Just(fromFloat(0.02)));
		});
		test("rejects forms decimal.js accepts but Elm does not", () => {
			for (const s of ["0x10", "0b1", "0o7", "Infinity", "-Infinity", "NaN", " 1", "1 ", "", ".5", "1.", "1_000"]) {
				expect(fromString(s)).toEqual(Nothing);
			}
		});
	});

	describe("fromFloat", () => {
		test("positive float", () => {
			expectDecimalEqual(fromFloat(1), fromInt(1));
		});
		test("negative float", () => {
			expectDecimalEqual(fromFloat(-1), fromInt(-1));
		});
		test("zero", () => {
			expectDecimalEqual(fromFloat(0), fromInt(0));
			expect(show(fromFloat(-0))).toBe("0");
		});
		test("decimal", () => {
			expectDecimalEqual(fromFloat(3.3), Decimal.shiftDecimalLeft(1, fromInt(33)));
		});
		test("exponent", () => {
			expectDecimalEqual(fromFloat(1.1), Decimal.shiftDecimalLeft(1, fromInt(11)));
		});
		test("equivalent to fromString", () => {
			for (const a of [0, 1, -1, 0.5, 3.14, -1234.5678, 1e10, 123456.789]) {
				expectDecimalEqual(fromFloat(a), withDefault(Decimal.zero, fromString(String(a))));
			}
		});
	});

	describe("hundred", () => {
		test("positive integer", () => {
			expect(show(Decimal.hundred(42))).toBe(show(fromInt(4200)));
		});
		test("negative integer", () => {
			expect(show(Decimal.hundred(-2))).toBe(show(fromInt(-200)));
		});
	});

	describe("thousand", () => {
		test("positive integer", () => {
			expect(show(Decimal.thousand(4))).toBe(show(fromInt(4000)));
		});
		test("negative integer", () => {
			expect(show(Decimal.thousand(-7))).toBe(show(fromInt(-7000)));
		});
	});

	describe("million", () => {
		test("positive integer", () => {
			expect(show(Decimal.million(21))).toBe(show(fromInt(21000000)));
		});
		test("negative integer", () => {
			expect(show(Decimal.million(-99))).toBe(show(fromInt(-99000000)));
		});
	});

	describe("tenth", () => {
		test("positive integer", () => {
			expectDecimalEqual(Decimal.tenth(1000), fromInt(100));
		});
		test("small positive integer", () => {
			expectDecimalEqual(Decimal.tenth(10), fromFloat(1.0));
		});
		test("negative integer", () => {
			expectDecimalEqual(Decimal.tenth(-1000), fromFloat(-100.0));
		});
		test("small negative integer", () => {
			expectDecimalEqual(Decimal.tenth(-50), fromFloat(-5.0));
		});
		test("no float artifacts", () => {
			expect(show(Decimal.tenth(3))).toBe("0.3");
		});
	});

	describe("hundredth", () => {
		test("positive integer", () => {
			expectDecimalEqual(Decimal.hundredth(100), fromFloat(1.0));
		});
		test("small positive integer", () => {
			expectDecimalEqual(Decimal.hundredth(10), fromFloat(0.1));
		});
		test("negative integer", () => {
			expectDecimalEqual(Decimal.hundredth(-1000), fromFloat(-10.0));
		});
		test("small negative integer", () => {
			expectDecimalEqual(Decimal.hundredth(-50), fromFloat(-0.5));
		});
	});

	describe("thousandth", () => {
		test("positive integer", () => {
			expect(show(Decimal.thousandth(7))).toBe("0.007");
		});
		test("negative integer", () => {
			expectDecimalEqual(Decimal.thousandth(-1500), fromFloat(-1.5));
		});
	});

	describe("bps", () => {
		test("positive integer", () => {
			expectDecimalEqual(Decimal.bps(10001), fromFloat(1.0001));
		});
		test("small positive integer", () => {
			expect(show(Decimal.bps(2))).toBe("0.0002");
		});
		test("negative integer", () => {
			expectDecimalEqual(Decimal.bps(-100001), fromFloat(-10.0001));
		});
		test("small negative integer", () => {
			expectDecimalEqual(Decimal.bps(-5), fromFloat(-0.0005));
		});
	});

	describe("millionth", () => {
		test("positive integer", () => {
			expectDecimalEqual(Decimal.millionth(1000000), fromFloat(1.0));
		});
		test("negative integer", () => {
			expectDecimalEqual(Decimal.millionth(-10000000), fromFloat(-10.0));
		});
		test("plain notation for tiny values", () => {
			expect(show(Decimal.millionth(1))).toBe("0.000001");
		});
	});

	describe("toString", () => {
		test("positive", () => {
			expect(show(fromInt(1))).toBe("1");
		});
		test("zero", () => {
			expect(show(fromInt(0))).toBe("0");
		});
		test("negative", () => {
			expect(show(fromInt(-1))).toBe("-1");
		});
		test("decimal", () => {
			expect(show(fromFloat(-1234.5678))).toBe("-1234.5678");
		});
		test("never uses exponent notation", () => {
			expect(show(withDefault(Decimal.zero, fromString("1e21")))).toBe("1000000000000000000000");
			expect(show(withDefault(Decimal.zero, fromString("1e-7")))).toBe("0.0000001");
		});
	});

	describe("toFloat", () => {
		test("positive integer", () => {
			expect(Decimal.toFloat(fromInt(1))).toBe(1.0);
		});
		test("zero", () => {
			expect(Decimal.toFloat(fromInt(0))).toBe(0.0);
		});
		test("negative integer", () => {
			expect(Decimal.toFloat(fromInt(-1))).toBe(-1.0);
		});
		test("decimal value", () => {
			expect(Decimal.toFloat(fromFloat(3.14))).toBeCloseTo(3.14, 9);
		});
		test("roundtrip fromFloat", () => {
			expect(Decimal.toFloat(fromFloat(1.5))).toBeCloseTo(1.5, 9);
		});
	});

	describe("compare", () => {
		test("integer equality", () => {
			for (const a of sampleInts) expect(Decimal.compare(fromInt(a), fromInt(a))).toBe("EQ");
		});
		test("integer less than", () => {
			for (const a of sampleInts) expect(Decimal.compare(fromInt(a), fromInt(a + 1))).toBe("LT");
		});
		test("integer greater than", () => {
			for (const a of sampleInts) expect(Decimal.compare(fromInt(a), fromInt(a - 1))).toBe("GT");
		});
		test("ignores trailing zeros", () => {
			expect(Decimal.compare(withDefault(Decimal.zero, fromString("1.50")), fromFloat(1.5))).toBe("EQ");
		});
	});

	describe("eq, neq, gt, gte, lt, lte", () => {
		test("decimal inequality", () => {
			for (const a of sampleDecimals) expect(Decimal.neq(a, Decimal.add(a, Decimal.minusOne))).toBe(true);
		});
		test("decimal equality", () => {
			for (const a of sampleDecimals) expect(Decimal.neq(a, a)).toBe(false);
		});
		test("ordering predicates", () => {
			const a = fromInt(1);
			const b = fromInt(2);
			expect(Decimal.eq(a, fromFloat(1.0))).toBe(true);
			expect(Decimal.gt(b, a)).toBe(true);
			expect(Decimal.gt(a, a)).toBe(false);
			expect(Decimal.gte(a, a)).toBe(true);
			expect(Decimal.gte(a, b)).toBe(false);
			expect(Decimal.lt(a, b)).toBe(true);
			expect(Decimal.lt(a, a)).toBe(false);
			expect(Decimal.lte(a, a)).toBe(true);
			expect(Decimal.lte(b, a)).toBe(false);
		});
	});

	describe("shiftDecimalLeft", () => {
		test("shift left for a whole number", () => {
			expectDecimalEqual(Decimal.shiftDecimalLeft(2, fromInt(314)), fromFloat(3.14));
		});
		test("shift left for a decimal number", () => {
			expectDecimalEqual(Decimal.shiftDecimalLeft(2, fromFloat(199.95)), fromFloat(1.9995));
		});
	});

	describe("shiftDecimalRight", () => {
		test("shift right for a whole number", () => {
			expectDecimalEqual(Decimal.shiftDecimalRight(3, fromInt(314)), fromFloat(314000));
		});
		test("shift right for a decimal number", () => {
			expectDecimalEqual(Decimal.shiftDecimalRight(1, fromFloat(199.95)), fromFloat(1999.5));
		});
	});

	describe("rounding", () => {
		test("truncate goes toward zero", () => {
			expect(show(Decimal.truncate(fromFloat(2.7)))).toBe("2");
			expect(show(Decimal.truncate(fromFloat(-2.7)))).toBe("-2");
			expect(show(Decimal.truncate(fromInt(5)))).toBe("5");
		});
		test("round goes half up", () => {
			expect(show(Decimal.round(fromFloat(2.4)))).toBe("2");
			expect(show(Decimal.round(fromFloat(2.5)))).toBe("3");
			expect(show(Decimal.round(fromFloat(-2.4)))).toBe("-2");
			expect(show(Decimal.round(fromFloat(-2.5)))).toBe("-3");
		});
	});

	describe("negate and constants", () => {
		test("negate flips the sign", () => {
			expectDecimalEqual(Decimal.negate(fromInt(3)), fromInt(-3));
			expectDecimalEqual(Decimal.negate(Decimal.zero), Decimal.zero);
		});
		test("constants", () => {
			expect(show(Decimal.zero)).toBe("0");
			expect(show(Decimal.one)).toBe("1");
			expect(show(Decimal.minusOne)).toBe("-1");
		});
	});

	test("does not change the global decimal.js configuration", async () => {
		const { Decimal: Global } = await import("decimal.js");
		expect(Global.precision).toBe(20);
	});
});
