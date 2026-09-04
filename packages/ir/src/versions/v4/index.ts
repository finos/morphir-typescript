// packages/ir/src/versions/v4/index.ts
//
// The pinned v4 module: import from "@finos/morphir-ir/v4".
//
// The generic model is parameterized over its attribute types; v4 pins them to
// the concrete records this profile defines, so every name here is the v4
// instantiation and nothing downstream has to spell TA and VA again.
//
// `json` is the whole codec surface. `read` and `write` are for documents;
// `readNode` and `writeNode` are for single nodes, which is what the
// compatibility kit's fences are, and `stripNode` clears attributes so two
// spellings can be compared on meaning alone. A node travels as a NodeValue —
// the node's name and its value in one discriminated union — so the dispatch
// is checked rather than cast.
import { type Ctx, fail, root } from "../../codec/json/cursor.ts";
import { type JsonValue, parseJson, writeJson } from "../../codec/json/value.ts";
import {
	type AttributeMapper,
	mapAttributes,
	mapPattern,
	mapType,
	mapTypeDefinition,
	mapTypeSpecification,
	mapValue,
	mapValueDefinition,
	mapValueSpecification,
} from "../../model/attributes-map.ts";
import type { Diagnostic } from "../../model/diagnostic.ts";
import type * as model from "../../model/index.ts";
import type { AccessControlled, Documented } from "../../model/modules.ts";
import { type Result, ok } from "../../model/result.ts";
import { EMPTY_TYPE_ATTRIBUTES, type TA, type VA, emptyValueAttributes } from "./attributes.ts";
import { SUPPORTED, canonicalFormatVersion, compatibility, recognize } from "./format-version.ts";
import { readAccessControlledTypeDefinition, readAccessControlledValueDefinition } from "./read-definitions.ts";
import { readIRFile } from "./read-distribution.ts";
import { readFQName, readName, readPath } from "./read-names.ts";
import { readType, readTypeDefinition, readTypeSpecification } from "./read-types.ts";
import { readLiteral, readPattern, readValue, readValueDefinition, readValueSpecification } from "./read-values.ts";
import { writeAccessControlledTypeDefinition, writeAccessControlledValueDefinition } from "./write-definitions.ts";
import { writeIRFile } from "./write-distribution.ts";
import { writeFQName, writeName, writePath } from "./write-names.ts";
import { writeType, writeTypeDefinition, writeTypeSpecification } from "./write-types.ts";
import { writeLiteral, writePattern, writeValue, writeValueDefinition, writeValueSpecification } from "./write-values.ts";

// ----------------------------------------------------------- the v4 model

export type { TA as TypeAttributes, VA as ValueAttributes };

export type Type = model.Type<TA>;
export type Value = model.Value<TA, VA>;
export type Pattern = model.Pattern<VA>;
export type Literal = model.Literal;
export type TypeSpecification = model.TypeSpecification<TA, VA>;
export type TypeDefinition = model.TypeDefinition<TA>;
export type ValueSpecification = model.ValueSpecification<TA, VA>;
export type ValueDefinition = model.ValueDefinition<TA, VA>;
export type ModuleDefinition = model.ModuleDefinition<TA, VA>;
export type ModuleSpecification = model.ModuleSpecification<TA, VA>;
export type PackageDefinition = model.PackageDefinition<TA, VA>;
export type PackageSpecification = model.PackageSpecification<TA, VA>;
export type Distribution = model.Distribution<TA, VA>;
export type IRFile = model.IRFile<TA, VA>;

type AccessControlledTypeDefinition = AccessControlled<Documented<TypeDefinition>>;
type AccessControlledValueDefinition = AccessControlled<Documented<ValueDefinition>>;

// ------------------------------------------------------------ node kinds

// One node, named and typed together. Every entry point takes and returns this
// union, so the compiler decides which reader and which writer belong to a
// node name and no caller has to assert what came back.
export type NodeValue =
	| { readonly node: "Name"; readonly value: model.Name }
	| { readonly node: "Path"; readonly value: model.Path }
	| { readonly node: "FQName"; readonly value: model.FQName }
	| { readonly node: "FormatVersion"; readonly value: model.FormatVersion }
	| { readonly node: "Type"; readonly value: Type }
	| { readonly node: "Literal"; readonly value: Literal }
	| { readonly node: "Pattern"; readonly value: Pattern }
	| { readonly node: "Value"; readonly value: Value }
	| { readonly node: "TypeSpecification"; readonly value: TypeSpecification }
	| { readonly node: "TypeDefinition"; readonly value: TypeDefinition }
	| { readonly node: "ValueSpecification"; readonly value: ValueSpecification }
	| { readonly node: "ValueDefinition"; readonly value: ValueDefinition }
	| { readonly node: "AccessControlledTypeDefinition"; readonly value: AccessControlledTypeDefinition }
	| { readonly node: "AccessControlledValueDefinition"; readonly value: AccessControlledValueDefinition }
	| { readonly node: "IRFile"; readonly value: IRFile };

export type NodeKind = NodeValue["node"];

// The compatibility kit names the whole-document node "Distribution"; here that
// name belongs to the distribution inside the file, so the kit's spelling is an
// alias a runner resolves before it calls readNode.
export const NODE_ALIASES: Readonly<Record<string, NodeKind>> = { Distribution: "IRFile" };

// A FormatVersion node is the member's own value, so it is recognized and
// checked for support here rather than in a document reader.
function readFormatVersionNode(ctx: Ctx, v: JsonValue): Result<model.FormatVersion, Diagnostic> {
	const recognized = recognize(ctx, v);
	if (!recognized.ok) return recognized;
	const fv = recognized.value.normalized;
	const compat = compatibility(fv, SUPPORTED);
	return compat === "supported"
		? ok(fv)
		: fail(ctx, compat, `format version ${fv.major}.${fv.minor}.${fv.patch} is not supported`, v);
}

// Pairs a reader's result with the node name it was asked for, so each case of
// the dispatch produces exactly one member of the union.
function nodeOf<K extends NodeKind, T>(node: K, r: Result<T, Diagnostic>): Result<{ readonly node: K; readonly value: T }, Diagnostic> {
	return r.ok ? ok({ node, value: r.value }) : r;
}

export function readNode(node: NodeKind, text: string): Result<NodeValue, Diagnostic> {
	const parsed = parseJson(text);
	if (!parsed.ok) return parsed;
	const v = parsed.value;
	switch (node) {
		case "Name": return nodeOf("Name", readName(root, v));
		case "Path": return nodeOf("Path", readPath(root, v));
		case "FQName": return nodeOf("FQName", readFQName(root, v));
		case "FormatVersion": return nodeOf("FormatVersion", readFormatVersionNode(root, v));
		case "Type": return nodeOf("Type", readType(root, v));
		case "Literal": return nodeOf("Literal", readLiteral(root, v));
		case "Pattern": return nodeOf("Pattern", readPattern(root, v));
		case "Value": return nodeOf("Value", readValue(root, v));
		case "TypeSpecification": return nodeOf("TypeSpecification", readTypeSpecification(root, v));
		case "TypeDefinition": return nodeOf("TypeDefinition", readTypeDefinition(root, v));
		case "ValueSpecification": return nodeOf("ValueSpecification", readValueSpecification(root, v));
		case "ValueDefinition": return nodeOf("ValueDefinition", readValueDefinition(root, v));
		case "AccessControlledTypeDefinition": return nodeOf("AccessControlledTypeDefinition", readAccessControlledTypeDefinition(root, v));
		case "AccessControlledValueDefinition": return nodeOf("AccessControlledValueDefinition", readAccessControlledValueDefinition(root, v));
		// An IRFile node is a whole document: the kit's fences carry the root's
		// formatVersion beside the distribution itself.
		case "IRFile": return nodeOf("IRFile", readIRFile(v));
		default: { const _: never = node; return _; }
	}
}

function writeNodeValue(v: NodeValue): JsonValue {
	switch (v.node) {
		case "Name": return writeName(v.value);
		case "Path": return writePath(v.value);
		case "FQName": return writeFQName(v.value);
		case "FormatVersion": return canonicalFormatVersion(v.value);
		case "Type": return writeType(v.value);
		case "Literal": return writeLiteral(v.value);
		case "Pattern": return writePattern(v.value);
		case "Value": return writeValue(v.value);
		case "TypeSpecification": return writeTypeSpecification(v.value);
		case "TypeDefinition": return writeTypeDefinition(v.value);
		case "ValueSpecification": return writeValueSpecification(v.value);
		case "ValueDefinition": return writeValueDefinition(v.value);
		case "AccessControlledTypeDefinition": return writeAccessControlledTypeDefinition(v.value);
		case "AccessControlledValueDefinition": return writeAccessControlledValueDefinition(v.value);
		case "IRFile": return writeIRFile(v.value);
		default: { const _: never = v; return _; }
	}
}

export function writeNode(v: NodeValue): string {
	return writeJson(writeNodeValue(v));
}

// The name a fence means by `expect=`: the variant a node decoded to. Names,
// the format version and value specifications have no variants, so they answer
// with the node's own name.
export function nodeKindOf(v: NodeValue): string {
	switch (v.node) {
		case "Name": case "Path": case "FQName": case "FormatVersion": case "ValueSpecification":
			return v.node;
		case "Type": case "Literal": case "Pattern": case "Value":
		case "TypeSpecification": case "TypeDefinition": case "ValueDefinition":
			return v.value.kind;
		case "AccessControlledTypeDefinition": case "AccessControlledValueDefinition":
			return v.value.value.value.kind;
		case "IRFile": return v.value.distribution.kind;
		default: { const _: never = v; return _; }
	}
}

// Comparing two spellings on meaning alone means clearing what the spelling
// carried. Attributes are cleared to the empty v4 records rather than dropped,
// so the result is still a v4 node the v4 writers accept; the writers omit an
// empty attributes member, which is what makes the two encodings match.
const EMPTY_VALUE_ATTRIBUTES: VA = emptyValueAttributes<TA>();
const cleared: AttributeMapper<TA, VA, TA, VA> = {
	onType: () => EMPTY_TYPE_ATTRIBUTES,
	onValue: () => EMPTY_VALUE_ATTRIBUTES,
};

export function stripNode(v: NodeValue): NodeValue {
	switch (v.node) {
		// Names, the format version and literals carry no attributes, so they come
		// back as they went in.
		case "Name": case "Path": case "FQName": case "FormatVersion": case "Literal":
			return v;
		case "Type": return { node: "Type", value: mapType(v.value, cleared.onType) };
		case "Pattern": return { node: "Pattern", value: mapPattern(v.value, cleared.onValue) };
		case "Value": return { node: "Value", value: mapValue(v.value, cleared) };
		case "TypeSpecification": return { node: "TypeSpecification", value: mapTypeSpecification(v.value, cleared) };
		case "TypeDefinition": return { node: "TypeDefinition", value: mapTypeDefinition(v.value, cleared.onType) };
		case "ValueSpecification": return { node: "ValueSpecification", value: mapValueSpecification(v.value, cleared) };
		case "ValueDefinition": return { node: "ValueDefinition", value: mapValueDefinition(v.value, cleared) };
		case "AccessControlledTypeDefinition":
			return {
				node: "AccessControlledTypeDefinition",
				value: { access: v.value.access, value: { doc: v.value.value.doc, value: mapTypeDefinition(v.value.value.value, cleared.onType) } },
			};
		case "AccessControlledValueDefinition":
			return {
				node: "AccessControlledValueDefinition",
				value: { access: v.value.access, value: { doc: v.value.value.doc, value: mapValueDefinition(v.value.value.value, cleared) } },
			};
		case "IRFile": return { node: "IRFile", value: mapAttributes(v.value, cleared.onType, cleared.onValue) };
		default: { const _: never = v; return _; }
	}
}

// ---------------------------------------------------------------- the codec

export const json = {
	read(text: string): Result<IRFile, Diagnostic> {
		const parsed = parseJson(text);
		return parsed.ok ? readIRFile(parsed.value) : parsed;
	},
	write(file: IRFile): string {
		return writeJson(writeIRFile(file));
	},
	readNode,
	writeNode,
};
