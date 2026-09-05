// packages/ir/src/versions/v4/write-definitions.ts
//
// Canonical writers for access control, documentation, and module definitions
// and specifications. There is exactly one v4 spelling for every node, so
// reading any accepted spelling and writing it back normalizes it: the three
// access spellings all come out as the tag form { "Public": payload } (kit
// definitions-0001), and a doc comes out first — inside the payload, beside
// the variant wrapper, or beside a value specification's own members when
// there is no wrapper (kit definitions-0006, definitions-0010; decision 0010).
//
// A module always writes both "types" and "values", empty or not, and its own
// "doc" last; a module specification writes "annotations" first when it has
// any.
import { type JsonValue, isObject, jsonObject } from "../../codec/json/value.ts";
import type { AccessControlled, Documented, ModuleDefinition, ModuleSpecification, Named } from "../../model/modules.ts";
import type { TypeDefinition, TypeSpecification } from "../../model/types.ts";
import type { ValueDefinition, ValueSpecification } from "../../model/values.ts";
import type { TA, VA } from "./attributes.ts";
import { nameKey } from "./write-names.ts";
import { writeAnnotations, writeTypeDefinition, writeTypeSpecification } from "./write-types.ts";
import { writeValueDefinition, writeValueSpecification } from "./write-values.ts";

type Entry = readonly [string, JsonValue];

// --------------------------------------------------------- access and doc

export function writeAccessControlled<T>(a: AccessControlled<T>, write: (t: T) => JsonValue): JsonValue {
	return jsonObject([[a.access, write(a.value)]]);
}

// The doc goes inside the variant wrapper, first, so { "TypeAliasDefinition":
// {..} } becomes { "doc": "..", "TypeAliasDefinition": {..} }. Every node
// writer returns an object, so the fallback is unreachable in practice.
function withDocFirst(doc: string | null, wrapper: JsonValue): JsonValue {
	return doc === null || !isObject(wrapper) ? wrapper : jsonObject([["doc", doc], ...wrapper.members]);
}

export function writeDocumentedTypeDefinition(d: Documented<TypeDefinition<TA>>): JsonValue {
	return withDocFirst(d.doc, writeTypeDefinition(d.value));
}

export function writeDocumentedValueDefinition(d: Documented<ValueDefinition<TA, VA>>): JsonValue {
	return withDocFirst(d.doc, writeValueDefinition(d.value));
}

export function writeDocumentedTypeSpecification(d: Documented<TypeSpecification<TA, VA>>): JsonValue {
	return withDocFirst(d.doc, writeTypeSpecification(d.value));
}

// A value specification is not a variant wrapper: it is the specification's own
// members ("inputs", "output"), but decision 0010 still puts "doc" first among
// them, ahead of "inputs" and "output".
export function writeDocumentedValueSpecification(d: Documented<ValueSpecification<TA, VA>>): JsonValue {
	const spec = writeValueSpecification(d.value);
	return d.doc === null || !isObject(spec) ? spec : jsonObject([["doc", d.doc], ...spec.members]);
}

export function writeAccessControlledTypeDefinition(a: AccessControlled<Documented<TypeDefinition<TA>>>): JsonValue {
	return writeAccessControlled(a, writeDocumentedTypeDefinition);
}

export function writeAccessControlledValueDefinition(a: AccessControlled<Documented<ValueDefinition<TA, VA>>>): JsonValue {
	return writeAccessControlled(a, writeDocumentedValueDefinition);
}

// ---------------------------------------------------------------- modules

export function writeNamedMap<T>(items: readonly Named<T>[], write: (t: T) => JsonValue): JsonValue {
	return jsonObject(items.map((x) => [nameKey(x.name), write(x.value)] as const));
}

export function writeModuleDefinition(d: ModuleDefinition<TA, VA>): JsonValue {
	const entries: Entry[] = [
		["types", writeNamedMap(d.types, writeAccessControlledTypeDefinition)],
		["values", writeNamedMap(d.values, writeAccessControlledValueDefinition)],
	];
	if (d.doc !== null) entries.push(["doc", d.doc]);
	return jsonObject(entries);
}

export function writeModuleSpecification(s: ModuleSpecification<TA, VA>): JsonValue {
	const entries: Entry[] = [];
	if (s.annotations.length > 0) entries.push(["annotations", writeAnnotations(s.annotations)]);
	entries.push(
		["types", writeNamedMap(s.types, writeDocumentedTypeSpecification)],
		["values", writeNamedMap(s.values, writeDocumentedValueSpecification)],
	);
	if (s.doc !== null) entries.push(["doc", s.doc]);
	return jsonObject(entries);
}
