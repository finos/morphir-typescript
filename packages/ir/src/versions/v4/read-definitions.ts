// packages/ir/src/versions/v4/read-definitions.ts
//
// The v4 reader for access control, documentation, and module definitions and
// specifications.
//
// One ruling shapes this module. An access-controlled entry has three
// spellings: the tag form { "Public": payload }, the legacy { "access",
// "value" } pair, and the flattened form that leaves the payload's own members
// beside "access" (kit definitions-0001, bead morphir-j442). The tag form is
// canonical. A payload carries its "doc" flattened beside the variant wrapper;
// the nested { "doc", "value" } wrapper is accepted for the window of decision
// 0006 and warns legacy_spelling (kit definitions-0006, decision 0010).
//
// This is also the one place access is read: read-types.ts calls in for the
// legacy CustomTypeDefinition array rather than keeping a second copy.
import { type Ctx, at, expectObject, expectString, fail, members, optionalString, singleKey, warn } from "../../codec/json/cursor.ts";
import { type JsonValue, isObject, jsonObject } from "../../codec/json/value.ts";
import type { Diagnostic } from "../../model/diagnostic.ts";
import type { AccessControlled, Documented, ModuleDefinition, ModuleSpecification, Named } from "../../model/modules.ts";
import { type Result, ok } from "../../model/result.ts";
import type { Access, TypeDefinition, TypeSpecification } from "../../model/types.ts";
import type { ValueDefinition, ValueSpecification } from "../../model/values.ts";
import type { TA, VA } from "./attributes.ts";
import { readName } from "./read-names.ts";
import { readAnnotations, readTypeDefinition, readTypeSpecification } from "./read-types.ts";
import { readValueDefinition, readValueSpecification, readValueSpecificationWithDoc } from "./read-values.ts";

type Read<T> = (ctx: Ctx, v: JsonValue) => Result<T, Diagnostic>;
type Entry = readonly [string, JsonValue];

// -------------------------------------------------------- access and doc

export function readAccess(ctx: Ctx, v: JsonValue): Result<Access, Diagnostic> {
	const s = expectString(ctx, v);
	if (!s.ok) return s;
	switch (s.value) {
		case "Public": case "public": case "pub": return ok("Public");
		case "Private": case "private": return ok("Private");
		default: return fail(ctx, "invalid_access", `unknown access "${s.value}"`);
	}
}

// What is left of a wrapper once its own member has been taken off: a lone
// "value" member is the legacy nesting, anything else is the payload's own
// members and is handed on as an object in its own right.
function payloadOf(ctx: Ctx, rest: readonly Entry[]): readonly [Ctx, JsonValue] {
	const only = rest[0];
	return rest.length === 1 && only !== undefined && only[0] === "value"
		? [at(ctx, "value"), only[1]]
		: [ctx, jsonObject(rest)];
}

export function readAccessControlled<T>(ctx: Ctx, v: JsonValue, read: Read<T>): Result<AccessControlled<T>, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	if (o.value.members.has("access")) {
		let access: Access = "Public";
		const rest: Entry[] = [];
		for (const [key, member] of o.value.members) {
			if (key === "access") {
				const a = readAccess(at(ctx, "access"), member);
				if (!a.ok) return a;
				access = a.value;
			} else {
				rest.push([key, member] as const);
			}
		}
		if (rest.length === 0) return fail(ctx, "missing_member", "an access-controlled entry needs a payload", o.value);
		const [inner, payload] = payloadOf(ctx, rest);
		const value = read(inner, payload);
		return value.ok ? ok({ access, value: value.value }) : value;
	}
	const kv = singleKey(ctx, o.value);
	if (!kv.ok) return kv;
	const [key, payload] = kv.value;
	const access = readAccess(ctx, key);
	if (!access.ok) return access;
	const value = read(at(ctx, key), payload);
	return value.ok ? ok({ access: access.value, value: value.value }) : value;
}

// "doc" beside the variant wrapper and the nested { "doc", "value" } wrapper
// mean the same Documented. Neither "doc" nor "value" is a variant key, so
// either member settles which spelling is in front of us. The flattened form
// is canonical (decision 0010); the nested wrapper is accepted for the window
// of decision 0006 and warns legacy_spelling.
export function readDocumented<T>(ctx: Ctx, v: JsonValue, read: Read<T>): Result<Documented<T>, Diagnostic> {
	if (isObject(v) && (v.members.has("doc") || v.members.has("value"))) {
		let doc: string | null = null;
		const rest: Entry[] = [];
		for (const [key, member] of v.members) {
			if (key === "doc") {
				const s = expectString(at(ctx, "doc"), member);
				if (!s.ok) return s;
				doc = s.value;
			} else {
				rest.push([key, member] as const);
			}
		}
		if (rest.length === 0) return fail(ctx, "missing_member", "a documented entry needs a value", v);
		const only = rest[0];
		if (rest.length === 1 && only !== undefined && only[0] === "value") {
			warn(ctx, 'the nested { "doc", "value" } wrapper is the legacy spelling; put "doc" beside the variant', v);
		}
		const [inner, payload] = payloadOf(ctx, rest);
		const value = read(inner, payload);
		return value.ok ? ok({ doc, value: value.value }) : value;
	}
	const value = read(ctx, v);
	return value.ok ? ok({ doc: null, value: value.value }) : value;
}

export function readAccessControlledTypeDefinition(
	ctx: Ctx,
	v: JsonValue,
): Result<AccessControlled<Documented<TypeDefinition<TA>>>, Diagnostic> {
	return readAccessControlled(ctx, v, (c, x) => readDocumented(c, x, readTypeDefinition));
}

export function readAccessControlledValueDefinition(
	ctx: Ctx,
	v: JsonValue,
): Result<AccessControlled<Documented<ValueDefinition<TA, VA>>>, Diagnostic> {
	return readAccessControlled(ctx, v, (c, x) => readDocumented(c, x, readValueDefinition));
}

// ---------------------------------------------------------------- modules

// The types and values of a module are JSON objects keyed by canonical name
// strings; a key that is not one is invalid_name at that key's cursor.
export function readNamedMap<T>(ctx: Ctx, v: JsonValue, read: Read<T>): Result<readonly Named<T>[], Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const out: Named<T>[] = [];
	for (const [key, member] of o.value.members) {
		const name = readName(at(ctx, key), key);
		if (!name.ok) return name;
		const value = read(at(ctx, key), member);
		if (!value.ok) return value;
		out.push({ name: name.value, value: value.value });
	}
	return ok(out);
}

function optionalNamedMap<T>(
	ctx: Ctx,
	m: ReadonlyMap<string, JsonValue>,
	key: string,
	read: Read<T>,
): Result<readonly Named<T>[], Diagnostic> {
	const raw = m.get(key);
	return raw === undefined ? ok([]) : readNamedMap(at(ctx, key), raw, read);
}

export function readModuleDefinition(ctx: Ctx, v: JsonValue): Result<ModuleDefinition<TA, VA>, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const m = members(ctx, o.value, [], ["types", "values", "doc"]);
	if (!m.ok) return m;
	const types = optionalNamedMap(ctx, m.value, "types", readAccessControlledTypeDefinition);
	if (!types.ok) return types;
	const values = optionalNamedMap(ctx, m.value, "values", readAccessControlledValueDefinition);
	if (!values.ok) return values;
	const doc = optionalString(ctx, m.value, "doc");
	if (!doc.ok) return doc;
	return ok({ doc: doc.value, types: types.value, values: values.value });
}

function readDocumentedTypeSpecification(ctx: Ctx, v: JsonValue): Result<Documented<TypeSpecification<TA, VA>>, Diagnostic> {
	return readDocumented(ctx, v, readTypeSpecification);
}

// Decision 0010: a value specification's doc is flattened first beside its own
// members ("inputs", "output"), not wrapped. "value" is not a specification
// member, so a member set of exactly {value} or {doc, value} is the legacy
// nested wrapper from the window of decision 0006 (kit definitions-0010) and
// warns; anything else is the flat, canonical spelling. Both read to the same
// Documented, and the writer emits the flat one with doc first.
function readDocumentedValueSpecification(ctx: Ctx, v: JsonValue): Result<Documented<ValueSpecification<TA, VA>>, Diagnostic> {
	if (isObject(v)) {
		const wrapped = v.members.get("value");
		const nested = v.members.size === 1 || (v.members.size === 2 && v.members.has("doc"));
		if (wrapped !== undefined && nested) {
			warn(ctx, 'the nested { "doc", "value" } wrapper is the legacy spelling; put "doc" first beside "inputs" and "output"', v);
			const doc = optionalString(ctx, v.members, "doc");
			if (!doc.ok) return doc;
			const spec = readValueSpecification(at(ctx, "value"), wrapped);
			return spec.ok ? ok({ doc: doc.value, value: spec.value }) : spec;
		}
	}
	const r = readValueSpecificationWithDoc(ctx, v);
	return r.ok ? ok({ doc: r.value.doc, value: r.value.spec }) : r;
}

export function readModuleSpecification(ctx: Ctx, v: JsonValue): Result<ModuleSpecification<TA, VA>, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const m = members(ctx, o.value, [], ["annotations", "types", "values", "doc"]);
	if (!m.ok) return m;
	const annotations = readAnnotations(at(ctx, "annotations"), m.value.get("annotations"));
	if (!annotations.ok) return annotations;
	const types = optionalNamedMap(ctx, m.value, "types", readDocumentedTypeSpecification);
	if (!types.ok) return types;
	const values = optionalNamedMap(ctx, m.value, "values", readDocumentedValueSpecification);
	if (!values.ok) return values;
	const doc = optionalString(ctx, m.value, "doc");
	if (!doc.ok) return doc;
	return ok({ annotations: annotations.value, doc: doc.value, types: types.value, values: values.value });
}
