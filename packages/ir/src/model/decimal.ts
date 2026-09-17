// packages/ir/src/model/decimal.ts
//
// A DecimalLiteral is a genuine decimal: its value is a decimal.js Decimal,
// and its lexeme is the text it was written with. decimal.js drops trailing
// zeros (new Decimal("10.50").toString() is "10.5"), so the lexeme is the only
// record of the written spelling and scale; a writer emits the lexeme, and
// structural equality is on the lexeme. Numeric comparison goes through the
// value. The grammar is the one the v4 schema page states under "Literals".
//
// Errors are values: parseDecimal returns a Result whose error names the
// offending lexeme, so a reader can turn it into a diagnostic with a cursor and
// any other caller can match on it. decimalLiteral is the convenience for a
// lexeme the caller already knows is good (a hand-built model, a test); it is
// the one place here that throws.
import { Decimal } from "decimal.js";
import { err, ok, type Result } from "./result.ts";
import type { Literal } from "./values.ts";

export const DECIMAL_LEXEME = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

export type DecimalLiteral = Extract<Literal, { kind: "DecimalLiteral" }>;

export interface DecimalParseError {
	readonly kind: "DecimalParseError";
	readonly lexeme: string;
	readonly message: string;
}

export function isDecimalLexeme(text: string): boolean {
	return DECIMAL_LEXEME.test(text);
}

export function parseDecimal(lexeme: string): Result<DecimalLiteral, DecimalParseError> {
	if (!isDecimalLexeme(lexeme)) {
		return err({ kind: "DecimalParseError", lexeme, message: `${JSON.stringify(lexeme)} is not a decimal lexeme` });
	}
	return ok({ kind: "DecimalLiteral", lexeme, value: new Decimal(lexeme) });
}

// Convenience for a lexeme already known to be good (a hand-built model, a
// test). Throws with parseDecimal's message; a reader must use parseDecimal
// instead so the caller can handle the error as a value.
export function decimalLiteral(lexeme: string): DecimalLiteral {
	const r = parseDecimal(lexeme);
	if (!r.ok) throw new Error(r.error.message);
	return r.value;
}
