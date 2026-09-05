// packages/ir/src/versions/v4/write-values.ts
//
// Canonical writers for literals, patterns, value expressions, value
// definitions and value specifications. There is exactly one v4 spelling for
// every node, so reading any accepted spelling and writing it back normalizes
// it. Attributes are written only when they carry something, and when they do
// the wrapper switches to its expanded form with "attributes" first.
//
// A literal is always written in its typed form, never as the bare shorthand
// the reader accepts (kit values-0001), because the shorthand only works where
// the type is already known. The same goes for the rest of decision 0009: a
// list keeps its wrapper even though a bare array reads as one. A Record's
// fields always go under "fields" (decision 0004), and none of decision
// 0006's window spellings is ever written.
import { type JsonValue, jsonNumber, jsonObject } from "../../codec/json/value.ts";
import type {
	InputType,
	Literal,
	NativeHint,
	NativeInfo,
	Pattern,
	RecordField,
	Value,
	ValueDefinition,
	ValueSpecification,
} from "../../model/values.ts";
import { type TA, type VA, writeValueAttributes } from "./attributes.ts";
import { nameKey, writeFQName, writeName } from "./write-names.ts";
import { writeAnnotations, writeHoleReason, writeIncompleteness, writeType } from "./write-types.ts";

type Entry = readonly [string, JsonValue];

const wrap = (key: string, payload: JsonValue): JsonValue => jsonObject([[key, payload]]);

// ---------------------------------------------------------------- literals

// String(1) is "1", which reads back as an IntegerLiteral, so an integral
// float keeps its point. Exponent spellings already carry a marker and are
// left alone: "1e+21.0" is not JSON.
function floatText(n: number): string {
	const s = String(n);
	return /[.eE]/.test(s) ? s : `${s}.0`;
}

export function writeLiteral(l: Literal): JsonValue {
	switch (l.kind) {
		case "BoolLiteral": return wrap("BoolLiteral", l.value);
		case "CharLiteral": return wrap("CharLiteral", l.value);
		case "StringLiteral": return wrap("StringLiteral", l.value);
		// WholeNumberLiteral is read but never written.
		case "IntegerLiteral": return wrap("IntegerLiteral", jsonNumber(l.value.toString()));
		case "FloatLiteral": return wrap("FloatLiteral", jsonNumber(floatText(l.value)));
		case "DecimalLiteral": return wrap("DecimalLiteral", l.value);
	}
}

// ---------------------------------------------------------------- patterns

export function writePattern(p: Pattern<VA>): JsonValue {
	const a = writeValueAttributes(p.attributes);
	const head: Entry[] = a === null ? [] : [["attributes", a]];
	switch (p.kind) {
		case "WildcardPattern": case "EmptyListPattern": case "UnitPattern":
			return wrap(p.kind, jsonObject(head));
		case "AsPattern":
			return wrap("AsPattern", jsonObject([...head, ["pattern", writePattern(p.pattern)], ["name", writeName(p.name)]]));
		case "TuplePattern": {
			const patterns = p.patterns.map(writePattern);
			return wrap("TuplePattern", a === null ? patterns : jsonObject([["attributes", a], ["patterns", patterns]]));
		}
		case "ConstructorPattern":
			return wrap("ConstructorPattern", jsonObject([
				...head,
				["fqname", writeFQName(p.fqname)],
				["patterns", p.patterns.map(writePattern)],
			]));
		case "HeadTailPattern":
			return wrap("HeadTailPattern", jsonObject([...head, ["head", writePattern(p.head)], ["tail", writePattern(p.tail)]]));
		case "LiteralPattern": {
			const literal = writeLiteral(p.literal);
			return wrap("LiteralPattern", a === null ? literal : jsonObject([["attributes", a], ["literal", literal]]));
		}
	}
}

// ------------------------------------------------------------ native info

export function writeNativeHint(h: NativeHint): JsonValue {
	return h.kind === "PlatformSpecific"
		? wrap("PlatformSpecific", jsonObject([["platform", h.platform]]))
		: wrap(h.kind, jsonObject([]));
}

export function writeNativeInfo(i: NativeInfo): JsonValue {
	const entries: Entry[] = [["hint", writeNativeHint(i.hint)]];
	if (i.description !== null) entries.push(["description", i.description]);
	return jsonObject(entries);
}

// ------------------------------------------------------------------ values

const writeFieldValues = (fields: readonly RecordField<TA, VA>[]): JsonValue =>
	jsonObject(fields.map((f) => [nameKey(f.name), writeValue(f.value)] as const));

export function writeValue(v: Value<TA, VA>): JsonValue {
	const a = writeValueAttributes(v.attributes);
	const head: Entry[] = a === null ? [] : [["attributes", a]];
	switch (v.kind) {
		case "Literal": {
			const literal = writeLiteral(v.literal);
			return wrap("Literal", a === null ? literal : jsonObject([["attributes", a], ["literal", literal]]));
		}
		case "Constructor": case "Reference": {
			const fqname = writeFQName(v.fqname);
			return wrap(v.kind, a === null ? fqname : jsonObject([["attributes", a], ["fqname", fqname]]));
		}
		case "Variable": case "FieldFunction": {
			const name = writeName(v.name);
			return wrap(v.kind, a === null ? name : jsonObject([["attributes", a], ["name", name]]));
		}
		case "Tuple": {
			const elements = v.elements.map(writeValue);
			return wrap("Tuple", a === null ? elements : jsonObject([["attributes", a], ["elements", elements]]));
		}
		case "List": {
			const items = v.items.map(writeValue);
			return wrap("List", a === null ? items : jsonObject([["attributes", a], ["items", items]]));
		}
		case "Record": {
			// Decision 0004, the same rule the type writer follows: the fields
			// always go under "fields".
			const fields = writeFieldValues(v.fields);
			return wrap("Record", jsonObject(a === null ? [["fields", fields]] : [["attributes", a], ["fields", fields]]));
		}
		case "Unit":
			return wrap("Unit", jsonObject(head));
		case "Field":
			return wrap("Field", jsonObject([...head, ["target", writeValue(v.target)], ["name", writeName(v.name)]]));
		case "Apply":
			return wrap("Apply", jsonObject([...head, ["function", writeValue(v.function)], ["argument", writeValue(v.argument)]]));
		case "Lambda":
			return wrap("Lambda", jsonObject([...head, ["pattern", writePattern(v.pattern)], ["body", writeValue(v.body)]]));
		case "LetDefinition":
			return wrap("LetDefinition", jsonObject([
				...head,
				["name", writeName(v.name)],
				["definition", writeValueDefinition(v.definition)],
				["in", writeValue(v.in)],
			]));
		case "LetRecursion":
			return wrap("LetRecursion", jsonObject([
				...head,
				["definitions", jsonObject(v.definitions.map((d) => [nameKey(d.name), writeValueDefinition(d.definition)] as const))],
				["in", writeValue(v.in)],
			]));
		case "Destructure":
			return wrap("Destructure", jsonObject([
				...head,
				["pattern", writePattern(v.pattern)],
				["value", writeValue(v.value)],
				["in", writeValue(v.in)],
			]));
		case "IfThenElse":
			return wrap("IfThenElse", jsonObject([
				...head,
				["condition", writeValue(v.condition)],
				["then", writeValue(v.then)],
				["else", writeValue(v.else)],
			]));
		case "PatternMatch":
			return wrap("PatternMatch", jsonObject([
				...head,
				["value", writeValue(v.value)],
				["cases", v.cases.map((c) => jsonObject([["pattern", writePattern(c.pattern)], ["body", writeValue(c.body)]]) as JsonValue)],
			]));
		case "UpdateRecord":
			return wrap("UpdateRecord", jsonObject([...head, ["target", writeValue(v.target)], ["fields", writeFieldValues(v.fields)]]));
		case "Hole": {
			const entries: Entry[] = [...head, ["reason", writeHoleReason(v.reason)]];
			if (v.expectedType !== null) entries.push(["expectedType", writeType(v.expectedType)]);
			return wrap("Hole", jsonObject(entries));
		}
	}
}

// ---------------------------------------- definitions and specifications

// v4 writes input types as an object map keyed by parameter name; the legacy
// pair array is read and never written.
export function writeInputTypes(inputs: readonly InputType<TA>[]): JsonValue {
	return jsonObject(inputs.map((i) => [nameKey(i.name), writeType(i.type)] as const));
}

export function writeValueDefinition(d: ValueDefinition<TA, VA>): JsonValue {
	const entries: Entry[] = [["inputTypes", writeInputTypes(d.inputTypes)]];
	switch (d.kind) {
		case "ExpressionBody":
			entries.push(["outputType", writeType(d.outputType)], ["body", writeValue(d.body)]);
			break;
		case "NativeBody":
			entries.push(["outputType", writeType(d.outputType)], ["nativeInfo", writeNativeInfo(d.nativeInfo)]);
			break;
		case "ExternalBody":
			entries.push(
				["outputType", writeType(d.outputType)],
				["externalName", d.externalName],
				["targetPlatform", d.targetPlatform],
			);
			break;
		case "IncompleteBody":
			// The only body whose output type the schema leaves optional.
			if (d.outputType !== null) entries.push(["outputType", writeType(d.outputType)]);
			entries.push(["incompleteness", writeIncompleteness(d.incompleteness)]);
			if (d.partialBody !== null) entries.push(["partialBody", writeValue(d.partialBody)]);
			break;
	}
	return wrap(d.kind, jsonObject(entries));
}

// "doc" is carried by the Documented wrapper in modules, so it is never
// written here even when the reader saw one.
export function writeValueSpecification(s: ValueSpecification<TA, VA>): JsonValue {
	const entries: Entry[] = [];
	if (s.annotations.length > 0) entries.push(["annotations", writeAnnotations(s.annotations)]);
	if (s.inputs.length > 0) entries.push(["inputs", writeInputTypes(s.inputs)]);
	entries.push(["output", writeType(s.output)]);
	return jsonObject(entries);
}
