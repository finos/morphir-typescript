// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { Decimal } from "decimal.js";
import { Just, Nothing } from "./maybe.ts";
import type { Number as MorphirNumber } from "./number.ts";
import * as Num from "./number.ts";
import { Err, Ok } from "./result.ts";

// Mirrors the Elm test helper: `makeNumber n d` builds n/d through `divide`.
function makeNumber(n: number, d: number): MorphirNumber {
	const r = Num.divide(Num.fromInt(n), Num.fromInt(d));
	return r.kind === "Ok" ? r.value : Num.zero;
}

function over(d: number, n: number): MorphirNumber {
	return makeNumber(n, d);
}

// Stand-in for the Elm fuzzer: a spread of rationals including negatives and
// negative denominators.
const samples: readonly MorphirNumber[] = [
	makeNumber(0, 1),
	makeNumber(1, 1),
	makeNumber(-1, 1),
	makeNumber(3, 4),
	makeNumber(-3, 4),
	makeNumber(3, -4),
	makeNumber(-3, -4),
	makeNumber(22, 7),
	makeNumber(1000000007, 13),
	makeNumber(-7, 5),
];

function expectNumbersEqual(expected: MorphirNumber, actual: MorphirNumber): void {
	if (!Num.equal(expected, actual)) {
		throw new Error(`Expected ${Num.toFractionalString(expected)} to equal ${Num.toFractionalString(actual)}`);
	}
}

describe("Number", () => {
	test("fromInt builds an integral rational", () => {
		expect(Num.fromInt(5)).toEqual({ kind: "Rational", numerator: 5n, denominator: 1n });
		expect(Num.zero).toEqual({ kind: "Rational", numerator: 0n, denominator: 1n });
		expect(Num.one).toEqual({ kind: "Rational", numerator: 1n, denominator: 1n });
	});

	describe("Number.equal", () => {
		test("number inequality", () => {
			for (const a of samples) {
				expect(Num.equal(a, Num.add(a, Num.fromInt(1)))).toBe(false);
			}
		});
		test("number equality", () => {
			for (const a of samples) {
				expect(Num.equal(a, a)).toBe(true);
			}
		});
		test("equal one (divide ten ten)", () => {
			expect(Num.equal(Num.one, makeNumber(10, 10))).toBe(true);
			expect(Num.equal(Num.one, Num.zero)).toBe(false);
			expect(Num.equal(makeNumber(1, 2), makeNumber(-2, -4))).toBe(true);
		});
	});

	describe("Number.notEqual", () => {
		test("number inequality", () => {
			for (const a of samples) {
				expect(Num.notEqual(a, Num.add(a, Num.fromInt(1)))).toBe(true);
			}
		});
		test("number equality", () => {
			for (const a of samples) {
				expect(Num.notEqual(a, a)).toBe(false);
			}
		});
	});

	describe("ordering", () => {
		test("lessThan and greaterThan", () => {
			expect(Num.lessThan(makeNumber(1, 2), makeNumber(2, 3))).toBe(true);
			expect(Num.lessThan(makeNumber(2, 3), makeNumber(1, 2))).toBe(false);
			expect(Num.greaterThan(makeNumber(2, 3), makeNumber(1, 2))).toBe(true);
			expect(Num.greaterThan(makeNumber(1, 2), makeNumber(1, 2))).toBe(false);
		});
		test("lessThanOrEqual and greaterThanOrEqual", () => {
			expect(Num.lessThanOrEqual(makeNumber(1, 2), makeNumber(2, 4))).toBe(true);
			expect(Num.lessThanOrEqual(makeNumber(2, 3), makeNumber(1, 2))).toBe(false);
			expect(Num.greaterThanOrEqual(makeNumber(1, 2), makeNumber(2, 4))).toBe(true);
			expect(Num.greaterThanOrEqual(makeNumber(1, 2), makeNumber(2, 3))).toBe(false);
		});
		test("negative denominators compare by value", () => {
			// 3/-4 is -0.75, which is less than 1/2.
			expect(Num.lessThan(makeNumber(3, -4), makeNumber(1, 2))).toBe(true);
			expect(Num.greaterThan(makeNumber(1, 2), makeNumber(3, -4))).toBe(true);
			expect(Num.lessThan(makeNumber(-3, -4), makeNumber(1, 2))).toBe(false);
		});
	});

	describe("arithmetic", () => {
		test("add", () => {
			expectNumbersEqual(makeNumber(5, 6), Num.add(makeNumber(1, 2), makeNumber(1, 3)));
			expect(Num.add(makeNumber(1, 2), makeNumber(1, 3))).toEqual({ kind: "Rational", numerator: 5n, denominator: 6n });
		});
		test("subtract", () => {
			expectNumbersEqual(makeNumber(1, 6), Num.subtract(makeNumber(1, 2), makeNumber(1, 3)));
		});
		test("multiply", () => {
			expect(Num.multiply(makeNumber(2, 3), makeNumber(3, 4))).toEqual({ kind: "Rational", numerator: 6n, denominator: 12n });
		});
		test("negate", () => {
			expect(Num.negate(makeNumber(3, 4))).toEqual({ kind: "Rational", numerator: -3n, denominator: 4n });
			expectNumbersEqual(Num.zero, Num.add(makeNumber(3, 4), Num.negate(makeNumber(3, 4))));
		});
		test("abs", () => {
			expect(Num.abs(makeNumber(-3, 4))).toEqual({ kind: "Rational", numerator: 3n, denominator: 4n });
			expect(Num.abs(makeNumber(3, -4))).toEqual({ kind: "Rational", numerator: 3n, denominator: 4n });
		});
		test("reciprocal swaps, but leaves zero alone", () => {
			expect(Num.reciprocal(makeNumber(3, 4))).toEqual({ kind: "Rational", numerator: 4n, denominator: 3n });
			expect(Num.reciprocal(Num.zero)).toEqual(Num.zero);
			expect(Num.reciprocal(makeNumber(0, 5))).toEqual({ kind: "Rational", numerator: 0n, denominator: 5n });
		});
	});

	describe("Number.divide", () => {
		test("dividing by zero should result in DivisionByZero", () => {
			expect(Num.divide(Num.fromInt(42), Num.fromInt(0))).toEqual(Err(Num.DivisionByZero));
			expect(Num.divide(Num.fromInt(42), makeNumber(0, 7))).toEqual(Err(Num.DivisionByZero));
			expect(Num.DivisionByZero).toEqual({ kind: "DivisionByZero" });
		});
		test("dividing a non-zero number by itself should equal 1", () => {
			for (const n of [1, -1, 2, 7, -13, 1000003]) {
				const r = Num.divide(Num.fromInt(n), Num.fromInt(n));
				expect(r.kind).toBe("Ok");
				if (r.kind === "Ok") expectNumbersEqual(Num.one, r.value);
			}
		});
		test("divide cross-multiplies", () => {
			expect(Num.divide(makeNumber(1, 2), makeNumber(3, 4))).toEqual(Ok({ kind: "Rational", numerator: 4n, denominator: 6n }));
		});
	});

	describe("Number.simplify", () => {
		test("4/2 should reduce to 2/1", () => {
			const r = Num.simplify(over(2, 4));
			expect(r.kind).toBe("Just");
			if (r.kind === "Just") {
				expectNumbersEqual(Num.fromInt(2), r.value);
				expect(r.value).toEqual({ kind: "Rational", numerator: 2n, denominator: 1n });
			}
		});
		test("7/5 should not simplify", () => {
			const r = Num.simplify(over(5, 7));
			expect(r).toEqual(Just(over(5, 7)));
			if (r.kind === "Just") expect(Num.isSimplified(r.value)).toBe(true);
		});
		test("simplifying with a numerator of zero", () => {
			for (const n of [2, 3, 17, 999]) {
				const r = Num.simplify(over(n, 0));
				expect(r).toEqual(Just(Num.zero));
			}
		});
		test("a zero denominator cannot simplify", () => {
			expect(Num.simplify({ kind: "Rational", numerator: 3n, denominator: 0n })).toEqual(Nothing);
			expect(Num.simplify({ kind: "Rational", numerator: 0n, denominator: 0n })).toEqual(Nothing);
		});
		test("keeps the denominator positive", () => {
			expect(Num.simplify(makeNumber(3, -6))).toEqual(Just({ kind: "Rational", numerator: -1n, denominator: 2n }));
			expect(Num.simplify(makeNumber(-4, -2))).toEqual(Just({ kind: "Rational", numerator: 2n, denominator: 1n }));
		});
	});

	describe("Number.isSimplified", () => {
		test("reports reduced fractions", () => {
			expect(Num.isSimplified(makeNumber(7, 5))).toBe(true);
			expect(Num.isSimplified(makeNumber(4, 2))).toBe(false);
			expect(Num.isSimplified(Num.zero)).toBe(true);
			expect(Num.isSimplified(makeNumber(0, 5))).toBe(false);
		});
		test("a zero denominator counts as simplified, like the Elm runtime", () => {
			expect(Num.isSimplified({ kind: "Rational", numerator: 3n, denominator: 0n })).toBe(true);
		});
	});

	test("toFractionalString", () => {
		expect(Num.toFractionalString(makeNumber(3, 4))).toBe("3/4");
		expect(Num.toFractionalString(makeNumber(-3, 4))).toBe("-3/4");
		expect(Num.toFractionalString(Num.fromInt(7))).toBe("7/1");
	});

	describe("decimal conversion", () => {
		test("toDecimal divides the components", () => {
			const r = Num.toDecimal(makeNumber(3, 4));
			expect(r.kind).toBe("Just");
			if (r.kind === "Just") expect(r.value.eq(new Decimal("0.75"))).toBe(true);
			const third = Num.toDecimal(makeNumber(1, 3));
			expect(third.kind).toBe("Just");
			if (third.kind === "Just") expect(third.value.toFixed(10)).toBe("0.3333333333");
		});
		test("toDecimal is Nothing when the denominator is zero", () => {
			expect(Num.toDecimal({ kind: "Rational", numerator: 3n, denominator: 0n })).toEqual(Nothing);
		});
		test("coerceToDecimal falls back on a zero denominator", () => {
			const fallback = new Decimal(-1);
			expect(Num.coerceToDecimal(fallback, makeNumber(1, 2)).eq(new Decimal("0.5"))).toBe(true);
			expect(Num.coerceToDecimal(fallback, { kind: "Rational", numerator: 3n, denominator: 0n })).toBe(fallback);
		});
	});
});
