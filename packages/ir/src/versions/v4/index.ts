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
// compatibility kit's fences are, and `stripNode` drops attributes so two
// spellings can be compared on meaning alone.
import { type Ctx, fail, root } from "../../codec/json/cursor.ts";
import { type JsonValue, parseJson, writeJson } from "../../codec/json/value.ts";
import { stripAttributes } from "../../model/attributes-map.ts";
import type { Diagnostic } from "../../model/diagnostic.ts";
import type * as model from "../../model/index.ts";
import type { AccessControlled, Documented } from "../../model/modules.ts";
import { type Result, ok } from "../../model/result.ts";
import type { TA, VA } from "./attributes.ts";
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

// ------------------------------------------------------------ node kinds

export type NodeKind =
	| "Name" | "Path" | "FQName" | "FormatVersion"
	| "Type" | "Literal" | "Pattern" | "Value"
	| "TypeSpecification" | "TypeDefinition" | "ValueSpecification" | "ValueDefinition"
	| "AccessControlledTypeDefinition" | "AccessControlledValueDefinition"
	| "Distribution";

type AccessControlledTypeDefinition = AccessControlled<Documented<TypeDefinition>>;
type AccessControlledValueDefinition = AccessControlled<Documented<ValueDefinition>>;

// A FormatVersion node is the member's own value, so it is recognized and
// checked for support here rather than in a document reader.
function readFormatVersionNode(ctx: Ctx, v: JsonValue): Result<model.FormatVersion, Diagnostic> {
	const recognized = recognize(ctx, v);
	if (!recognized.ok) return recognized;
	const fv = recognized.value.normalized;
	const compat = compatibility(fv, SUPPORTED);
	return compat === "supported"
		? ok(fv)
		: fail(ctx, compat, `format version ${fv.major}.${fv.minor}.${fv.patch} is not supported`);
}

function readNodeValue(node: NodeKind, v: JsonValue): Result<unknown, Diagnostic> {
	switch (node) {
		case "Name": return readName(root, v);
		case "Path": return readPath(root, v);
		case "FQName": return readFQName(root, v);
		case "FormatVersion": return readFormatVersionNode(root, v);
		case "Type": return readType(root, v);
		case "Literal": return readLiteral(root, v);
		case "Pattern": return readPattern(root, v);
		case "Value": return readValue(root, v);
		case "TypeSpecification": return readTypeSpecification(root, v);
		case "TypeDefinition": return readTypeDefinition(root, v);
		case "ValueSpecification": return readValueSpecification(root, v);
		case "ValueDefinition": return readValueDefinition(root, v);
		case "AccessControlledTypeDefinition": return readAccessControlledTypeDefinition(root, v);
		case "AccessControlledValueDefinition": return readAccessControlledValueDefinition(root, v);
		// A Distribution fence is a whole document: the kit's fences carry the
		// root's formatVersion beside the distribution itself.
		case "Distribution": return readIRFile(v);
	}
}

function writeNodeValue(node: NodeKind, value: unknown): JsonValue {
	switch (node) {
		case "Name": return writeName(value as model.Name);
		case "Path": return writePath(value as model.Path);
		case "FQName": return writeFQName(value as model.FQName);
		case "FormatVersion": return canonicalFormatVersion(value as model.FormatVersion);
		case "Type": return writeType(value as Type);
		case "Literal": return writeLiteral(value as Literal);
		case "Pattern": return writePattern(value as Pattern);
		case "Value": return writeValue(value as Value);
		case "TypeSpecification": return writeTypeSpecification(value as TypeSpecification);
		case "TypeDefinition": return writeTypeDefinition(value as TypeDefinition);
		case "ValueSpecification": return writeValueSpecification(value as ValueSpecification);
		case "ValueDefinition": return writeValueDefinition(value as ValueDefinition);
		case "AccessControlledTypeDefinition": return writeAccessControlledTypeDefinition(value as AccessControlledTypeDefinition);
		case "AccessControlledValueDefinition": return writeAccessControlledValueDefinition(value as AccessControlledValueDefinition);
		case "Distribution": return writeIRFile(value as IRFile);
	}
}

// Names, the format version and literals carry no attributes, so they come
// back as they went in; everything else goes through the model's
// stripAttributes.
export const stripNode = (node: NodeKind, value: unknown): unknown => {
	switch (node) {
		case "Name": case "Path": case "FQName": case "FormatVersion": case "Literal":
			return value;
		case "Type": return stripAttributes.type(value as Type);
		case "Pattern": return stripAttributes.pattern(value as Pattern);
		case "Value": return stripAttributes.value(value as Value);
		case "TypeSpecification": return stripAttributes.typeSpecification(value as TypeSpecification);
		case "TypeDefinition": return stripAttributes.typeDefinition(value as TypeDefinition);
		case "ValueSpecification": return stripAttributes.valueSpecification(value as ValueSpecification);
		case "ValueDefinition": return stripAttributes.valueDefinition(value as ValueDefinition);
		case "AccessControlledTypeDefinition": {
			const a = value as AccessControlledTypeDefinition;
			return { access: a.access, value: { doc: a.value.doc, value: stripAttributes.typeDefinition(a.value.value) } };
		}
		case "AccessControlledValueDefinition": {
			const a = value as AccessControlledValueDefinition;
			return { access: a.access, value: { doc: a.value.doc, value: stripAttributes.valueDefinition(a.value.value) } };
		}
		case "Distribution": return stripAttributes.irFile(value as IRFile);
	}
};

// ---------------------------------------------------------------- the codec

export const json = {
	read(text: string): Result<IRFile, Diagnostic> {
		const parsed = parseJson(text);
		return parsed.ok ? readIRFile(parsed.value) : parsed;
	},
	write(file: IRFile): string {
		return writeJson(writeIRFile(file));
	},
	readNode(node: NodeKind, text: string): Result<unknown, Diagnostic> {
		const parsed = parseJson(text);
		return parsed.ok ? readNodeValue(node, parsed.value) : parsed;
	},
	writeNode(node: NodeKind, value: unknown): string {
		return writeJson(writeNodeValue(node, value));
	},
};
