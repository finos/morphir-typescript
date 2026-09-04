// packages/ir/src/versions/v4/read-values.ts
//
// The v4 reader for literals, patterns, value expressions, value definitions
// and value specifications.
//
// Three rulings shape this module. At value position a bare string is a
// shorthand — an FQName spells a Reference, a Name spells a Variable (kit
// values-0002, values-0003) — but a bare boolean, a bare number and a bare
// array are not: the schema lists them as shorthands and in the same breath
// forbids them, so they are ambiguous_shorthand (kit values-0008, bead
// morphir-ir-v4-stabilize.4). The accepted literal shorthand is the one
// inside the wrapper, { "Literal": 42 }. And every value and pattern wrapper
// takes two spellings: the compact one the schema documents, and an expanded
// object carrying an "attributes" member beside the rest (provisional, bead
// morphir-ir-v4-stabilize.1), which is also what admits Hole, Native and
// External at value position.
import { type Ctx, at, expectArray, expectObject, expectString, fail, guardDepth, members, optionalString, singleKey } from "../../codec/json/cursor.ts";
import { type JsonObject, type JsonValue, isInteger, isNumber, isObject } from "../../codec/json/value.ts";
import { emptyValueAttributes } from "../../model/attributes.ts";
import type { Diagnostic } from "../../model/diagnostic.ts";
import type { Name } from "../../model/names.ts";
import { type Result, ok } from "../../model/result.ts";
import type { Type } from "../../model/types.ts";
import type {
	InputType,
	LetBinding,
	Literal,
	NativeHint,
	NativeInfo,
	Pattern,
	PatternCase,
	RecordField,
	Value,
	ValueDefinition,
	ValueSpecification,
} from "../../model/values.ts";
import { type TA, type VA, readValueAttributes } from "./attributes.ts";
import { isFQNameString, readFQName, readName } from "./read-names.ts";
import { readAnnotations, readHoleReason, readIncompleteness, readType } from "./read-types.ts";

const EMPTY_VA: VA = emptyValueAttributes<TA>();

// ---------------------------------------------------------------- helpers

// Every expanded payload starts the same way: check the member set, then read
// the optional value attributes out of it. The type-side twin lives in
// read-types.ts; the two differ only in which attribute reader they call.
function expanded(
	ctx: Ctx,
	v: JsonValue,
	required: readonly string[],
	optional: readonly string[],
): Result<{ readonly m: ReadonlyMap<string, JsonValue>; readonly a: VA }, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const m = members(ctx, o.value, required, ["attributes", ...optional]);
	if (!m.ok) return m;
	const a = readValueAttributes(at(ctx, "attributes"), m.value.get("attributes"));
	return a.ok ? ok({ m: m.value, a: a.value }) : a;
}

// A named map is a JSON object whose member names are Morphir names: record
// fields, record updates, let-recursion bindings, input types.
function readNamedMap<T>(
	ctx: Ctx,
	v: JsonValue,
	read: (c: Ctx, x: JsonValue) => Result<T, Diagnostic>,
): Result<readonly (readonly [Name, T])[], Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const out: (readonly [Name, T])[] = [];
	for (const [key, member] of o.value.members) {
		const name = readName(at(ctx, key), key);
		if (!name.ok) return name;
		const item = read(at(ctx, key), member);
		if (!item.ok) return item;
		out.push([name.value, item.value] as const);
	}
	return ok(out);
}

function readRecordFieldMap(ctx: Ctx, o: JsonObject): Result<readonly RecordField<TA, VA>[], Diagnostic> {
	const out: RecordField<TA, VA>[] = [];
	for (const [key, member] of o.members) {
		const name = readName(at(ctx, key), key);
		if (!name.ok) return name;
		const value = readValue(at(ctx, key), member);
		if (!value.ok) return value;
		out.push({ name: name.value, value: value.value });
	}
	return ok(out);
}

function readRecordFields(ctx: Ctx, v: JsonValue): Result<readonly RecordField<TA, VA>[], Diagnostic> {
	const o = expectObject(ctx, v);
	return o.ok ? readRecordFieldMap(ctx, o.value) : o;
}

function readValues(ctx: Ctx, v: JsonValue): Result<readonly Value<TA, VA>[], Diagnostic> {
	const a = expectArray(ctx, v);
	if (!a.ok) return a;
	const out: Value<TA, VA>[] = [];
	for (let i = 0; i < a.value.length; i += 1) {
		const one = readValue(at(ctx, i), a.value[i] as JsonValue);
		if (!one.ok) return one;
		out.push(one.value);
	}
	return ok(out);
}

function readPatterns(ctx: Ctx, v: JsonValue): Result<readonly Pattern<VA>[], Diagnostic> {
	const a = expectArray(ctx, v);
	if (!a.ok) return a;
	const out: Pattern<VA>[] = [];
	for (let i = 0; i < a.value.length; i += 1) {
		const one = readPattern(at(ctx, i), a.value[i] as JsonValue);
		if (!one.ok) return one;
		out.push(one.value);
	}
	return ok(out);
}

// --------------------------------------------------------------- literals

const describe = (v: JsonValue): string =>
	v === null ? "null" : Array.isArray(v) ? "array" : isObject(v) ? "object" : isNumber(v) ? "number" : typeof v;

// The compact payload of every literal is a scalar, so an object payload is
// always the expanded { "value": ... } spelling and never a literal in its
// own right.
function literalPayload(ctx: Ctx, v: JsonValue): Result<JsonValue, Diagnostic> {
	if (!isObject(v)) return ok(v);
	const m = members(ctx, v, ["value"], []);
	return m.ok ? ok(m.value.get("value") as JsonValue) : m;
}

function floatLiteral(ctx: Ctx, text: string): Result<Literal, Diagnostic> {
	const value = Number(text);
	return Number.isFinite(value)
		? ok({ kind: "FloatLiteral", value })
		: fail(ctx, "invalid_literal", `float literal ${text} is out of range`);
}

export function readLiteral(ctx: Ctx, v: JsonValue): Result<Literal, Diagnostic> {
	if (!isObject(v)) return fail(ctx, "invalid_literal", `expected a literal wrapper object, found ${describe(v)}`);
	const entries = [...v.members.entries()];
	const first = entries[0];
	if (entries.length !== 1 || first === undefined) {
		return fail(ctx, "invalid_literal", `expected a literal wrapper with one member, found ${entries.length}`);
	}
	const [key, raw] = first;
	const inner = at(ctx, key);
	const unwrapped = literalPayload(inner, raw);
	if (!unwrapped.ok) return unwrapped;
	const p = unwrapped.value;
	const wrong = (what: string): Result<never, Diagnostic> =>
		fail(inner, "invalid_literal", `${key} expects ${what}, found ${describe(p)}`);
	switch (key) {
		case "BoolLiteral":
			return typeof p === "boolean" ? ok({ kind: "BoolLiteral", value: p }) : wrong("a boolean");
		case "CharLiteral":
			// One code point, not one UTF-16 unit, so an astral character still fits.
			return typeof p === "string" && [...p].length === 1 ? ok({ kind: "CharLiteral", value: p }) : wrong("a one-character string");
		case "StringLiteral":
			return typeof p === "string" ? ok({ kind: "StringLiteral", value: p }) : wrong("a string");
		// WholeNumberLiteral is the old spelling; it is read and never written.
		case "IntegerLiteral": case "WholeNumberLiteral":
			return isNumber(p) && isInteger(p) ? ok({ kind: "IntegerLiteral", value: BigInt(p.text) }) : wrong("an integer lexeme");
		case "FloatLiteral":
			return isNumber(p) ? floatLiteral(inner, p.text) : wrong("a number");
		case "DecimalLiteral":
			// Carried as text so no binding rounds it into a float.
			return typeof p === "string" ? ok({ kind: "DecimalLiteral", value: p }) : wrong("a string");
		default:
			return fail(ctx, "invalid_literal", `unknown literal "${key}"`);
	}
}

export function readLiteralShorthand(ctx: Ctx, v: JsonValue): Result<Literal, Diagnostic> {
	if (typeof v === "boolean") return ok({ kind: "BoolLiteral", value: v });
	if (typeof v === "string") return ok({ kind: "StringLiteral", value: v });
	// A number lexeme with no fraction and no exponent is an integer; anything
	// else that parses is a float.
	if (isNumber(v)) return isInteger(v) ? ok({ kind: "IntegerLiteral", value: BigInt(v.text) }) : floatLiteral(ctx, v.text);
	return readLiteral(ctx, v);
}

// The payload shared by { "Literal": .. } and { "LiteralPattern": .. }: a
// shorthand scalar, a typed wrapper, or the expanded {attributes?, literal}.
// "literal" and "attributes" are not literal wrapper keys, so either member
// settles which spelling is in front of us.
function readLiteralPayload(ctx: Ctx, v: JsonValue): Result<{ readonly literal: Literal; readonly a: VA }, Diagnostic> {
	if (isObject(v) && (v.members.has("literal") || v.members.has("attributes"))) {
		const e = expanded(ctx, v, ["literal"], []);
		if (!e.ok) return e;
		const l = readLiteralShorthand(at(ctx, "literal"), e.value.m.get("literal") as JsonValue);
		return l.ok ? ok({ literal: l.value, a: e.value.a }) : l;
	}
	const l = readLiteralShorthand(ctx, v);
	return l.ok ? ok({ literal: l.value, a: EMPTY_VA }) : l;
}

// --------------------------------------------------------------- patterns

export function readPattern(ctx: Ctx, v: JsonValue): Result<Pattern<VA>, Diagnostic> {
	const depth = guardDepth(ctx);
	if (!depth.ok) return depth;
	// A bare array is a TuplePattern; no other pattern uses one, so unlike at
	// value position there is nothing to be ambiguous about.
	if (Array.isArray(v)) {
		const patterns = readPatterns(ctx, v);
		return patterns.ok ? ok({ kind: "TuplePattern", attributes: EMPTY_VA, patterns: patterns.value }) : patterns;
	}
	if (!isObject(v)) return fail(ctx, "invalid_type", `expected a pattern, found ${describe(v)}`);
	const kv = singleKey(ctx, v);
	if (!kv.ok) return kv;
	const [key, payload] = kv.value;
	const inner = at(ctx, key);
	switch (key) {
		case "WildcardPattern": case "EmptyListPattern": case "UnitPattern": {
			const e = expanded(inner, payload, [], []);
			return e.ok ? ok({ kind: key, attributes: e.value.a }) : e;
		}
		case "AsPattern": {
			const e = expanded(inner, payload, ["pattern", "name"], []);
			if (!e.ok) return e;
			const pattern = readPattern(at(inner, "pattern"), e.value.m.get("pattern") as JsonValue);
			if (!pattern.ok) return pattern;
			const name = readName(at(inner, "name"), e.value.m.get("name") as JsonValue);
			if (!name.ok) return name;
			return ok({ kind: "AsPattern", attributes: e.value.a, pattern: pattern.value, name: name.value });
		}
		case "TuplePattern": {
			if (isObject(payload)) {
				const e = expanded(inner, payload, ["patterns"], []);
				if (!e.ok) return e;
				const patterns = readPatterns(at(inner, "patterns"), e.value.m.get("patterns") as JsonValue);
				return patterns.ok ? ok({ kind: "TuplePattern", attributes: e.value.a, patterns: patterns.value }) : patterns;
			}
			const patterns = readPatterns(inner, payload);
			return patterns.ok ? ok({ kind: "TuplePattern", attributes: EMPTY_VA, patterns: patterns.value }) : patterns;
		}
		case "ConstructorPattern": {
			const e = expanded(inner, payload, ["fqname", "patterns"], []);
			if (!e.ok) return e;
			const fqname = readFQName(at(inner, "fqname"), e.value.m.get("fqname") as JsonValue);
			if (!fqname.ok) return fqname;
			const patterns = readPatterns(at(inner, "patterns"), e.value.m.get("patterns") as JsonValue);
			if (!patterns.ok) return patterns;
			return ok({ kind: "ConstructorPattern", attributes: e.value.a, fqname: fqname.value, patterns: patterns.value });
		}
		case "HeadTailPattern": {
			const e = expanded(inner, payload, ["head", "tail"], []);
			if (!e.ok) return e;
			const head = readPattern(at(inner, "head"), e.value.m.get("head") as JsonValue);
			if (!head.ok) return head;
			const tail = readPattern(at(inner, "tail"), e.value.m.get("tail") as JsonValue);
			if (!tail.ok) return tail;
			return ok({ kind: "HeadTailPattern", attributes: e.value.a, head: head.value, tail: tail.value });
		}
		case "LiteralPattern": {
			const l = readLiteralPayload(inner, payload);
			return l.ok ? ok({ kind: "LiteralPattern", attributes: l.value.a, literal: l.value.literal }) : l;
		}
		default:
			return fail(ctx, "unknown_node", `unknown pattern node "${key}"`);
	}
}

// ----------------------------------------------------------------- values

const BARE_BOOLEAN = 'a bare boolean at value position is ambiguous; write { "Literal": { "BoolLiteral": .. } }';
const BARE_NUMBER = 'a bare number at value position is ambiguous; write { "Literal": { "IntegerLiteral": .. } }';
const BARE_ARRAY = 'a bare array at value position is ambiguous between Tuple and List; write { "List": [..] } or { "Tuple": [..] }';

export function readValue(ctx: Ctx, v: JsonValue): Result<Value<TA, VA>, Diagnostic> {
	const depth = guardDepth(ctx);
	if (!depth.ok) return depth;
	// A bare string is the one shorthand the kit settles: an FQName is a
	// Reference, anything else is a Variable.
	if (typeof v === "string") {
		if (isFQNameString(v)) {
			const fq = readFQName(ctx, v);
			return fq.ok ? ok({ kind: "Reference", attributes: EMPTY_VA, fqname: fq.value }) : fq;
		}
		const n = readName(ctx, v);
		return n.ok ? ok({ kind: "Variable", attributes: EMPTY_VA, name: n.value }) : n;
	}
	if (typeof v === "boolean") return fail(ctx, "ambiguous_shorthand", BARE_BOOLEAN);
	if (isNumber(v)) return fail(ctx, "ambiguous_shorthand", BARE_NUMBER);
	if (Array.isArray(v)) return fail(ctx, "ambiguous_shorthand", BARE_ARRAY);
	if (!isObject(v)) return fail(ctx, "invalid_type", `expected a value expression, found ${describe(v)}`);
	const kv = singleKey(ctx, v);
	if (!kv.ok) return kv;
	const [key, payload] = kv.value;
	const inner = at(ctx, key);
	switch (key) {
		case "Literal": {
			const l = readLiteralPayload(inner, payload);
			return l.ok ? ok({ kind: "Literal", attributes: l.value.a, literal: l.value.literal }) : l;
		}
		case "Constructor": case "Reference": return readFQNameValue(inner, key, payload);
		case "Variable": case "FieldFunction": return readNameValue(inner, key, payload);
		case "Tuple": return readSequenceValue(inner, "Tuple", "elements", payload);
		case "List": return readSequenceValue(inner, "List", "items", payload);
		case "Record": return readRecordValue(inner, payload);
		case "Unit": {
			const e = expanded(inner, payload, [], []);
			return e.ok ? ok({ kind: "Unit", attributes: e.value.a }) : e;
		}
		case "Field": {
			const e = expanded(inner, payload, ["target", "name"], []);
			if (!e.ok) return e;
			const target = readValue(at(inner, "target"), e.value.m.get("target") as JsonValue);
			if (!target.ok) return target;
			const name = readName(at(inner, "name"), e.value.m.get("name") as JsonValue);
			if (!name.ok) return name;
			return ok({ kind: "Field", attributes: e.value.a, target: target.value, name: name.value });
		}
		case "Apply": {
			const e = expanded(inner, payload, ["function", "argument"], []);
			if (!e.ok) return e;
			const fn = readValue(at(inner, "function"), e.value.m.get("function") as JsonValue);
			if (!fn.ok) return fn;
			const argument = readValue(at(inner, "argument"), e.value.m.get("argument") as JsonValue);
			if (!argument.ok) return argument;
			return ok({ kind: "Apply", attributes: e.value.a, function: fn.value, argument: argument.value });
		}
		case "Lambda": {
			const e = expanded(inner, payload, ["pattern", "body"], []);
			if (!e.ok) return e;
			const pattern = readPattern(at(inner, "pattern"), e.value.m.get("pattern") as JsonValue);
			if (!pattern.ok) return pattern;
			const body = readValue(at(inner, "body"), e.value.m.get("body") as JsonValue);
			if (!body.ok) return body;
			return ok({ kind: "Lambda", attributes: e.value.a, pattern: pattern.value, body: body.value });
		}
		case "LetDefinition": {
			const e = expanded(inner, payload, ["name", "definition", "in"], []);
			if (!e.ok) return e;
			const name = readName(at(inner, "name"), e.value.m.get("name") as JsonValue);
			if (!name.ok) return name;
			const definition = readValueDefinition(at(inner, "definition"), e.value.m.get("definition") as JsonValue);
			if (!definition.ok) return definition;
			const body = readValue(at(inner, "in"), e.value.m.get("in") as JsonValue);
			if (!body.ok) return body;
			return ok({ kind: "LetDefinition", attributes: e.value.a, name: name.value, definition: definition.value, in: body.value });
		}
		case "LetRecursion": {
			const e = expanded(inner, payload, ["definitions", "in"], []);
			if (!e.ok) return e;
			const pairs = readNamedMap(at(inner, "definitions"), e.value.m.get("definitions") as JsonValue, readValueDefinition);
			if (!pairs.ok) return pairs;
			const body = readValue(at(inner, "in"), e.value.m.get("in") as JsonValue);
			if (!body.ok) return body;
			const definitions: readonly LetBinding<TA, VA>[] = pairs.value.map(([name, definition]) => ({ name, definition }));
			return ok({ kind: "LetRecursion", attributes: e.value.a, definitions, in: body.value });
		}
		case "Destructure": {
			const e = expanded(inner, payload, ["pattern", "value", "in"], []);
			if (!e.ok) return e;
			const pattern = readPattern(at(inner, "pattern"), e.value.m.get("pattern") as JsonValue);
			if (!pattern.ok) return pattern;
			const value = readValue(at(inner, "value"), e.value.m.get("value") as JsonValue);
			if (!value.ok) return value;
			const body = readValue(at(inner, "in"), e.value.m.get("in") as JsonValue);
			if (!body.ok) return body;
			return ok({ kind: "Destructure", attributes: e.value.a, pattern: pattern.value, value: value.value, in: body.value });
		}
		case "IfThenElse": {
			// The Rust encoder writes thenBranch and elseBranch; those are
			// unknown_member here (kit values-0005, bead morphir-ir-v4-stabilize.3).
			const e = expanded(inner, payload, ["condition", "then", "else"], []);
			if (!e.ok) return e;
			const condition = readValue(at(inner, "condition"), e.value.m.get("condition") as JsonValue);
			if (!condition.ok) return condition;
			const thenBranch = readValue(at(inner, "then"), e.value.m.get("then") as JsonValue);
			if (!thenBranch.ok) return thenBranch;
			const elseBranch = readValue(at(inner, "else"), e.value.m.get("else") as JsonValue);
			if (!elseBranch.ok) return elseBranch;
			return ok({ kind: "IfThenElse", attributes: e.value.a, condition: condition.value, then: thenBranch.value, else: elseBranch.value });
		}
		case "PatternMatch": {
			const e = expanded(inner, payload, ["value", "cases"], []);
			if (!e.ok) return e;
			const value = readValue(at(inner, "value"), e.value.m.get("value") as JsonValue);
			if (!value.ok) return value;
			const cases = readPatternCases(at(inner, "cases"), e.value.m.get("cases") as JsonValue);
			if (!cases.ok) return cases;
			return ok({ kind: "PatternMatch", attributes: e.value.a, value: value.value, cases: cases.value });
		}
		case "UpdateRecord": {
			const e = expanded(inner, payload, ["target", "fields"], []);
			if (!e.ok) return e;
			const target = readValue(at(inner, "target"), e.value.m.get("target") as JsonValue);
			if (!target.ok) return target;
			const fields = readRecordFields(at(inner, "fields"), e.value.m.get("fields") as JsonValue);
			if (!fields.ok) return fields;
			return ok({ kind: "UpdateRecord", attributes: e.value.a, target: target.value, fields: fields.value });
		}
		case "Hole": {
			const e = expanded(inner, payload, ["reason"], ["expectedType"]);
			if (!e.ok) return e;
			const reason = readHoleReason(at(inner, "reason"), e.value.m.get("reason") as JsonValue);
			if (!reason.ok) return reason;
			const raw = e.value.m.get("expectedType");
			if (raw === undefined) return ok({ kind: "Hole", attributes: e.value.a, reason: reason.value, expectedType: null });
			const expectedType = readType(at(inner, "expectedType"), raw);
			return expectedType.ok
				? ok({ kind: "Hole", attributes: e.value.a, reason: reason.value, expectedType: expectedType.value })
				: expectedType;
		}
		case "Native": {
			const e = expanded(inner, payload, ["fqname", "nativeInfo"], []);
			if (!e.ok) return e;
			const fqname = readFQName(at(inner, "fqname"), e.value.m.get("fqname") as JsonValue);
			if (!fqname.ok) return fqname;
			const nativeInfo = readNativeInfo(at(inner, "nativeInfo"), e.value.m.get("nativeInfo") as JsonValue);
			if (!nativeInfo.ok) return nativeInfo;
			return ok({ kind: "Native", attributes: e.value.a, fqname: fqname.value, nativeInfo: nativeInfo.value });
		}
		case "External": {
			const e = expanded(inner, payload, ["externalName", "targetPlatform"], []);
			if (!e.ok) return e;
			const externalName = expectString(at(inner, "externalName"), e.value.m.get("externalName") as JsonValue);
			if (!externalName.ok) return externalName;
			const targetPlatform = expectString(at(inner, "targetPlatform"), e.value.m.get("targetPlatform") as JsonValue);
			if (!targetPlatform.ok) return targetPlatform;
			return ok({ kind: "External", attributes: e.value.a, externalName: externalName.value, targetPlatform: targetPlatform.value });
		}
		default:
			return fail(ctx, "unknown_node", `unknown value node "${key}"`);
	}
}

function readFQNameValue(ctx: Ctx, kind: "Constructor" | "Reference", v: JsonValue): Result<Value<TA, VA>, Diagnostic> {
	// The compact payload is an FQName string, never an object, so any object
	// here is the expanded form.
	if (isObject(v)) {
		const e = expanded(ctx, v, ["fqname"], []);
		if (!e.ok) return e;
		const fq = readFQName(at(ctx, "fqname"), e.value.m.get("fqname") as JsonValue);
		return fq.ok ? ok({ kind, attributes: e.value.a, fqname: fq.value }) : fq;
	}
	const fq = readFQName(ctx, v);
	return fq.ok ? ok({ kind, attributes: EMPTY_VA, fqname: fq.value }) : fq;
}

function readNameValue(ctx: Ctx, kind: "Variable" | "FieldFunction", v: JsonValue): Result<Value<TA, VA>, Diagnostic> {
	if (isObject(v)) {
		const e = expanded(ctx, v, ["name"], []);
		if (!e.ok) return e;
		const n = readName(at(ctx, "name"), e.value.m.get("name") as JsonValue);
		return n.ok ? ok({ kind, attributes: e.value.a, name: n.value }) : n;
	}
	const n = readName(ctx, v);
	return n.ok ? ok({ kind, attributes: EMPTY_VA, name: n.value }) : n;
}

function readSequenceValue(
	ctx: Ctx,
	kind: "Tuple" | "List",
	member: "elements" | "items",
	v: JsonValue,
): Result<Value<TA, VA>, Diagnostic> {
	if (isObject(v)) {
		const e = expanded(ctx, v, [member], []);
		if (!e.ok) return e;
		const items = readValues(at(ctx, member), e.value.m.get(member) as JsonValue);
		if (!items.ok) return items;
		return ok(kind === "Tuple"
			? { kind: "Tuple", attributes: e.value.a, elements: items.value }
			: { kind: "List", attributes: e.value.a, items: items.value });
	}
	const items = readValues(ctx, v);
	if (!items.ok) return items;
	return ok(kind === "Tuple"
		? { kind: "Tuple", attributes: EMPTY_VA, elements: items.value }
		: { kind: "List", attributes: EMPTY_VA, items: items.value });
}

function readRecordValue(ctx: Ctx, v: JsonValue): Result<Value<TA, VA>, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	// Record's compact payload is the field map itself, so "attributes" is the
	// only member name that switches on the expanded form; a record with a
	// field literally called "attributes" is therefore always written expanded,
	// even when its attributes are empty.
	if (o.value.members.has("attributes")) {
		const e = expanded(ctx, v, ["fields"], []);
		if (!e.ok) return e;
		const fields = readRecordFields(at(ctx, "fields"), e.value.m.get("fields") as JsonValue);
		return fields.ok ? ok({ kind: "Record", attributes: e.value.a, fields: fields.value }) : fields;
	}
	const fields = readRecordFieldMap(ctx, o.value);
	return fields.ok ? ok({ kind: "Record", attributes: EMPTY_VA, fields: fields.value }) : fields;
}

function readPatternCases(ctx: Ctx, v: JsonValue): Result<readonly PatternCase<TA, VA>[], Diagnostic> {
	const a = expectArray(ctx, v);
	if (!a.ok) return a;
	const out: PatternCase<TA, VA>[] = [];
	for (let i = 0; i < a.value.length; i += 1) {
		const one = at(ctx, i);
		const o = expectObject(one, a.value[i] as JsonValue);
		if (!o.ok) return o;
		const m = members(one, o.value, ["pattern", "body"], []);
		if (!m.ok) return m;
		const pattern = readPattern(at(one, "pattern"), m.value.get("pattern") as JsonValue);
		if (!pattern.ok) return pattern;
		const body = readValue(at(one, "body"), m.value.get("body") as JsonValue);
		if (!body.ok) return body;
		out.push({ pattern: pattern.value, body: body.value });
	}
	return ok(out);
}

// ------------------------------------------------------------ native info

const NATIVE_HINT_KEYS: readonly string[] = ["Arithmetic", "Comparison", "StringOp", "CollectionOp", "PlatformSpecific"];

export function readNativeHint(ctx: Ctx, v: JsonValue): Result<NativeHint, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const kv = singleKey(ctx, o.value);
	if (!kv.ok) return kv;
	const [key, payload] = kv.value;
	if (!NATIVE_HINT_KEYS.includes(key)) return fail(ctx, "unknown_node", `unknown native hint "${key}"`);
	const inner = at(ctx, key);
	const body = expectObject(inner, payload);
	if (!body.ok) return body;
	if (key === "PlatformSpecific") {
		const m = members(inner, body.value, ["platform"], []);
		if (!m.ok) return m;
		const platform = expectString(at(inner, "platform"), m.value.get("platform") as JsonValue);
		return platform.ok ? ok({ kind: "PlatformSpecific", platform: platform.value }) : platform;
	}
	const m = members(inner, body.value, [], []);
	if (!m.ok) return m;
	return ok({ kind: key as "Arithmetic" | "Comparison" | "StringOp" | "CollectionOp" });
}

export function readNativeInfo(ctx: Ctx, v: JsonValue): Result<NativeInfo, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const m = members(ctx, o.value, ["hint"], ["description"]);
	if (!m.ok) return m;
	const hint = readNativeHint(at(ctx, "hint"), m.value.get("hint") as JsonValue);
	if (!hint.ok) return hint;
	const description = optionalString(ctx, m.value, "description");
	return description.ok ? ok({ hint: hint.value, description: description.value }) : description;
}

// ---------------------------------------- definitions and specifications

export function readInputTypes(ctx: Ctx, v: JsonValue): Result<readonly InputType<TA>[], Diagnostic> {
	// Legacy: [[name, type], ...]; v4 writes the object map.
	if (Array.isArray(v)) {
		const out: InputType<TA>[] = [];
		for (let i = 0; i < v.length; i += 1) {
			const one = at(ctx, i);
			const pair = expectArray(one, v[i] as JsonValue);
			if (!pair.ok) return pair;
			if (pair.value.length !== 2) {
				return fail(one, "invalid_type", `expected a [name, type] pair, found ${pair.value.length} elements`);
			}
			const name = readName(at(one, 0), pair.value[0] as JsonValue);
			if (!name.ok) return name;
			const type = readType(at(one, 1), pair.value[1] as JsonValue);
			if (!type.ok) return type;
			out.push({ name: name.value, type: type.value });
		}
		return ok(out);
	}
	const pairs = readNamedMap<Type<TA>>(ctx, v, readType);
	return pairs.ok ? ok(pairs.value.map(([name, type]) => ({ name, type }))) : pairs;
}

const DEFINITION_KEYS: readonly string[] = ["ExpressionBody", "NativeBody", "ExternalBody", "IncompleteBody"];

export function readValueDefinition(ctx: Ctx, v: JsonValue): Result<ValueDefinition<TA, VA>, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const kv = singleKey(ctx, o.value);
	if (!kv.ok) return kv;
	const [key, payload] = kv.value;
	if (!DEFINITION_KEYS.includes(key)) return fail(ctx, "unknown_node", `unknown value definition "${key}"`);
	const inner = at(ctx, key);
	const body = expectObject(inner, payload);
	if (!body.ok) return body;
	const required = key === "ExpressionBody"
		? ["inputTypes", "outputType", "body"]
		: key === "NativeBody"
			? ["inputTypes", "outputType", "nativeInfo"]
			: key === "ExternalBody"
				? ["inputTypes", "outputType", "externalName", "targetPlatform"]
				: ["inputTypes", "incompleteness"];
	const optional = key === "IncompleteBody" ? ["outputType", "partialBody"] : [];
	const m = members(inner, body.value, required, optional);
	if (!m.ok) return m;
	const inputTypes = readInputTypes(at(inner, "inputTypes"), m.value.get("inputTypes") as JsonValue);
	if (!inputTypes.ok) return inputTypes;
	if (key === "IncompleteBody") {
		const incompleteness = readIncompleteness(at(inner, "incompleteness"), m.value.get("incompleteness") as JsonValue);
		if (!incompleteness.ok) return incompleteness;
		let outputType: Type<TA> | null = null;
		const rawOutput = m.value.get("outputType");
		if (rawOutput !== undefined) {
			const t = readType(at(inner, "outputType"), rawOutput);
			if (!t.ok) return t;
			outputType = t.value;
		}
		let partialBody: Value<TA, VA> | null = null;
		const rawPartial = m.value.get("partialBody");
		if (rawPartial !== undefined) {
			const b = readValue(at(inner, "partialBody"), rawPartial);
			if (!b.ok) return b;
			partialBody = b.value;
		}
		return ok({ kind: "IncompleteBody", inputTypes: inputTypes.value, outputType, incompleteness: incompleteness.value, partialBody });
	}
	const outputType = readType(at(inner, "outputType"), m.value.get("outputType") as JsonValue);
	if (!outputType.ok) return outputType;
	if (key === "ExpressionBody") {
		const value = readValue(at(inner, "body"), m.value.get("body") as JsonValue);
		return value.ok
			? ok({ kind: "ExpressionBody", inputTypes: inputTypes.value, outputType: outputType.value, body: value.value })
			: value;
	}
	if (key === "NativeBody") {
		const nativeInfo = readNativeInfo(at(inner, "nativeInfo"), m.value.get("nativeInfo") as JsonValue);
		return nativeInfo.ok
			? ok({ kind: "NativeBody", inputTypes: inputTypes.value, outputType: outputType.value, nativeInfo: nativeInfo.value })
			: nativeInfo;
	}
	const externalName = expectString(at(inner, "externalName"), m.value.get("externalName") as JsonValue);
	if (!externalName.ok) return externalName;
	const targetPlatform = expectString(at(inner, "targetPlatform"), m.value.get("targetPlatform") as JsonValue);
	if (!targetPlatform.ok) return targetPlatform;
	return ok({
		kind: "ExternalBody",
		inputTypes: inputTypes.value,
		outputType: outputType.value,
		externalName: externalName.value,
		targetPlatform: targetPlatform.value,
	});
}

// A specification's "doc" belongs to the Documented wrapper in modules, so the
// plain reader drops it; Task 8 wants it back and calls the WithDoc variant.
export function readValueSpecificationWithDoc(
	ctx: Ctx,
	v: JsonValue,
): Result<{ readonly spec: ValueSpecification<TA, VA>; readonly doc: string | null }, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const m = members(ctx, o.value, ["output"], ["annotations", "inputs", "doc"]);
	if (!m.ok) return m;
	const annotations = readAnnotations(at(ctx, "annotations"), m.value.get("annotations"));
	if (!annotations.ok) return annotations;
	let inputs: readonly InputType<TA>[] = [];
	const rawInputs = m.value.get("inputs");
	if (rawInputs !== undefined) {
		const i = readInputTypes(at(ctx, "inputs"), rawInputs);
		if (!i.ok) return i;
		inputs = i.value;
	}
	const output = readType(at(ctx, "output"), m.value.get("output") as JsonValue);
	if (!output.ok) return output;
	const doc = optionalString(ctx, m.value, "doc");
	if (!doc.ok) return doc;
	return ok({ spec: { annotations: annotations.value, inputs, output: output.value }, doc: doc.value });
}

export function readValueSpecification(ctx: Ctx, v: JsonValue): Result<ValueSpecification<TA, VA>, Diagnostic> {
	const r = readValueSpecificationWithDoc(ctx, v);
	return r.ok ? ok(r.value.spec) : r;
}
