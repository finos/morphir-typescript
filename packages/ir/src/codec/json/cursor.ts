// packages/ir/src/codec/json/cursor.ts
//
// Reader context: a cursor path for diagnostics, the warning channel a read
// collects legacy spellings on, and the small set of structural checks every
// v4 reader uses. Unknown members are checked before missing ones so a renamed
// member is reported as unknown_member, which is what the kit's rejected
// fences expect.
//
// There is no shared `root` constant: the context now carries a mutable
// warnings array, and one module-level context would leak warnings from one
// document into the next. Every read starts from its own `newRoot()`.
import { type Diagnostic, type DiagnosticCode, diagnostic } from "../../model/diagnostic.ts";
import { type Result, err, ok } from "../../model/result.ts";
import { MAX_DEPTH, type JsonNumber, type JsonObject, type JsonValue, isNumber, isObject, locationOf } from "./value.ts";

export interface Ctx { readonly cursor: string; readonly depth: number; readonly warnings: Diagnostic[] }
// Each read starts from its own root so warnings never leak between documents.
export function newRoot(): Ctx { return { cursor: "", depth: 0, warnings: [] }; }
export function at(ctx: Ctx, key: string | number): Ctx {
	return { cursor: `${ctx.cursor}/${key}`, depth: ctx.depth + 1, warnings: ctx.warnings };
}

// `near` is the JSON value the failure is about; when the parser recorded a
// location for it the diagnostic carries the line and column, so a reader
// error points at the source and not just at a cursor path.
export function fail(ctx: Ctx, code: DiagnosticCode, message: string, near?: JsonValue): Result<never, Diagnostic> {
	const location = near === undefined ? null : locationOf(near);
	return err(diagnostic(code, "normalization", ctx.cursor || "/", message, location ?? undefined));
}

// A legacy spelling in the compatibility window (decision 0006): accepted,
// reported, never written.
export function warn(ctx: Ctx, message: string, near?: JsonValue): void {
	const location = near === undefined ? null : locationOf(near);
	ctx.warnings.push(diagnostic("legacy_spelling", "normalization", ctx.cursor || "/", message, location ?? undefined));
}

// A member with a canonical and a legacy spelling. Both present is an error at
// the legacy key; only the legacy one warns; neither is missing_member.
//
// The answer carries the key that won as well as its payload, because a caller
// that reads the payload has to name that key on the cursor it reads under and
// would otherwise have to work out which spelling was there a second time.
export interface Windowed { readonly key: string; readonly value: JsonValue }

export function windowed(ctx: Ctx, m: ReadonlyMap<string, JsonValue>, canonical: string, legacy: string, near: JsonValue): Result<Windowed, Diagnostic> {
	const c = m.get(canonical);
	const l = m.get(legacy);
	if (c !== undefined && l !== undefined) return fail(at(ctx, legacy), "unknown_member", `"${legacy}" is the legacy spelling of "${canonical}"; write only one`, near);
	if (c !== undefined) return ok({ key: canonical, value: c });
	if (l !== undefined) { warn(at(ctx, legacy), `"${legacy}" is the legacy spelling of "${canonical}"`, near); return ok({ key: legacy, value: l }); }
	return fail(ctx, "missing_member", `missing member "${canonical}"`, near);
}

// parseJson already bounds the depth of anything read from text, so this only
// catches trees a binding built in memory and handed straight to a reader. It
// is one integer compare per recursive node, which is why the recursive
// readers can afford to call it on the way in.
export function guardDepth(ctx: Ctx): Result<Ctx, Diagnostic> {
	return ctx.depth > MAX_DEPTH ? fail(ctx, "nesting_too_deep", `nesting deeper than ${MAX_DEPTH} is not accepted`) : ok(ctx);
}

// What to call a JSON value in a message. Every reader that has to say what it
// found instead uses this one, so the wording does not drift between modules.
export const describeJson = (v: JsonValue): string =>
	v === null ? "null" : Array.isArray(v) ? "array" : isObject(v) ? "object" : isNumber(v) ? "number" : typeof v;

export function expectObject(ctx: Ctx, v: JsonValue): Result<JsonObject, Diagnostic> {
	return isObject(v) ? ok(v) : fail(ctx, "invalid_type", `expected an object, found ${describeJson(v)}`, v);
}
export function expectArray(ctx: Ctx, v: JsonValue): Result<readonly JsonValue[], Diagnostic> {
	return Array.isArray(v) ? ok(v) : fail(ctx, "invalid_type", `expected an array, found ${describeJson(v)}`, v);
}
export function expectString(ctx: Ctx, v: JsonValue): Result<string, Diagnostic> {
	return typeof v === "string" ? ok(v) : fail(ctx, "invalid_type", `expected a string, found ${describeJson(v)}`, v);
}
export function expectBoolean(ctx: Ctx, v: JsonValue): Result<boolean, Diagnostic> {
	return typeof v === "boolean" ? ok(v) : fail(ctx, "invalid_type", `expected a boolean, found ${describeJson(v)}`, v);
}
export function expectNumber(ctx: Ctx, v: JsonValue): Result<JsonNumber, Diagnostic> {
	return isNumber(v) ? ok(v) : fail(ctx, "invalid_type", `expected a number, found ${describeJson(v)}`, v);
}

export function members(ctx: Ctx, o: JsonObject, required: readonly string[], optional: readonly string[]): Result<ReadonlyMap<string, JsonValue>, Diagnostic> {
	for (const key of o.members.keys()) {
		if (!required.includes(key) && !optional.includes(key)) return fail(at(ctx, key), "unknown_member", `unknown member "${key}"`, o);
	}
	for (const key of required) {
		if (!o.members.has(key)) return fail(ctx, "missing_member", `missing member "${key}"`, o);
	}
	return ok(o.members);
}

export function singleKey(ctx: Ctx, o: JsonObject): Result<readonly [string, JsonValue], Diagnostic> {
	const entries = [...o.members.entries()];
	const first = entries[0];
	if (entries.length !== 1 || first === undefined) {
		return fail(ctx, "unknown_node", `expected a wrapper object with one member, found ${entries.length}`, o);
	}
	return ok(first);
}

export function optionalString(ctx: Ctx, m: ReadonlyMap<string, JsonValue>, key: string): Result<string | null, Diagnostic> {
	const v = m.get(key);
	if (v === undefined) return ok(null);
	return expectString(at(ctx, key), v);
}
