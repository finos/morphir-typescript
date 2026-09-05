// packages/ir/src/versions/v4/write-types.ts
//
// Canonical writers for type expressions, specifications and definitions.
// There is exactly one v4 spelling for every node, so reading any accepted
// spelling and writing it back normalizes it. Attributes are written only
// when they carry something, and when they do the wrapper switches to its
// expanded form with "attributes" first (decision 0005).
//
// The window spellings the reader accepts under decision 0006 — a field
// map directly under "Record", "argumentType", "arg"/"result", "attrs" —
// are never written here.
import { type JsonValue, jsonObject } from "../../codec/json/value.ts";
import { Name } from "../../model/names.ts";
import type {
	Annotation,
	AnnotationArgument,
	Constructor,
	Field,
	HoleReason,
	Incompleteness,
	Type,
	TypeDefinition,
	TypeSpecification,
} from "../../model/types.ts";
import { type TA, type VA, writeTypeAttributes } from "./attributes.ts";
import { nameKey, writeFQName, writeName } from "./write-names.ts";
import { writeValue } from "./write-values.ts";

type Entry = readonly [string, JsonValue];

const wrap = (key: string, payload: JsonValue): JsonValue => jsonObject([[key, payload]]);
const writeNames = (ns: readonly Name[]): JsonValue => ns.map(writeName);
const writeFieldMap = (fields: readonly Field<TA>[]): JsonValue =>
	jsonObject(fields.map((f) => [nameKey(f.name), writeType(f.type)] as const));

// ------------------------------------------------------------ expressions

export function writeType(t: Type<TA>): JsonValue {
	const a = writeTypeAttributes(t.attributes);
	switch (t.kind) {
		case "Variable":
			return a === null ? writeName(t.name) : wrap("Variable", jsonObject([["attributes", a], ["name", writeName(t.name)]]));
		case "Reference": {
			const fqname = writeFQName(t.fqname);
			if (a === null) {
				// A reference with no arguments is just its FQName string; with
				// arguments it is the wrapper array, never a bare array.
				return t.args.length === 0 ? fqname : wrap("Reference", [fqname, ...t.args.map(writeType)]);
			}
			const entries: Entry[] = [["attributes", a], ["fqname", fqname]];
			if (t.args.length > 0) entries.push(["args", t.args.map(writeType)]);
			return wrap("Reference", jsonObject(entries));
		}
		case "Tuple": {
			const elements = t.elements.map(writeType);
			return wrap("Tuple", a === null ? elements : jsonObject([["attributes", a], ["elements", elements]]));
		}
		case "Record": {
			// Decision 0004: the fields always go under "fields", so a field
			// called "fields" or "attributes" needs no special case.
			const fields = writeFieldMap(t.fields);
			return wrap("Record", jsonObject(a === null ? [["fields", fields]] : [["attributes", a], ["fields", fields]]));
		}
		case "ExtensibleRecord": {
			const entries: Entry[] = a === null ? [] : [["attributes", a]];
			entries.push(["variable", writeName(t.variable)], ["fields", writeFieldMap(t.fields)]);
			return wrap("ExtensibleRecord", jsonObject(entries));
		}
		case "Function": {
			const entries: Entry[] = a === null ? [] : [["attributes", a]];
			entries.push(["parameterType", writeType(t.parameterType)], ["returnType", writeType(t.returnType)]);
			return wrap("Function", jsonObject(entries));
		}
		case "Unit":
			return wrap("Unit", jsonObject(a === null ? [] : [["attributes", a]]));
	}
}

// ----------------------------------------------------------- constructors

export function writeConstructors(cs: readonly Constructor<TA>[]): JsonValue {
	return jsonObject(cs.map((c) => [
		nameKey(c.name),
		c.parameters.map((p) => [writeName(p.name), writeType(p.type)] as JsonValue),
	] as const));
}

// ------------------------------------------------------------ annotations

function writeAnnotationArgument(arg: AnnotationArgument<TA, VA>): JsonValue {
	return arg.kind === "Positional"
		? writeValue(arg.value)
		: jsonObject([["name", writeName(arg.name)], ["value", writeValue(arg.value)]]);
}

function writeAnnotation(a: Annotation<TA, VA>): JsonValue {
	if (a.kind === "Compact") {
		const fqname = writeFQName(a.name) as string;
		return a.text === null ? fqname : `${fqname}:${a.text}`;
	}
	const entries: Entry[] = [["name", writeFQName(a.name)]];
	if (a.args.length > 0) entries.push(["arguments", a.args.map(writeAnnotationArgument)]);
	return jsonObject(entries);
}

export function writeAnnotations(as: readonly Annotation<TA, VA>[]): JsonValue {
	return as.map(writeAnnotation);
}

// --------------------------------------------- specifications and definitions

export function writeTypeSpecification(s: TypeSpecification<TA, VA>): JsonValue {
	const entries: Entry[] = [];
	if (s.annotations.length > 0) entries.push(["annotations", writeAnnotations(s.annotations)]);
	switch (s.kind) {
		case "OpaqueTypeSpecification":
			// The only specification whose typeParams the schema leaves optional,
			// so an opaque type with no parameters is the empty object.
			if (s.typeParams.length > 0) entries.push(["typeParams", writeNames(s.typeParams)]);
			break;
		case "TypeAliasSpecification":
			entries.push(["typeParams", writeNames(s.typeParams)], ["typeExp", writeType(s.typeExp)]);
			break;
		case "CustomTypeSpecification":
			entries.push(["typeParams", writeNames(s.typeParams)], ["constructors", writeConstructors(s.constructors)]);
			break;
		case "DerivedTypeSpecification":
			entries.push(
				["typeParams", writeNames(s.typeParams)],
				["baseType", writeType(s.baseType)],
				["fromBaseType", writeFQName(s.fromBaseType)],
				["toBaseType", writeFQName(s.toBaseType)],
			);
			break;
	}
	return wrap(s.kind, jsonObject(entries));
}

export function writeHoleReason(r: HoleReason): JsonValue {
	switch (r.kind) {
		case "UnresolvedReference":
			return wrap("UnresolvedReference", jsonObject([["target", writeFQName(r.target)]]));
		case "DeletedDuringRefactor":
			// The model spells it txId; the wire key is "tx-id".
			return wrap("DeletedDuringRefactor", jsonObject([["tx-id", r.txId]]));
		case "TypeMismatch":
			return wrap("TypeMismatch", jsonObject([["expected", r.expected], ["found", r.found]]));
	}
}

export function writeIncompleteness(i: Incompleteness<TA>): JsonValue {
	if (i.kind === "Draft") return wrap("Draft", jsonObject([]));
	const entries: Entry[] = [["reason", writeHoleReason(i.reason)]];
	if (i.partialBody !== null) entries.push(["partialBody", writeType(i.partialBody)]);
	return wrap("Hole", jsonObject(entries));
}

export function writeTypeDefinition(d: TypeDefinition<TA>): JsonValue {
	const entries: Entry[] = [["typeParams", writeNames(d.typeParams)]];
	switch (d.kind) {
		case "TypeAliasDefinition":
			entries.push(["typeExp", writeType(d.typeExp)]);
			break;
		case "CustomTypeDefinition":
			entries.push(["access", d.constructorsAccess], ["constructors", writeConstructors(d.constructors)]);
			break;
		case "IncompleteTypeDefinition":
			entries.push(["incompleteness", writeIncompleteness(d.incompleteness)]);
			if (d.partialTypeExp !== null) entries.push(["partialTypeExp", writeType(d.partialTypeExp)]);
			break;
	}
	return wrap(d.kind, jsonObject(entries));
}
