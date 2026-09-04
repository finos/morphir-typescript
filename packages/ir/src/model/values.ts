// packages/ir/src/model/values.ts
//
// Literals, patterns, value expressions, value specifications and value
// definitions, generic over type attributes TA and value attributes VA.
import type { FQName, Name } from "./names.ts";
import type { Annotation, HoleReason, Incompleteness, Type } from "./types.ts";

export type Literal =
	| { readonly kind: "BoolLiteral"; readonly value: boolean }
	| { readonly kind: "CharLiteral"; readonly value: string }
	| { readonly kind: "StringLiteral"; readonly value: string }
	| { readonly kind: "IntegerLiteral"; readonly value: bigint }
	| { readonly kind: "FloatLiteral"; readonly value: number }
	| { readonly kind: "DecimalLiteral"; readonly value: string };

export type Pattern<VA> =
	| { readonly kind: "WildcardPattern"; readonly attributes: VA }
	| { readonly kind: "AsPattern"; readonly attributes: VA; readonly pattern: Pattern<VA>; readonly name: Name }
	| { readonly kind: "TuplePattern"; readonly attributes: VA; readonly patterns: readonly Pattern<VA>[] }
	| { readonly kind: "ConstructorPattern"; readonly attributes: VA; readonly fqname: FQName; readonly patterns: readonly Pattern<VA>[] }
	| { readonly kind: "EmptyListPattern"; readonly attributes: VA }
	| { readonly kind: "HeadTailPattern"; readonly attributes: VA; readonly head: Pattern<VA>; readonly tail: Pattern<VA> }
	| { readonly kind: "LiteralPattern"; readonly attributes: VA; readonly literal: Literal }
	| { readonly kind: "UnitPattern"; readonly attributes: VA };

export interface RecordField<TA, VA> { readonly name: Name; readonly value: Value<TA, VA> }
export interface PatternCase<TA, VA> { readonly pattern: Pattern<VA>; readonly body: Value<TA, VA> }
export interface LetBinding<TA, VA> { readonly name: Name; readonly definition: ValueDefinition<TA, VA> }

export type NativeHint =
	| { readonly kind: "Arithmetic" } | { readonly kind: "Comparison" } | { readonly kind: "StringOp" }
	| { readonly kind: "CollectionOp" } | { readonly kind: "PlatformSpecific"; readonly platform: string };
export interface NativeInfo { readonly hint: NativeHint; readonly description: string | null }

export type Value<TA, VA> =
	| { readonly kind: "Literal"; readonly attributes: VA; readonly literal: Literal }
	| { readonly kind: "Constructor"; readonly attributes: VA; readonly fqname: FQName }
	| { readonly kind: "Tuple"; readonly attributes: VA; readonly elements: readonly Value<TA, VA>[] }
	| { readonly kind: "List"; readonly attributes: VA; readonly items: readonly Value<TA, VA>[] }
	| { readonly kind: "Record"; readonly attributes: VA; readonly fields: readonly RecordField<TA, VA>[] }
	| { readonly kind: "Variable"; readonly attributes: VA; readonly name: Name }
	| { readonly kind: "Reference"; readonly attributes: VA; readonly fqname: FQName }
	| { readonly kind: "Field"; readonly attributes: VA; readonly target: Value<TA, VA>; readonly name: Name }
	| { readonly kind: "FieldFunction"; readonly attributes: VA; readonly name: Name }
	| { readonly kind: "Apply"; readonly attributes: VA; readonly function: Value<TA, VA>; readonly argument: Value<TA, VA> }
	| { readonly kind: "Lambda"; readonly attributes: VA; readonly pattern: Pattern<VA>; readonly body: Value<TA, VA> }
	| { readonly kind: "LetDefinition"; readonly attributes: VA; readonly name: Name; readonly definition: ValueDefinition<TA, VA>; readonly in: Value<TA, VA> }
	| { readonly kind: "LetRecursion"; readonly attributes: VA; readonly definitions: readonly LetBinding<TA, VA>[]; readonly in: Value<TA, VA> }
	| { readonly kind: "Destructure"; readonly attributes: VA; readonly pattern: Pattern<VA>; readonly value: Value<TA, VA>; readonly in: Value<TA, VA> }
	| { readonly kind: "IfThenElse"; readonly attributes: VA; readonly condition: Value<TA, VA>; readonly then: Value<TA, VA>; readonly else: Value<TA, VA> }
	| { readonly kind: "PatternMatch"; readonly attributes: VA; readonly value: Value<TA, VA>; readonly cases: readonly PatternCase<TA, VA>[] }
	| { readonly kind: "UpdateRecord"; readonly attributes: VA; readonly target: Value<TA, VA>; readonly fields: readonly RecordField<TA, VA>[] }
	| { readonly kind: "Unit"; readonly attributes: VA }
	| { readonly kind: "Hole"; readonly attributes: VA; readonly reason: HoleReason; readonly expectedType: Type<TA> | null }
	| { readonly kind: "Native"; readonly attributes: VA; readonly fqname: FQName; readonly nativeInfo: NativeInfo }
	| { readonly kind: "External"; readonly attributes: VA; readonly externalName: string; readonly targetPlatform: string };

export interface InputType<TA> { readonly name: Name; readonly type: Type<TA> }

export interface ValueSpecification<TA, VA> {
	readonly annotations: readonly Annotation<TA, VA>[];
	readonly inputs: readonly InputType<TA>[];
	readonly output: Type<TA>;
}

export type ValueDefinition<TA, VA> =
	| { readonly kind: "ExpressionBody"; readonly inputTypes: readonly InputType<TA>[]; readonly outputType: Type<TA>; readonly body: Value<TA, VA> }
	| { readonly kind: "NativeBody"; readonly inputTypes: readonly InputType<TA>[]; readonly outputType: Type<TA>; readonly nativeInfo: NativeInfo }
	| { readonly kind: "ExternalBody"; readonly inputTypes: readonly InputType<TA>[]; readonly outputType: Type<TA>; readonly externalName: string; readonly targetPlatform: string }
	| { readonly kind: "IncompleteBody"; readonly inputTypes: readonly InputType<TA>[]; readonly outputType: Type<TA> | null; readonly incompleteness: Incompleteness<TA>; readonly partialBody: Value<TA, VA> | null };
