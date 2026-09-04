// packages/ir/src/codec/json/cursor.ts
//
// Reader context: a cursor path for diagnostics and the small set of
// structural checks every v4 reader uses. Unknown members are checked before
// missing ones so a renamed member is reported as unknown_member, which is
// what the kit's rejected fences expect.
import { type Diagnostic, type DiagnosticCode, diagnostic } from "../../model/diagnostic.ts";
import { type Result, err, ok } from "../../model/result.ts";
import { type JsonNumber, type JsonObject, type JsonValue, isNumber, isObject } from "./value.ts";

export interface Ctx { readonly cursor: string }
export const root: Ctx = { cursor: "" };
export function at(ctx: Ctx, key: string | number): Ctx { return { cursor: `${ctx.cursor}/${key}` }; }

export function fail(ctx: Ctx, code: DiagnosticCode, message: string): Result<never, Diagnostic> {
	return err(diagnostic(code, "normalization", ctx.cursor || "/", message));
}

const describe = (v: JsonValue): string =>
	v === null ? "null" : Array.isArray(v) ? "array" : isObject(v) ? "object" : isNumber(v) ? "number" : typeof v;

export function expectObject(ctx: Ctx, v: JsonValue): Result<JsonObject, Diagnostic> {
	return isObject(v) ? ok(v) : fail(ctx, "invalid_type", `expected an object, found ${describe(v)}`);
}
export function expectArray(ctx: Ctx, v: JsonValue): Result<readonly JsonValue[], Diagnostic> {
	return Array.isArray(v) ? ok(v) : fail(ctx, "invalid_type", `expected an array, found ${describe(v)}`);
}
export function expectString(ctx: Ctx, v: JsonValue): Result<string, Diagnostic> {
	return typeof v === "string" ? ok(v) : fail(ctx, "invalid_type", `expected a string, found ${describe(v)}`);
}
export function expectBoolean(ctx: Ctx, v: JsonValue): Result<boolean, Diagnostic> {
	return typeof v === "boolean" ? ok(v) : fail(ctx, "invalid_type", `expected a boolean, found ${describe(v)}`);
}
export function expectNumber(ctx: Ctx, v: JsonValue): Result<JsonNumber, Diagnostic> {
	return isNumber(v) ? ok(v) : fail(ctx, "invalid_type", `expected a number, found ${describe(v)}`);
}

export function members(ctx: Ctx, o: JsonObject, required: readonly string[], optional: readonly string[]): Result<ReadonlyMap<string, JsonValue>, Diagnostic> {
	for (const key of o.members.keys()) {
		if (!required.includes(key) && !optional.includes(key)) return fail(at(ctx, key), "unknown_member", `unknown member "${key}"`);
	}
	for (const key of required) {
		if (!o.members.has(key)) return fail(ctx, "missing_member", `missing member "${key}"`);
	}
	return ok(o.members);
}

export function singleKey(ctx: Ctx, o: JsonObject): Result<readonly [string, JsonValue], Diagnostic> {
	const entries = [...o.members.entries()];
	const first = entries[0];
	if (entries.length !== 1 || first === undefined) {
		return fail(ctx, "unknown_node", `expected a wrapper object with one member, found ${entries.length}`);
	}
	return ok(first);
}

export function optionalString(ctx: Ctx, m: ReadonlyMap<string, JsonValue>, key: string): Result<string | null, Diagnostic> {
	const v = m.get(key);
	if (v === undefined) return ok(null);
	return expectString(at(ctx, key), v);
}
