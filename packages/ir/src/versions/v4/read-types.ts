// packages/ir/src/versions/v4/read-types.ts
//
// The v4 reader for type expressions, specifications and definitions.
//
// Two rulings shape this module. A bare array at type position is always a
// Tuple and never a parameterized Reference (kit types-0003, bead
// morphir-j442), so a Reference with arguments must carry its wrapper. And
// every wrapper payload has two spellings: the compact one the schema
// documents, and an expanded object whose optional first member is
// "attributes" (decision 0005).
//
// Decisions 0004 and 0007 settled the member names: a Record keeps its
// fields under "fields", and a Function declares a "parameterType". The
// spellings they replaced — a field map directly under "Record",
// "argumentType", "arg"/"result", and the Rust encoder's "attrs" — are
// still read here for the one-release window of decision 0006, each with a
// legacy_spelling warning, and none of them is ever written.
//
// Legacy tagged arrays for type *expressions* belong to the v3 reader and are
// not accepted here; legacy tagged arrays for specifications and definitions
// are, because the v4 schema still lists them.
import { type Ctx, at, expectArray, expectObject, expectString, fail, guardDepth, members, singleKey, warn, windowed } from "../../codec/json/cursor.ts";
import { type JsonObject, type JsonValue, isObject } from "../../codec/json/value.ts";
import type { Diagnostic } from "../../model/diagnostic.ts";
import type { FQName, Name } from "../../model/names.ts";
import { type Result, ok } from "../../model/result.ts";
import type {
	Access,
	Annotation,
	AnnotationArgument,
	Constructor,
	ConstructorParameter,
	Field,
	HoleReason,
	Incompleteness,
	Type,
	TypeDefinition,
	TypeSpecification,
} from "../../model/types.ts";
import { EMPTY_TYPE_ATTRIBUTES, type TA, type VA, readTypeAttributes } from "./attributes.ts";
import { readAccess, readAccessControlled } from "./read-definitions.ts";
import { isFQNameString, readFQName, readName } from "./read-names.ts";
import { readValue } from "./read-values.ts";

// ---------------------------------------------------------------- helpers

function readTypes(ctx: Ctx, items: readonly JsonValue[], offset = 0): Result<readonly Type<TA>[], Diagnostic> {
	const out: Type<TA>[] = [];
	for (let i = 0; i < items.length; i += 1) {
		const t = readType(at(ctx, i + offset), items[i] as JsonValue);
		if (!t.ok) return t;
		out.push(t.value);
	}
	return ok(out);
}

function readTypeList(ctx: Ctx, v: JsonValue): Result<readonly Type<TA>[], Diagnostic> {
	const a = expectArray(ctx, v);
	return a.ok ? readTypes(ctx, a.value) : a;
}

export function readNames(ctx: Ctx, v: JsonValue): Result<readonly Name[], Diagnostic> {
	const a = expectArray(ctx, v);
	if (!a.ok) return a;
	const out: Name[] = [];
	for (let i = 0; i < a.value.length; i += 1) {
		const n = readName(at(ctx, i), a.value[i] as JsonValue);
		if (!n.ok) return n;
		out.push(n.value);
	}
	return ok(out);
}

// A field map is a JSON object whose member names are field names; it is the
// payload of Record and the "fields" member of ExtensibleRecord.
function readFieldMap(ctx: Ctx, o: JsonObject): Result<readonly Field<TA>[], Diagnostic> {
	const out: Field<TA>[] = [];
	for (const [key, member] of o.members) {
		const name = readName(at(ctx, key), key);
		if (!name.ok) return name;
		const type = readType(at(ctx, key), member);
		if (!type.ok) return type;
		out.push({ name: name.value, type: type.value });
	}
	return ok(out);
}

function readFields(ctx: Ctx, v: JsonValue): Result<readonly Field<TA>[], Diagnostic> {
	const o = expectObject(ctx, v);
	return o.ok ? readFieldMap(ctx, o.value) : o;
}

// Every expanded payload starts the same way: check the member set, then read
// the optional attributes out of it. "attrs" is the Rust encoder's spelling
// of that member (decision 0005), accepted with a warning for the window of
// decision 0006; a payload carrying both spells one slot twice.
function expanded(
	ctx: Ctx,
	v: JsonValue,
	required: readonly string[],
	optional: readonly string[],
): Result<{ readonly m: ReadonlyMap<string, JsonValue>; readonly a: TA }, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const m = members(ctx, o.value, required, ["attributes", "attrs", ...optional]);
	if (!m.ok) return m;
	const raw = m.value.get("attributes");
	const legacy = m.value.get("attrs");
	if (raw !== undefined && legacy !== undefined) return fail(at(ctx, "attrs"), "unknown_member", '"attrs" duplicates "attributes"', o.value);
	if (legacy !== undefined) warn(at(ctx, "attrs"), '"attrs" is the legacy spelling of "attributes"', o.value);
	const a = readTypeAttributes(at(ctx, raw !== undefined ? "attributes" : "attrs"), raw ?? legacy);
	return a.ok ? ok({ m: m.value, a: a.value }) : a;
}

// ------------------------------------------------------------ expressions

export function readType(ctx: Ctx, v: JsonValue): Result<Type<TA>, Diagnostic> {
	const depth = guardDepth(ctx);
	if (!depth.ok) return depth;
	if (typeof v === "string") {
		if (isFQNameString(v)) {
			const fq = readFQName(ctx, v);
			return fq.ok ? ok({ kind: "Reference", attributes: EMPTY_TYPE_ATTRIBUTES, fqname: fq.value, args: [] }) : fq;
		}
		const n = readName(ctx, v);
		return n.ok ? ok({ kind: "Variable", attributes: EMPTY_TYPE_ATTRIBUTES, name: n.value }) : n;
	}
	if (Array.isArray(v)) {
		const elements = readTypes(ctx, v);
		return elements.ok ? ok({ kind: "Tuple", attributes: EMPTY_TYPE_ATTRIBUTES, elements: elements.value }) : elements;
	}
	if (!isObject(v)) return fail(ctx, "invalid_type", "expected a type expression", v);
	const kv = singleKey(ctx, v);
	if (!kv.ok) return kv;
	const [key, payload] = kv.value;
	const inner = at(ctx, key);
	switch (key) {
		case "Variable": return readVariableType(inner, payload);
		case "Reference": return readReferenceType(inner, payload);
		case "Tuple": return readTupleType(inner, payload);
		case "Record": return readRecordType(inner, payload);
		case "ExtensibleRecord": return readExtensibleRecordType(inner, payload);
		case "Function": return readFunctionType(inner, payload);
		case "Unit": return readUnitType(inner, payload);
		default: return fail(ctx, "unknown_node", `unknown type node "${key}"`, v);
	}
}

function readVariableType(ctx: Ctx, v: JsonValue): Result<Type<TA>, Diagnostic> {
	// A compact Variable payload is a name, which is never an object, so any
	// object here is the expanded form.
	if (isObject(v)) {
		const e = expanded(ctx, v, ["name"], []);
		if (!e.ok) return e;
		const n = readName(at(ctx, "name"), e.value.m.get("name") as JsonValue);
		return n.ok ? ok({ kind: "Variable", attributes: e.value.a, name: n.value }) : n;
	}
	const n = readName(ctx, v);
	return n.ok ? ok({ kind: "Variable", attributes: EMPTY_TYPE_ATTRIBUTES, name: n.value }) : n;
}

function readReferenceType(ctx: Ctx, v: JsonValue): Result<Type<TA>, Diagnostic> {
	if (Array.isArray(v)) {
		if (v.length === 0) return fail(ctx, "missing_member", "a Reference array needs an fqname as its first element", v);
		const fq = readFQName(at(ctx, 0), v[0] as JsonValue);
		if (!fq.ok) return fq;
		const args = readTypes(ctx, v.slice(1), 1);
		return args.ok ? ok({ kind: "Reference", attributes: EMPTY_TYPE_ATTRIBUTES, fqname: fq.value, args: args.value }) : args;
	}
	if (isObject(v)) {
		const e = expanded(ctx, v, ["fqname"], ["args"]);
		if (!e.ok) return e;
		const fq = readFQName(at(ctx, "fqname"), e.value.m.get("fqname") as JsonValue);
		if (!fq.ok) return fq;
		const raw = e.value.m.get("args");
		if (raw === undefined) return ok({ kind: "Reference", attributes: e.value.a, fqname: fq.value, args: [] });
		const args = readTypeList(at(ctx, "args"), raw);
		return args.ok ? ok({ kind: "Reference", attributes: e.value.a, fqname: fq.value, args: args.value }) : args;
	}
	const fq = readFQName(ctx, v);
	return fq.ok ? ok({ kind: "Reference", attributes: EMPTY_TYPE_ATTRIBUTES, fqname: fq.value, args: [] }) : fq;
}

function readTupleType(ctx: Ctx, v: JsonValue): Result<Type<TA>, Diagnostic> {
	if (isObject(v)) {
		const e = expanded(ctx, v, ["elements"], []);
		if (!e.ok) return e;
		const elements = readTypeList(at(ctx, "elements"), e.value.m.get("elements") as JsonValue);
		return elements.ok ? ok({ kind: "Tuple", attributes: e.value.a, elements: elements.value }) : elements;
	}
	const elements = readTypeList(ctx, v);
	return elements.ok ? ok({ kind: "Tuple", attributes: EMPTY_TYPE_ATTRIBUTES, elements: elements.value }) : elements;
}

// Decision 0004: a Record payload keeps its fields under "fields", with the
// optional attributes member in front of them, and that is the only spelling
// written. The field map directly under "Record" is what the schema
// documented until 2026-09-04; it is read for the window of decision 0006 and
// warned about.
//
// The whole member set still decides which of the two a payload is, because a
// field can be called "fields": exactly {fields}, or {fields} beside
// "attributes" or its legacy "attrs", is the canonical payload and anything
// else is a field map. So { "Record": { "fields": <type> } } is the canonical
// payload and fails with invalid_type at /Record/fields, never a one-field
// record whose field is called "fields"; that record is spelled
// { "Record": { "fields": { "fields": <type> } } }, which is what it writes
// back to.
function isRecordPayload(o: JsonObject): boolean {
	if (!o.members.has("fields")) return false;
	return o.members.size === 1 || (o.members.size === 2 && (o.members.has("attributes") || o.members.has("attrs")));
}

function readRecordType(ctx: Ctx, v: JsonValue): Result<Type<TA>, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	if (isRecordPayload(o.value)) {
		const e = expanded(ctx, v, ["fields"], []);
		if (!e.ok) return e;
		const fields = readFields(at(ctx, "fields"), e.value.m.get("fields") as JsonValue);
		return fields.ok ? ok({ kind: "Record", attributes: e.value.a, fields: fields.value }) : fields;
	}
	warn(ctx, 'a field map directly under "Record" is the legacy spelling; write { "Record": { "fields": { .. } } }', v);
	const fields = readFieldMap(ctx, o.value);
	return fields.ok ? ok({ kind: "Record", attributes: EMPTY_TYPE_ATTRIBUTES, fields: fields.value }) : fields;
}

function readExtensibleRecordType(ctx: Ctx, v: JsonValue): Result<Type<TA>, Diagnostic> {
	const e = expanded(ctx, v, ["variable", "fields"], []);
	if (!e.ok) return e;
	const variable = readName(at(ctx, "variable"), e.value.m.get("variable") as JsonValue);
	if (!variable.ok) return variable;
	const fields = readFields(at(ctx, "fields"), e.value.m.get("fields") as JsonValue);
	if (!fields.ok) return fields;
	return ok({ kind: "ExtensibleRecord", attributes: e.value.a, variable: variable.value, fields: fields.value });
}

// Decision 0007: parameterType. argumentType (the pre-decision schema) and
// arg/result (the Rust encoder) are window spellings; each warns, and a
// payload that spells the same slot twice is unknown_member at the extra key.
function readFunctionType(ctx: Ctx, v: JsonValue): Result<Type<TA>, Diagnostic> {
	const e = expanded(ctx, v, [], ["parameterType", "argumentType", "arg", "returnType", "result"]);
	if (!e.ok) return e;
	const m = e.value.m;
	let parameterKey: string;
	let parameter: JsonValue;
	if (m.has("arg")) {
		// windowed() pairs one legacy key with one canonical key, and the
		// parameter slot has three spellings, so "arg" is checked here — in the
		// same wording, and naming whichever other spelling is actually there.
		const other = m.has("parameterType") ? "parameterType" : m.has("argumentType") ? "argumentType" : null;
		if (other !== null) return fail(at(ctx, "arg"), "unknown_member", `"arg" is the legacy spelling of "${other}"; write only one`, v);
		warn(at(ctx, "arg"), '"arg" is the legacy spelling of "parameterType"', v);
		parameterKey = "arg";
		parameter = m.get("arg") as JsonValue;
	} else {
		const p = windowed(ctx, m, "parameterType", "argumentType", v);
		if (!p.ok) return p;
		parameterKey = m.has("parameterType") ? "parameterType" : "argumentType";
		parameter = p.value;
	}
	const r = windowed(ctx, m, "returnType", "result", v);
	if (!r.ok) return r;
	// windowed() answered with the payload; only the cursor needs the key.
	const returnKey = m.has("returnType") ? "returnType" : "result";
	const parameterType = readType(at(ctx, parameterKey), parameter);
	if (!parameterType.ok) return parameterType;
	const returnType = readType(at(ctx, returnKey), r.value);
	if (!returnType.ok) return returnType;
	return ok({ kind: "Function", attributes: e.value.a, parameterType: parameterType.value, returnType: returnType.value });
}

function readUnitType(ctx: Ctx, v: JsonValue): Result<Type<TA>, Diagnostic> {
	const e = expanded(ctx, v, [], []);
	return e.ok ? ok({ kind: "Unit", attributes: e.value.a }) : e;
}

// ----------------------------------------------------------- constructors

// Decision 0007: a constructor carries parameters, spelled on the wire as
// [name, type] pairs.
function readConstructorParameters(ctx: Ctx, v: JsonValue): Result<readonly ConstructorParameter<TA>[], Diagnostic> {
	const a = expectArray(ctx, v);
	if (!a.ok) return a;
	const out: ConstructorParameter<TA>[] = [];
	for (let i = 0; i < a.value.length; i += 1) {
		const pair = expectArray(at(ctx, i), a.value[i] as JsonValue);
		if (!pair.ok) return pair;
		if (pair.value.length !== 2) {
			return fail(at(ctx, i), "invalid_type", `expected a [name, type] pair, found ${pair.value.length} elements`);
		}
		const name = readName(at(at(ctx, i), 0), pair.value[0] as JsonValue);
		if (!name.ok) return name;
		const type = readType(at(at(ctx, i), 1), pair.value[1] as JsonValue);
		if (!type.ok) return type;
		out.push({ name: name.value, type: type.value });
	}
	return ok(out);
}

export function readConstructors(ctx: Ctx, v: JsonValue): Result<readonly Constructor<TA>[], Diagnostic> {
	// Legacy: [[ctor, [[name, type], ...]], ...]
	if (Array.isArray(v)) {
		const out: Constructor<TA>[] = [];
		for (let i = 0; i < v.length; i += 1) {
			const pair = expectArray(at(ctx, i), v[i] as JsonValue);
			if (!pair.ok) return pair;
			if (pair.value.length !== 2) {
				return fail(at(ctx, i), "invalid_type", `expected a [constructor, parameters] pair, found ${pair.value.length} elements`);
			}
			const name = readName(at(at(ctx, i), 0), pair.value[0] as JsonValue);
			if (!name.ok) return name;
			const parameters = readConstructorParameters(at(at(ctx, i), 1), pair.value[1] as JsonValue);
			if (!parameters.ok) return parameters;
			out.push({ name: name.value, parameters: parameters.value });
		}
		return ok(out);
	}
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const out: Constructor<TA>[] = [];
	for (const [key, member] of o.value.members) {
		const name = readName(at(ctx, key), key);
		if (!name.ok) return name;
		const parameters = readConstructorParameters(at(ctx, key), member);
		if (!parameters.ok) return parameters;
		out.push({ name: name.value, parameters: parameters.value });
	}
	return ok(out);
}

// ------------------------------------------------------------ annotations

function readAnnotationArgument(ctx: Ctx, v: JsonValue): Result<AnnotationArgument<TA, VA>, Diagnostic> {
	// A named argument is exactly {name, value}; no Value wrapper has that
	// member set, so the shape alone decides.
	if (isObject(v) && v.members.size === 2 && v.members.has("name") && v.members.has("value")) {
		const name = readName(at(ctx, "name"), v.members.get("name") as JsonValue);
		if (!name.ok) return name;
		const value = readValue(at(ctx, "value"), v.members.get("value") as JsonValue);
		return value.ok ? ok({ kind: "Named", name: name.value, value: value.value }) : value;
	}
	const value = readValue(ctx, v);
	return value.ok ? ok({ kind: "Positional", value: value.value }) : value;
}

function readAnnotation(ctx: Ctx, v: JsonValue): Result<Annotation<TA, VA>, Diagnostic> {
	if (typeof v === "string") {
		// "pkg:mod#local" or "pkg:mod#local:free text"; the separator is the
		// first colon after the local-name hash.
		const hash = v.indexOf("#");
		const colon = hash < 0 ? -1 : v.indexOf(":", hash + 1);
		const fq = readFQName(ctx, colon < 0 ? v : v.slice(0, colon));
		if (!fq.ok) return fq;
		return ok({ kind: "Compact", name: fq.value, text: colon < 0 ? null : v.slice(colon + 1) });
	}
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const m = members(ctx, o.value, ["name"], ["arguments"]);
	if (!m.ok) return m;
	const name = readFQName(at(ctx, "name"), m.value.get("name") as JsonValue);
	if (!name.ok) return name;
	const raw = m.value.get("arguments");
	if (raw === undefined) return ok({ kind: "Structured", name: name.value, args: [] });
	const argsCtx = at(ctx, "arguments");
	const a = expectArray(argsCtx, raw);
	if (!a.ok) return a;
	const args: AnnotationArgument<TA, VA>[] = [];
	for (let i = 0; i < a.value.length; i += 1) {
		const arg = readAnnotationArgument(at(argsCtx, i), a.value[i] as JsonValue);
		if (!arg.ok) return arg;
		args.push(arg.value);
	}
	return ok({ kind: "Structured", name: name.value, args });
}

export function readAnnotations(ctx: Ctx, v: JsonValue | undefined): Result<readonly Annotation<TA, VA>[], Diagnostic> {
	if (v === undefined) return ok([]);
	const a = expectArray(ctx, v);
	if (!a.ok) return a;
	const out: Annotation<TA, VA>[] = [];
	for (let i = 0; i < a.value.length; i += 1) {
		const one = readAnnotation(at(ctx, i), a.value[i] as JsonValue);
		if (!one.ok) return one;
		out.push(one.value);
	}
	return ok(out);
}

// --------------------------------------------------------- specifications

// The wrapper key is what names the node, so an unrecognized key is
// unknown_node and must be reported before the payload's shape is judged;
// otherwise a misspelled wrapper around a non-object would surface as
// invalid_type.
const SPECIFICATION_KEYS: readonly string[] = [
	"OpaqueTypeSpecification", "TypeAliasSpecification", "CustomTypeSpecification", "DerivedTypeSpecification",
];
const DEFINITION_KEYS: readonly string[] = ["TypeAliasDefinition", "CustomTypeDefinition", "IncompleteTypeDefinition"];
const HOLE_REASON_KEYS: readonly string[] = ["UnresolvedReference", "DeletedDuringRefactor", "TypeMismatch"];
const INCOMPLETENESS_KEYS: readonly string[] = ["Hole", "Draft"];

// Returns a failure when the tagged array is the wrong length, null when it is
// the right one, so callers can guard with a single `if`.
function legacyArity(ctx: Ctx, items: readonly JsonValue[], tag: string, arity: number): Result<never, Diagnostic> | null {
	return items.length === arity
		? null
		: fail(ctx, "invalid_type", `expected a ${arity}-element ["${tag}", ...] array, found ${items.length} elements`);
}

function readLegacySpecification(ctx: Ctx, items: readonly JsonValue[]): Result<TypeSpecification<TA, VA>, Diagnostic> {
	if (items.length === 0) return fail(ctx, "unknown_node", "expected a tagged specification array", items);
	const tag = expectString(at(ctx, 0), items[0] as JsonValue);
	if (!tag.ok) return tag;
	const arity = (n: number): Result<never, Diagnostic> | null => legacyArity(ctx, items, tag.value, n);
	switch (tag.value) {
		case "OpaqueTypeSpecification": {
			const bad = arity(2);
			if (bad !== null) return bad;
			const typeParams = readNames(at(ctx, 1), items[1] as JsonValue);
			return typeParams.ok ? ok({ kind: "OpaqueTypeSpecification", annotations: [], typeParams: typeParams.value }) : typeParams;
		}
		case "TypeAliasSpecification": {
			const bad = arity(3);
			if (bad !== null) return bad;
			const typeParams = readNames(at(ctx, 1), items[1] as JsonValue);
			if (!typeParams.ok) return typeParams;
			const typeExp = readType(at(ctx, 2), items[2] as JsonValue);
			if (!typeExp.ok) return typeExp;
			return ok({ kind: "TypeAliasSpecification", annotations: [], typeParams: typeParams.value, typeExp: typeExp.value });
		}
		case "CustomTypeSpecification": {
			const bad = arity(3);
			if (bad !== null) return bad;
			const typeParams = readNames(at(ctx, 1), items[1] as JsonValue);
			if (!typeParams.ok) return typeParams;
			const constructors = readConstructors(at(ctx, 2), items[2] as JsonValue);
			if (!constructors.ok) return constructors;
			return ok({ kind: "CustomTypeSpecification", annotations: [], typeParams: typeParams.value, constructors: constructors.value });
		}
		case "DerivedTypeSpecification": {
			const bad = arity(3);
			if (bad !== null) return bad;
			const typeParams = readNames(at(ctx, 1), items[1] as JsonValue);
			if (!typeParams.ok) return typeParams;
			const body = readDerivedBody(at(ctx, 2), items[2] as JsonValue);
			if (!body.ok) return body;
			return ok({ kind: "DerivedTypeSpecification", annotations: [], typeParams: typeParams.value, ...body.value });
		}
		default:
			return fail(at(ctx, 0), "unknown_node", `unknown type specification "${tag.value}"`, items);
	}
}

interface DerivedBody {
	readonly baseType: Type<TA>;
	readonly fromBaseType: FQName;
	readonly toBaseType: FQName;
}

function readDerivedBody(ctx: Ctx, v: JsonValue): Result<DerivedBody, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const m = members(ctx, o.value, ["baseType", "fromBaseType", "toBaseType"], []);
	if (!m.ok) return m;
	return readDerivedMembers(ctx, m.value);
}

function readDerivedMembers(ctx: Ctx, m: ReadonlyMap<string, JsonValue>): Result<DerivedBody, Diagnostic> {
	const baseType = readType(at(ctx, "baseType"), m.get("baseType") as JsonValue);
	if (!baseType.ok) return baseType;
	const fromBaseType = readFQName(at(ctx, "fromBaseType"), m.get("fromBaseType") as JsonValue);
	if (!fromBaseType.ok) return fromBaseType;
	const toBaseType = readFQName(at(ctx, "toBaseType"), m.get("toBaseType") as JsonValue);
	if (!toBaseType.ok) return toBaseType;
	return ok({ baseType: baseType.value, fromBaseType: fromBaseType.value, toBaseType: toBaseType.value });
}

export function readTypeSpecification(ctx: Ctx, v: JsonValue): Result<TypeSpecification<TA, VA>, Diagnostic> {
	if (Array.isArray(v)) return readLegacySpecification(ctx, v);
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const kv = singleKey(ctx, o.value);
	if (!kv.ok) return kv;
	const [key, payload] = kv.value;
	if (!SPECIFICATION_KEYS.includes(key)) return fail(ctx, "unknown_node", `unknown type specification "${key}"`, v);
	const inner = at(ctx, key);
	const body = expectObject(inner, payload);
	if (!body.ok) return body;
	switch (key) {
		case "OpaqueTypeSpecification": {
			const m = members(inner, body.value, [], ["annotations", "typeParams"]);
			if (!m.ok) return m;
			const annotations = readAnnotations(at(inner, "annotations"), m.value.get("annotations"));
			if (!annotations.ok) return annotations;
			const raw = m.value.get("typeParams");
			if (raw === undefined) return ok({ kind: "OpaqueTypeSpecification", annotations: annotations.value, typeParams: [] });
			const typeParams = readNames(at(inner, "typeParams"), raw);
			return typeParams.ok
				? ok({ kind: "OpaqueTypeSpecification", annotations: annotations.value, typeParams: typeParams.value })
				: typeParams;
		}
		case "TypeAliasSpecification": {
			const m = members(inner, body.value, ["typeParams", "typeExp"], ["annotations"]);
			if (!m.ok) return m;
			const annotations = readAnnotations(at(inner, "annotations"), m.value.get("annotations"));
			if (!annotations.ok) return annotations;
			const typeParams = readNames(at(inner, "typeParams"), m.value.get("typeParams") as JsonValue);
			if (!typeParams.ok) return typeParams;
			const typeExp = readType(at(inner, "typeExp"), m.value.get("typeExp") as JsonValue);
			if (!typeExp.ok) return typeExp;
			return ok({
				kind: "TypeAliasSpecification",
				annotations: annotations.value,
				typeParams: typeParams.value,
				typeExp: typeExp.value,
			});
		}
		case "CustomTypeSpecification": {
			const m = members(inner, body.value, ["typeParams", "constructors"], ["annotations"]);
			if (!m.ok) return m;
			const annotations = readAnnotations(at(inner, "annotations"), m.value.get("annotations"));
			if (!annotations.ok) return annotations;
			const typeParams = readNames(at(inner, "typeParams"), m.value.get("typeParams") as JsonValue);
			if (!typeParams.ok) return typeParams;
			const constructors = readConstructors(at(inner, "constructors"), m.value.get("constructors") as JsonValue);
			if (!constructors.ok) return constructors;
			return ok({
				kind: "CustomTypeSpecification",
				annotations: annotations.value,
				typeParams: typeParams.value,
				constructors: constructors.value,
			});
		}
		case "DerivedTypeSpecification": {
			const m = members(inner, body.value, ["typeParams", "baseType", "fromBaseType", "toBaseType"], ["annotations"]);
			if (!m.ok) return m;
			const annotations = readAnnotations(at(inner, "annotations"), m.value.get("annotations"));
			if (!annotations.ok) return annotations;
			const typeParams = readNames(at(inner, "typeParams"), m.value.get("typeParams") as JsonValue);
			if (!typeParams.ok) return typeParams;
			const derived = readDerivedMembers(inner, m.value);
			if (!derived.ok) return derived;
			return ok({
				kind: "DerivedTypeSpecification",
				annotations: annotations.value,
				typeParams: typeParams.value,
				...derived.value,
			});
		}
		default:
			return fail(ctx, "unknown_node", `unknown type specification "${key}"`, v);
	}
}

// ------------------------------------------------------------ definitions

export function readHoleReason(ctx: Ctx, v: JsonValue): Result<HoleReason, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const kv = singleKey(ctx, o.value);
	if (!kv.ok) return kv;
	const [key, payload] = kv.value;
	if (!HOLE_REASON_KEYS.includes(key)) return fail(ctx, "unknown_node", `unknown hole reason "${key}"`, v);
	const inner = at(ctx, key);
	const body = expectObject(inner, payload);
	if (!body.ok) return body;
	switch (key) {
		case "UnresolvedReference": {
			const m = members(inner, body.value, ["target"], []);
			if (!m.ok) return m;
			const target = readFQName(at(inner, "target"), m.value.get("target") as JsonValue);
			return target.ok ? ok({ kind: "UnresolvedReference", target: target.value }) : target;
		}
		case "DeletedDuringRefactor": {
			// The wire key is "tx-id"; the model spells it txId.
			const m = members(inner, body.value, ["tx-id"], []);
			if (!m.ok) return m;
			const txId = expectString(at(inner, "tx-id"), m.value.get("tx-id") as JsonValue);
			return txId.ok ? ok({ kind: "DeletedDuringRefactor", txId: txId.value }) : txId;
		}
		case "TypeMismatch": {
			const m = members(inner, body.value, ["expected", "found"], []);
			if (!m.ok) return m;
			const expected = expectString(at(inner, "expected"), m.value.get("expected") as JsonValue);
			if (!expected.ok) return expected;
			const found = expectString(at(inner, "found"), m.value.get("found") as JsonValue);
			if (!found.ok) return found;
			return ok({ kind: "TypeMismatch", expected: expected.value, found: found.value });
		}
		default:
			return fail(ctx, "unknown_node", `unknown hole reason "${key}"`, v);
	}
}

export function readIncompleteness(ctx: Ctx, v: JsonValue): Result<Incompleteness<TA>, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const kv = singleKey(ctx, o.value);
	if (!kv.ok) return kv;
	const [key, payload] = kv.value;
	if (!INCOMPLETENESS_KEYS.includes(key)) return fail(ctx, "unknown_node", `unknown incompleteness "${key}"`, v);
	const inner = at(ctx, key);
	const body = expectObject(inner, payload);
	if (!body.ok) return body;
	switch (key) {
		case "Hole": {
			const m = members(inner, body.value, ["reason"], ["partialBody"]);
			if (!m.ok) return m;
			const reason = readHoleReason(at(inner, "reason"), m.value.get("reason") as JsonValue);
			if (!reason.ok) return reason;
			const raw = m.value.get("partialBody");
			if (raw === undefined) return ok({ kind: "Hole", reason: reason.value, partialBody: null });
			const partialBody = readType(at(inner, "partialBody"), raw);
			return partialBody.ok ? ok({ kind: "Hole", reason: reason.value, partialBody: partialBody.value }) : partialBody;
		}
		case "Draft": {
			const m = members(inner, body.value, [], []);
			return m.ok ? ok({ kind: "Draft" }) : m;
		}
		default:
			return fail(ctx, "unknown_node", `unknown incompleteness "${key}"`, v);
	}
}

function readLegacyDefinition(ctx: Ctx, items: readonly JsonValue[]): Result<TypeDefinition<TA>, Diagnostic> {
	if (items.length === 0) return fail(ctx, "unknown_node", "expected a tagged definition array", items);
	const tag = expectString(at(ctx, 0), items[0] as JsonValue);
	if (!tag.ok) return tag;
	switch (tag.value) {
		case "TypeAliasDefinition": {
			const bad = legacyArity(ctx, items, tag.value, 3);
			if (bad !== null) return bad;
			const typeParams = readNames(at(ctx, 1), items[1] as JsonValue);
			if (!typeParams.ok) return typeParams;
			const typeExp = readType(at(ctx, 2), items[2] as JsonValue);
			if (!typeExp.ok) return typeExp;
			return ok({ kind: "TypeAliasDefinition", typeParams: typeParams.value, typeExp: typeExp.value });
		}
		case "CustomTypeDefinition": {
			const bad = legacyArity(ctx, items, tag.value, 3);
			if (bad !== null) return bad;
			const typeParams = readNames(at(ctx, 1), items[1] as JsonValue);
			if (!typeParams.ok) return typeParams;
			// The legacy array carries its constructors inside an
			// access-controlled wrapper, in any of the three spellings
			// read-definitions.ts accepts (kit definitions-0001).
			const acc = readAccessControlled(at(ctx, 2), items[2] as JsonValue, readConstructors);
			if (!acc.ok) return acc;
			return ok({
				kind: "CustomTypeDefinition",
				typeParams: typeParams.value,
				constructorsAccess: acc.value.access,
				constructors: acc.value.value,
			});
		}
		default:
			return fail(at(ctx, 0), "unknown_node", `unknown type definition "${tag.value}"`, items);
	}
}

export function readTypeDefinition(ctx: Ctx, v: JsonValue): Result<TypeDefinition<TA>, Diagnostic> {
	if (Array.isArray(v)) return readLegacyDefinition(ctx, v);
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const kv = singleKey(ctx, o.value);
	if (!kv.ok) return kv;
	const [key, payload] = kv.value;
	if (!DEFINITION_KEYS.includes(key)) return fail(ctx, "unknown_node", `unknown type definition "${key}"`, v);
	const inner = at(ctx, key);
	const body = expectObject(inner, payload);
	if (!body.ok) return body;
	switch (key) {
		case "TypeAliasDefinition": {
			const m = members(inner, body.value, ["typeParams", "typeExp"], []);
			if (!m.ok) return m;
			const typeParams = readNames(at(inner, "typeParams"), m.value.get("typeParams") as JsonValue);
			if (!typeParams.ok) return typeParams;
			const typeExp = readType(at(inner, "typeExp"), m.value.get("typeExp") as JsonValue);
			if (!typeExp.ok) return typeExp;
			return ok({ kind: "TypeAliasDefinition", typeParams: typeParams.value, typeExp: typeExp.value });
		}
		case "CustomTypeDefinition": {
			const m = members(inner, body.value, ["typeParams", "constructors"], ["access"]);
			if (!m.ok) return m;
			const typeParams = readNames(at(inner, "typeParams"), m.value.get("typeParams") as JsonValue);
			if (!typeParams.ok) return typeParams;
			// The schema leaves access optional; public is the wider reading, and
			// the writer always makes it explicit again.
			let constructorsAccess: Access = "Public";
			const rawAccess = m.value.get("access");
			if (rawAccess !== undefined) {
				const a = readAccess(at(inner, "access"), rawAccess);
				if (!a.ok) return a;
				constructorsAccess = a.value;
			}
			const constructors = readConstructors(at(inner, "constructors"), m.value.get("constructors") as JsonValue);
			if (!constructors.ok) return constructors;
			return ok({ kind: "CustomTypeDefinition", typeParams: typeParams.value, constructorsAccess, constructors: constructors.value });
		}
		case "IncompleteTypeDefinition": {
			const m = members(inner, body.value, ["typeParams", "incompleteness"], ["partialTypeExp"]);
			if (!m.ok) return m;
			const typeParams = readNames(at(inner, "typeParams"), m.value.get("typeParams") as JsonValue);
			if (!typeParams.ok) return typeParams;
			const incompleteness = readIncompleteness(at(inner, "incompleteness"), m.value.get("incompleteness") as JsonValue);
			if (!incompleteness.ok) return incompleteness;
			const raw = m.value.get("partialTypeExp");
			if (raw === undefined) {
				return ok({
					kind: "IncompleteTypeDefinition",
					typeParams: typeParams.value,
					incompleteness: incompleteness.value,
					partialTypeExp: null,
				});
			}
			const partialTypeExp = readType(at(inner, "partialTypeExp"), raw);
			if (!partialTypeExp.ok) return partialTypeExp;
			return ok({
				kind: "IncompleteTypeDefinition",
				typeParams: typeParams.value,
				incompleteness: incompleteness.value,
				partialTypeExp: partialTypeExp.value,
			});
		}
		default:
			return fail(ctx, "unknown_node", `unknown type definition "${key}"`, v);
	}
}
