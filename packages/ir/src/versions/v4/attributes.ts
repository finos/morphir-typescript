// packages/ir/src/versions/v4/attributes.ts
//
// The concrete attribute records the v4 profile pins onto the generic model,
// their readers, and their canonical writers. Attributes are optional on the
// wire and overwhelmingly empty, so the writers return null when there is
// nothing to say and the node writers omit the member entirely.
import { type Ctx, at, expectNumber, expectObject, fail, members } from "../../codec/json/cursor.ts";
import { type JsonObject, type JsonValue, isInteger, isNumber, isObject, jsonNumber, jsonObject } from "../../codec/json/value.ts";
import type { Json, SourceLocation, TypeAttributes, ValueAttributes } from "../../model/attributes.ts";
import { EMPTY_TYPE_ATTRIBUTES, emptyValueAttributes } from "../../model/attributes.ts";
import type { Diagnostic } from "../../model/diagnostic.ts";
import { type Result, ok } from "../../model/result.ts";
import type { Type } from "../../model/types.ts";
import { readType } from "./read-types.ts";
import { writeType } from "./write-types.ts";

export type TA = TypeAttributes;
export type VA = ValueAttributes<TypeAttributes>;

type JsonMap = { readonly [key: string]: Json };

// Constraints and extensions are opaque payloads: the profile carries them
// through unread, so they cross into the model as plain Json. Number lexemes
// lose their spelling here, which is why only these two members use Json.
export function toJson(v: JsonValue): Json {
	if (v === null || typeof v === "boolean" || typeof v === "string") return v;
	if (isNumber(v)) return Number(v.text);
	if (isObject(v)) {
		const out: Record<string, Json> = {};
		for (const [key, member] of v.members) out[key] = toJson(member);
		return out;
	}
	return v.map(toJson);
}

export function fromJson(j: Json): JsonValue {
	if (j === null || typeof j === "boolean" || typeof j === "string") return j;
	if (typeof j === "number") return jsonNumber(String(j));
	if (Array.isArray(j)) return j.map(fromJson);
	return jsonObject(Object.entries(j as JsonMap).map(([key, value]) => [key, fromJson(value)] as const));
}

const SOURCE_MEMBERS = ["startLine", "startColumn", "endLine", "endColumn"] as const;

function readSourceLocation(ctx: Ctx, v: JsonValue): Result<SourceLocation, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const m = members(ctx, o.value, SOURCE_MEMBERS, []);
	if (!m.ok) return m;
	const parts: number[] = [];
	for (const key of SOURCE_MEMBERS) {
		const n = expectNumber(at(ctx, key), m.value.get(key) as JsonValue);
		if (!n.ok) return n;
		if (!isInteger(n.value)) return fail(at(ctx, key), "invalid_type", `expected an integer, found ${n.value.text}`, n.value);
		parts.push(Number(n.value.text));
	}
	return ok({
		startLine: parts[0] as number,
		startColumn: parts[1] as number,
		endLine: parts[2] as number,
		endColumn: parts[3] as number,
	});
}

function readJsonMap(ctx: Ctx, v: JsonValue): Result<JsonMap, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const out: Record<string, Json> = {};
	for (const [key, member] of o.value.members) out[key] = toJson(member);
	return ok(out);
}

// An absent attributes member and an empty attributes object mean the same
// thing, so the reader accepts undefined rather than forcing every caller to
// branch first.
export function readTypeAttributes(ctx: Ctx, v: JsonValue | undefined): Result<TA, Diagnostic> {
	if (v === undefined) return ok(EMPTY_TYPE_ATTRIBUTES);
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const m = members(ctx, o.value, [], ["source", "constraints", "extensions"]);
	if (!m.ok) return m;
	let source: SourceLocation | null = null;
	const rawSource = m.value.get("source");
	if (rawSource !== undefined) {
		const s = readSourceLocation(at(ctx, "source"), rawSource);
		if (!s.ok) return s;
		source = s.value;
	}
	let constraints: JsonMap = {};
	const rawConstraints = m.value.get("constraints");
	if (rawConstraints !== undefined) {
		const c = readJsonMap(at(ctx, "constraints"), rawConstraints);
		if (!c.ok) return c;
		constraints = c.value;
	}
	let extensions: JsonMap = {};
	const rawExtensions = m.value.get("extensions");
	if (rawExtensions !== undefined) {
		const e = readJsonMap(at(ctx, "extensions"), rawExtensions);
		if (!e.ok) return e;
		extensions = e.value;
	}
	return ok({ source, constraints, extensions });
}

export function readValueAttributes(ctx: Ctx, v: JsonValue | undefined): Result<VA, Diagnostic> {
	if (v === undefined) return ok(emptyValueAttributes<TA>());
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const m = members(ctx, o.value, [], ["source", "inferredType", "extensions"]);
	if (!m.ok) return m;
	let source: SourceLocation | null = null;
	const rawSource = m.value.get("source");
	if (rawSource !== undefined) {
		const s = readSourceLocation(at(ctx, "source"), rawSource);
		if (!s.ok) return s;
		source = s.value;
	}
	let inferredType: Type<TA> | null = null;
	const rawInferred = m.value.get("inferredType");
	if (rawInferred !== undefined) {
		const t = readType(at(ctx, "inferredType"), rawInferred);
		if (!t.ok) return t;
		inferredType = t.value;
	}
	let extensions: JsonMap = {};
	const rawExtensions = m.value.get("extensions");
	if (rawExtensions !== undefined) {
		const e = readJsonMap(at(ctx, "extensions"), rawExtensions);
		if (!e.ok) return e;
		extensions = e.value;
	}
	return ok({ source, inferredType, extensions });
}

const isEmptyMap = (m: JsonMap): boolean => Object.keys(m).length === 0;

export function isEmptyTA(a: TA): boolean {
	return a.source === null && isEmptyMap(a.constraints) && isEmptyMap(a.extensions);
}
export function isEmptyVA(a: VA): boolean {
	return a.source === null && a.inferredType === null && isEmptyMap(a.extensions);
}

function writeSourceLocation(s: SourceLocation): JsonObject {
	return jsonObject(SOURCE_MEMBERS.map((key) => [key, jsonNumber(String(s[key]))] as const));
}

function writeJsonMap(m: JsonMap): JsonObject {
	return jsonObject(Object.entries(m).map(([key, value]) => [key, fromJson(value)] as const));
}

// Stripped trees (the kit's comparison mode) carry `null` in place of a TA/VA
// record rather than an empty one, so the writer accepts `null` here too and
// treats it exactly like an empty attributes record: nothing to say, member
// omitted.
export function writeTypeAttributes(a: TA | null): JsonObject | null {
	if (a === null || isEmptyTA(a)) return null;
	const entries: (readonly [string, JsonValue])[] = [];
	if (a.source !== null) entries.push(["source", writeSourceLocation(a.source)]);
	if (!isEmptyMap(a.constraints)) entries.push(["constraints", writeJsonMap(a.constraints)]);
	if (!isEmptyMap(a.extensions)) entries.push(["extensions", writeJsonMap(a.extensions)]);
	return jsonObject(entries);
}

export function writeValueAttributes(a: VA | null): JsonObject | null {
	if (a === null || isEmptyVA(a)) return null;
	const entries: (readonly [string, JsonValue])[] = [];
	if (a.source !== null) entries.push(["source", writeSourceLocation(a.source)]);
	if (a.inferredType !== null) entries.push(["inferredType", writeType(a.inferredType)]);
	if (!isEmptyMap(a.extensions)) entries.push(["extensions", writeJsonMap(a.extensions)]);
	return jsonObject(entries);
}
