// packages/ir/src/versions/v4/attributes.ts
//
// The concrete attribute records the v4 profile pins onto the generic model,
// their readers, and their canonical writers. Attributes are optional on the
// wire and overwhelmingly empty, so the writers return null when there is
// nothing to say and the node writers omit the member entirely.
import { type Ctx, at, expectNumber, expectObject, fail, members } from "../../codec/json/cursor.ts";
import { type JsonObject, type JsonValue, isInteger, jsonNumber, jsonObject } from "../../codec/json/value.ts";
import type { Diagnostic } from "../../model/diagnostic.ts";
import { type Result, ok } from "../../model/result.ts";
import type { Type } from "../../model/types.ts";
import { readType } from "./read-types.ts";
import { writeType } from "./write-types.ts";

// The records v4 pins the model's attribute parameters to. They are part of
// this wire format, not of the semantic model, so they live here and the
// generic model never mentions them.

export interface SourceLocation {
	readonly startLine: number;
	readonly startColumn: number;
	readonly endLine: number;
	readonly endColumn: number;
}

// Constraints and extensions are opaque payloads: the profile carries them
// through unread, so they are the parsed JSON object itself — ordered, with its
// number lexemes intact — and are written back unchanged. Nothing here inspects
// or rebuilds them, which is why 12345678901234567890 and 1.50 survive a round
// trip and why an object that looks like a number stays an object.
export interface TypeAttributes {
	readonly source: SourceLocation | null;
	readonly constraints: JsonObject;
	readonly extensions: JsonObject;
}

export interface ValueAttributes<TA> {
	readonly source: SourceLocation | null;
	readonly inferredType: Type<TA> | null;
	readonly extensions: JsonObject;
}

// An empty payload, built fresh. This is a hoisted function rather than a
// shared const because the v4 readers form an import cycle: read-values.ts
// builds its empty value attributes while this module is still initializing,
// when a function declaration is already bound and a const is not.
function emptyPayload(): JsonObject { return jsonObject([]); }

export const EMPTY_TYPE_ATTRIBUTES: TypeAttributes = { source: null, constraints: emptyPayload(), extensions: emptyPayload() };
export function emptyValueAttributes<TA>(): ValueAttributes<TA> {
	return { source: null, inferredType: null, extensions: emptyPayload() };
}

export type TA = TypeAttributes;
export type VA = ValueAttributes<TypeAttributes>;

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
	let constraints: JsonObject = emptyPayload();
	const rawConstraints = m.value.get("constraints");
	if (rawConstraints !== undefined) {
		const c = expectObject(at(ctx, "constraints"), rawConstraints);
		if (!c.ok) return c;
		constraints = c.value;
	}
	let extensions: JsonObject = emptyPayload();
	const rawExtensions = m.value.get("extensions");
	if (rawExtensions !== undefined) {
		const e = expectObject(at(ctx, "extensions"), rawExtensions);
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
	let extensions: JsonObject = emptyPayload();
	const rawExtensions = m.value.get("extensions");
	if (rawExtensions !== undefined) {
		const e = expectObject(at(ctx, "extensions"), rawExtensions);
		if (!e.ok) return e;
		extensions = e.value;
	}
	return ok({ source, inferredType, extensions });
}

const isEmptyMap = (m: JsonObject): boolean => m.members.size === 0;

export function isEmptyTA(a: TA): boolean {
	return a.source === null && isEmptyMap(a.constraints) && isEmptyMap(a.extensions);
}
export function isEmptyVA(a: VA): boolean {
	return a.source === null && a.inferredType === null && isEmptyMap(a.extensions);
}

function writeSourceLocation(s: SourceLocation): JsonObject {
	return jsonObject(SOURCE_MEMBERS.map((key) => [key, jsonNumber(String(s[key]))] as const));
}

// An attributes record with nothing to say is written as no member at all,
// which is what `null` means to the node writers here. Clearing a tree for
// comparison replaces each record with the empty one rather than dropping it,
// so these stay total over TA and VA.
export function writeTypeAttributes(a: TA): JsonObject | null {
	if (isEmptyTA(a)) return null;
	const entries: (readonly [string, JsonValue])[] = [];
	if (a.source !== null) entries.push(["source", writeSourceLocation(a.source)]);
	if (!isEmptyMap(a.constraints)) entries.push(["constraints", a.constraints]);
	if (!isEmptyMap(a.extensions)) entries.push(["extensions", a.extensions]);
	return jsonObject(entries);
}

export function writeValueAttributes(a: VA): JsonObject | null {
	if (isEmptyVA(a)) return null;
	const entries: (readonly [string, JsonValue])[] = [];
	if (a.source !== null) entries.push(["source", writeSourceLocation(a.source)]);
	if (a.inferredType !== null) entries.push(["inferredType", writeType(a.inferredType)]);
	if (!isEmptyMap(a.extensions)) entries.push(["extensions", a.extensions]);
	return jsonObject(entries);
}
