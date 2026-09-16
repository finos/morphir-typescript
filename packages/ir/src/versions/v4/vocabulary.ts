// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The v4 vocabulary manifest (see the kit README's coverage description):
// every node variant the v4 readers recognize, and every member spelling
// (canonical and legacy) they accept for it. The compatibility kit's
// `mck coverage` rule walks this table against the kit's cases and reports a
// gap for any variant or member spelling with no case.
//
// This table is hand-written, not derived: read-types.ts, read-values.ts and
// read-definitions.ts do not expose the variant and member tables they switch
// on, and refactoring them to do so is out of scope here. vocabulary.test.ts
// is the drift guard — it scans those three reader sources for every
// `case "<Label>":` and every
// `windowed(ctx, m, "<canonical>", "<legacy>", ...)` occurrence and fails when
// this table and the readers disagree. To add a new variant or member
// spelling: add the reader code first, run vocabulary.test.ts to see it fail
// naming what is missing, then add the matching entry or member below.
//
// A handful of legacy spellings are not read through windowed() — a
// three-way check for a type Function's parameter, a bare field map standing
// in for a Record's whole payload, the Documented nested {doc,value}
// wrapper, and ValueDefinition's ExternalBody top-level pair — so the drift
// test's scan cannot find them by pattern; they are asserted by hand there
// instead. The Record bare-field-map shape has no member entry here: a
// member name is a JSON key, and that legacy shape has none (the whole
// payload stands in for {"fields": ..}), so a fake member would only ever
// show as a gap the kit can never close. The kit already exercises the shape
// through an `accepted warning=legacy_spelling` fence; the drift test
// acknowledges the reader's `isRecordPayload` warn site directly instead.
import type { NodeKind } from "./index.ts";

export interface VocabularySpelling {
	readonly name: string;
	readonly spelling: "canonical" | "legacy";
}

export interface VocabularyEntry {
	readonly node: NodeKind;
	readonly variant: string;
	readonly members: readonly VocabularySpelling[];
}

const canonical = (name: string): VocabularySpelling => ({ name, spelling: "canonical" });
const legacy = (name: string): VocabularySpelling => ({ name, spelling: "legacy" });

// The attributes/attrs legacy pair belongs to every expanded payload, but
// listing it on every one of the fifty-odd entries below would only pad the
// coverage gap list; it is modeled once per reader, on Type/Record and
// Value/Record (decision 0006, kit types-0004/values-0004).
const ATTRIBUTES_PAIR: readonly VocabularySpelling[] = [canonical("attributes"), legacy("attrs")];

// The Record payload has two shapes: the canonical { "fields": {..} }, and the
// legacy bare field map directly under the wrapper (read-types.ts
// isRecordPayload, read-values.ts isRecordPayload). That legacy shape has no
// member of its own to list — see the file header — so only "fields" and the
// attributes pair appear here.
const RECORD_MEMBERS: readonly VocabularySpelling[] = [canonical("fields"), ...ATTRIBUTES_PAIR];

export const VOCABULARY: readonly VocabularyEntry[] = [
	// -------------------------------------------------------------- Type
	{ node: "Type", variant: "Variable", members: [] },
	{ node: "Type", variant: "Reference", members: [] },
	{ node: "Type", variant: "Tuple", members: [] },
	{ node: "Type", variant: "Record", members: RECORD_MEMBERS },
	{ node: "Type", variant: "ExtensibleRecord", members: [] },
	// Decision 0007: the parameter slot has three spellings (parameterType,
	// the pre-decision argumentType, and the Rust encoder's arg), the last of
	// which is checked by hand in readFunctionType rather than through
	// windowed(). The return slot has two (returnType, result).
	{
		node: "Type",
		variant: "Function",
		members: [canonical("parameterType"), legacy("argumentType"), legacy("arg"), canonical("returnType"), legacy("result")],
	},
	{ node: "Type", variant: "Unit", members: [] },
	// readIncompleteness's own case labels (INCOMPLETENESS_KEYS): a Hole here is
	// the whole-type incompleteness wrapper, distinct from Value's Hole below.
	{ node: "Type", variant: "Hole", members: [] },
	{ node: "Type", variant: "Draft", members: [] },
	// readHoleReason's case labels (HOLE_REASON_KEYS): the reasons a Hole (Type
	// or Value) carries.
	{ node: "Type", variant: "TypeMismatch", members: [] },
	{ node: "Type", variant: "UnresolvedReference", members: [] },
	{ node: "Type", variant: "DeletedDuringRefactor", members: [] },

	// ----------------------------------------------------- TypeSpecification
	{ node: "TypeSpecification", variant: "TypeAliasSpecification", members: [] },
	{ node: "TypeSpecification", variant: "OpaqueTypeSpecification", members: [] },
	{ node: "TypeSpecification", variant: "CustomTypeSpecification", members: [] },
	{ node: "TypeSpecification", variant: "DerivedTypeSpecification", members: [] },

	// --------------------------------------------------------- TypeDefinition
	{ node: "TypeDefinition", variant: "TypeAliasDefinition", members: [] },
	{ node: "TypeDefinition", variant: "CustomTypeDefinition", members: [] },
	{ node: "TypeDefinition", variant: "IncompleteTypeDefinition", members: [] },

	// ----------------------------------------------------------------- Literal
	// Decision 0013 plus the seven literal kinds; WholeNumberLiteral is the
	// pre-decision spelling of IntegerLiteral, still read and never written, and
	// carries its own case label, so it is its own entry rather than an
	// IntegerLiteral member.
	{ node: "Literal", variant: "BoolLiteral", members: [] },
	{ node: "Literal", variant: "CharLiteral", members: [] },
	{ node: "Literal", variant: "StringLiteral", members: [] },
	{ node: "Literal", variant: "IntegerLiteral", members: [] },
	{ node: "Literal", variant: "WholeNumberLiteral", members: [] },
	{ node: "Literal", variant: "FloatLiteral", members: [] },
	{ node: "Literal", variant: "DecimalLiteral", members: [] },

	// ----------------------------------------------------------------- Pattern
	{ node: "Pattern", variant: "WildcardPattern", members: [] },
	{ node: "Pattern", variant: "AsPattern", members: [] },
	{ node: "Pattern", variant: "TuplePattern", members: [] },
	{ node: "Pattern", variant: "ConstructorPattern", members: [] },
	{ node: "Pattern", variant: "EmptyListPattern", members: [] },
	{ node: "Pattern", variant: "HeadTailPattern", members: [] },
	{ node: "Pattern", variant: "LiteralPattern", members: [] },
	{ node: "Pattern", variant: "UnitPattern", members: [] },

	// ------------------------------------------------------------------- Value
	{ node: "Value", variant: "Literal", members: [] },
	{ node: "Value", variant: "Constructor", members: [] },
	{ node: "Value", variant: "Tuple", members: [] },
	{ node: "Value", variant: "List", members: [] },
	{ node: "Value", variant: "Record", members: RECORD_MEMBERS },
	{ node: "Value", variant: "Variable", members: [] },
	{ node: "Value", variant: "Reference", members: [] },
	// Decision 0006: "subject"/"fieldName" window "target"/"name".
	{ node: "Value", variant: "Field", members: [canonical("target"), legacy("subject"), canonical("name"), legacy("fieldName")] },
	{ node: "Value", variant: "FieldFunction", members: [] },
	{ node: "Value", variant: "Apply", members: [] },
	{ node: "Value", variant: "Lambda", members: [] },
	// Decision 0006: "valueName"/"valueDefinition"/"inValue" window
	// "name"/"definition"/"in".
	{
		node: "Value",
		variant: "LetDefinition",
		members: [canonical("name"), legacy("valueName"), canonical("definition"), legacy("valueDefinition"), canonical("in"), legacy("inValue")],
	},
	{ node: "Value", variant: "LetRecursion", members: [] },
	{ node: "Value", variant: "Destructure", members: [] },
	// Decision 0006: "thenBranch"/"elseBranch" window "then"/"else".
	{ node: "Value", variant: "IfThenElse", members: [canonical("then"), legacy("thenBranch"), canonical("else"), legacy("elseBranch")] },
	{ node: "Value", variant: "PatternMatch", members: [] },
	{ node: "Value", variant: "UpdateRecord", members: [] },
	{ node: "Value", variant: "Unit", members: [] },
	{ node: "Value", variant: "Hole", members: [] },

	// -------------------------------------------------------- ValueDefinition
	// readValueDefinition checks DEFINITION_KEYS membership with if/else, not a
	// switch, so these four are not case labels the drift test's regex scan
	// can find; it asserts their presence as plain string literals in
	// read-values.ts by hand instead (NON_LABEL_VARIANTS). ExternalBody alone
	// has a legacy shape: the pre-decision-0008 top-level "externalName"/
	// "targetPlatform" pair, read as a one-entry "externals" list with a
	// warning (readExternals), not through windowed() either.
	{ node: "ValueDefinition", variant: "ExpressionBody", members: [] },
	{ node: "ValueDefinition", variant: "NativeBody", members: [] },
	{ node: "ValueDefinition", variant: "IncompleteBody", members: [] },
	{
		node: "ValueDefinition",
		variant: "ExternalBody",
		members: [canonical("externals"), legacy("externalName"), legacy("targetPlatform"), canonical("body")],
	},

	// ------------------------------------------- AccessControlledTypeDefinition
	// readAccess's case labels resolve to "Public"/"Private"; "pub" (and the
	// lowercase "public"/"private") are alternate access spellings, not
	// variants, so they are excluded from the drift scan rather than listed
	// here. readDocumented's nested { "doc", "value" } wrapper (decision 0006)
	// is the one other place a legacy shape is not read through windowed(); its
	// "value" member has no clean canonical counterpart name, because the
	// canonical spelling flattens the payload's own members beside "doc"
	// instead of nesting them, so it is listed as a bare legacy member here.
	{ node: "AccessControlledTypeDefinition", variant: "Public", members: [legacy("value")] },
	{ node: "AccessControlledTypeDefinition", variant: "Private", members: [legacy("value")] },

	// ------------------------------------------ AccessControlledValueDefinition
	// readAccessControlled is shared, so the value twin accepts exactly what the
	// type twin above does, including readDocumented's nested {doc,value}
	// wrapper. It is its own NodeKind, so the kit needs its own cases for it.
	{ node: "AccessControlledValueDefinition", variant: "Public", members: [legacy("value")] },
	{ node: "AccessControlledValueDefinition", variant: "Private", members: [legacy("value")] },

	// ------------------------------------------------------------------ IRFile
	// The three distribution kinds. read-distribution.ts recognizes them by
	// membership in DISTRIBUTION_KEYS (["Library", "Specs", "Application"]),
	// not through a `case "<Label>":` switch, so the drift test finds them
	// through NON_LABEL_VARIANTS rather than its label scan.
	//
	// The node is IRFile because that is the NodeKind a reader is asked for; the
	// kit spells the same node "Distribution" (NODE_ALIASES). Every member below
	// is canonical: this reader accepts no legacy spelling for any of them.
	// "dependencies", "def" and "spec" are optional and default to empty, and
	// "doc" is the optional documentation slot on an entry point.
	{ node: "IRFile", variant: "Library", members: [canonical("packageName"), canonical("dependencies"), canonical("def")] },
	{ node: "IRFile", variant: "Specs", members: [canonical("packageName"), canonical("dependencies"), canonical("spec")] },
	{
		node: "IRFile",
		variant: "Application",
		members: [canonical("packageName"), canonical("dependencies"), canonical("def"), canonical("entryPoints"), canonical("doc")],
	},

	// -------------------------------------------- the document tree's files
	// DistributionManifestFile, ModuleManifestFile, TypeDefinitionFile and
	// ValueDefinitionFile have no entries here on purpose. A file kind is a
	// wrapper, not a variant: its body is a definition or a specification the
	// entries above already cover, and its own members are a fixed record with
	// no alternative spellings inside decision 0006's window. read-tree-files.ts
	// matches its wire labels ("Library", "Public", …) with lookups rather than
	// `case "<Label>":` switches for the same reason, so it is not one of the
	// sources vocabulary.test.ts scans.
];
