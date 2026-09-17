// packages/ir/src/model/decimal.test.ts
// The decimal lexeme grammar the v4 schema page states; every binding applies it.
import { describe, expect, test } from "bun:test";
import { Decimal } from "decimal.js";
import { decimalLiteral, isDecimalLexeme, parseDecimal } from "./decimal.ts";

describe("decimal lexeme grammar", () => {
	test("accepts the spellings the grammar names", () => {
		for (const s of ["0", "10.50", "-0.00", "+12.", ".5", "1e-7", "1E+3", "-.5e2", "007"]) {
			expect(isDecimalLexeme(s)).toBe(true);
		}
	});
	test("refuses everything else", () => {
		for (const s of ["", "ten", ".", "+", "1_000", "0x10", "NaN", "Infinity", "-Infinity", "1e", "1e+", " 1", "1 ", "1.5.2", "1,5"]) {
			expect(isDecimalLexeme(s)).toBe(false);
		}
	});
	test("parseDecimal returns the literal as a value", () => {
		const r = parseDecimal("10.50");
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.kind).toBe("DecimalLiteral");
		expect(r.value.lexeme).toBe("10.50");
		expect(r.value.value.equals(new Decimal("10.5"))).toBe(true);
	});
	test("parseDecimal returns the error as a value", () => {
		const r = parseDecimal("ten");
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toEqual({ kind: "DecimalParseError", lexeme: "ten", message: '"ten" is not a decimal lexeme' });
	});
	test("decimalLiteral is the convenience for a lexeme known to be good", () => {
		expect(decimalLiteral("-0.00").lexeme).toBe("-0.00");
		expect(() => decimalLiteral("ten")).toThrow('"ten" is not a decimal lexeme');
	});
});
