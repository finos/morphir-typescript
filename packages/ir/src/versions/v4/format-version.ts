// packages/ir/src/versions/v4/format-version.ts
//
// The v3-and-later formatVersion contract (docs/spec/ir/format-version.md):
// recognition, normalization, canonical spelling, and the support table.
import { at, type Ctx, fail } from "../../codec/json/cursor.ts";
import { isNumber, type JsonObject, type JsonValue, jsonNumber } from "../../codec/json/value.ts";
import type { Diagnostic } from "../../model/diagnostic.ts";
import type { FormatVersion } from "../../model/distribution.ts";
import { ok, type Result } from "../../model/result.ts";
import { type SupportTable, type Compatibility as TableCompatibility, compatibility as tableCompatibility } from "../support-table.ts";

export interface Recognized {
	readonly normalized: FormatVersion;
	readonly canonical: JsonValue;
}

/**
 * The contract's reference support table (docs/spec/ir/format-version.md,
 * "Recognition and compatibility"): what the specification says is live across
 * the ecosystem, and what the conformance corpus is checked against. It is not
 * what this binding reads — that table is `SUPPORT_TABLE` in read-distribution.ts.
 */
export const REFERENCE_SUPPORT_TABLE = "[3.0.0,3.1.0),[4.0.0,4.1.0)";

const MAX = 4294967295;
const COMPONENT = /^(0|[1-9][0-9]*)$/;

export function canonicalFormatVersion(fv: FormatVersion): JsonValue {
	return fv.minor === 0 && fv.patch === 0 ? jsonNumber(String(fv.major)) : `${fv.major}.${fv.minor}.${fv.patch}`;
}

export function recognize(ctx: Ctx, v: JsonValue): Result<Recognized, Diagnostic> {
	if (isNumber(v)) {
		// Anything that isn't an unsigned-integer lexeme (negative sign, a
		// fraction, exponent, ...) is a type mismatch, not a syntax error: the
		// conformance corpus expects `invalid_format_version_type` uniformly for
		// negative and fractional numbers, reserving `invalid_format_version_syntax`
		// for values that parse as an unsigned integer but are semantically
		// invalid (namely 0).
		if (!COMPONENT.test(v.text)) {
			return fail(ctx, "invalid_format_version_type", `formatVersion ${v.text} is not an unsigned integer`);
		}
		const major = Number(v.text);
		if (major > MAX) return fail(ctx, "format_version_out_of_range", `formatVersion ${v.text} exceeds the 32-bit range`);
		if (major === 0) return fail(ctx, "invalid_format_version_syntax", "formatVersion 0 is not a format family");
		const normalized = { major, minor: 0, patch: 0 };
		return ok({ normalized, canonical: canonicalFormatVersion(normalized) });
	}
	if (typeof v === "string") {
		const parts = v.split(".");
		if (parts.length !== 3 || !parts.every((p) => COMPONENT.test(p))) {
			return fail(ctx, "invalid_format_version_syntax", `formatVersion "${v}" is not an exact N.minor.patch release`);
		}
		const [major, minor, patch] = parts.map(Number) as [number, number, number];
		if (major < 3) return fail(ctx, "invalid_format_version_syntax", `release strings are valid only for major 3 and later, got "${v}"`);
		if (major > MAX || minor > MAX || patch > MAX)
			return fail(ctx, "format_version_out_of_range", `formatVersion "${v}" has a component above the 32-bit range`);
		const normalized = { major, minor, patch };
		return ok({ normalized, canonical: canonicalFormatVersion(normalized) });
	}
	return fail(ctx, "invalid_format_version_type", "formatVersion must be an unsigned integer or a release string");
}

export type Compatibility = TableCompatibility;

/**
 * The verdict for a recognized format version against a support table. A
 * `FormatVersion` is already an exact release, so this is the table's own
 * membership question with the arguments in reader order.
 */
export function compatibility(fv: FormatVersion, table: SupportTable): Compatibility {
	return tableCompatibility(table, fv);
}

export function readFormatVersionMember(ctx: Ctx, rootObject: JsonObject): Result<Recognized, Diagnostic> {
	const v = rootObject.members.get("formatVersion");
	if (v === undefined) return fail(ctx, "missing_format_version", "the root has no formatVersion member");
	return recognize(at(ctx, "formatVersion"), v);
}
