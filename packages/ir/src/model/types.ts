// packages/ir/src/model/types.ts
//
// Type expressions, type specifications and type definitions, generic over
// the attribute type A. Wire member names live in the codec, not here.
import type { FQName, Name } from "./names.ts";
import type { Value } from "./values.ts";

export interface Field<A> { readonly name: Name; readonly type: Type<A> }

export type Type<A> =
	| { readonly kind: "Variable"; readonly attributes: A; readonly name: Name }
	| { readonly kind: "Reference"; readonly attributes: A; readonly fqname: FQName; readonly args: readonly Type<A>[] }
	| { readonly kind: "Tuple"; readonly attributes: A; readonly elements: readonly Type<A>[] }
	| { readonly kind: "Record"; readonly attributes: A; readonly fields: readonly Field<A>[] }
	| { readonly kind: "ExtensibleRecord"; readonly attributes: A; readonly variable: Name; readonly fields: readonly Field<A>[] }
	| { readonly kind: "Function"; readonly attributes: A; readonly argumentType: Type<A>; readonly returnType: Type<A> }
	| { readonly kind: "Unit"; readonly attributes: A };

export interface ConstructorArg<A> { readonly name: Name; readonly type: Type<A> }
export interface Constructor<A> { readonly name: Name; readonly args: readonly ConstructorArg<A>[] }

export type AnnotationArgument<TA, VA> =
	| { readonly kind: "Positional"; readonly value: Value<TA, VA> }
	| { readonly kind: "Named"; readonly name: Name; readonly value: Value<TA, VA> };
export type Annotation<TA, VA> =
	| { readonly kind: "Compact"; readonly name: FQName; readonly text: string | null }
	| { readonly kind: "Structured"; readonly name: FQName; readonly args: readonly AnnotationArgument<TA, VA>[] };

export type HoleReason =
	| { readonly kind: "UnresolvedReference"; readonly target: FQName }
	| { readonly kind: "DeletedDuringRefactor"; readonly txId: string }
	| { readonly kind: "TypeMismatch"; readonly expected: string; readonly found: string };

export type Incompleteness<A> =
	| { readonly kind: "Hole"; readonly reason: HoleReason; readonly partialBody: Type<A> | null }
	| { readonly kind: "Draft" };

export type TypeSpecification<TA, VA> =
	| { readonly kind: "TypeAliasSpecification"; readonly annotations: readonly Annotation<TA, VA>[]; readonly typeParams: readonly Name[]; readonly typeExp: Type<TA> }
	| { readonly kind: "OpaqueTypeSpecification"; readonly annotations: readonly Annotation<TA, VA>[]; readonly typeParams: readonly Name[] }
	| { readonly kind: "CustomTypeSpecification"; readonly annotations: readonly Annotation<TA, VA>[]; readonly typeParams: readonly Name[]; readonly constructors: readonly Constructor<TA>[] }
	| { readonly kind: "DerivedTypeSpecification"; readonly annotations: readonly Annotation<TA, VA>[]; readonly typeParams: readonly Name[]; readonly baseType: Type<TA>; readonly fromBaseType: FQName; readonly toBaseType: FQName };

export type Access = "Public" | "Private";

export type TypeDefinition<TA> =
	| { readonly kind: "TypeAliasDefinition"; readonly typeParams: readonly Name[]; readonly typeExp: Type<TA> }
	| { readonly kind: "CustomTypeDefinition"; readonly typeParams: readonly Name[]; readonly constructorsAccess: Access; readonly constructors: readonly Constructor<TA>[] }
	| { readonly kind: "IncompleteTypeDefinition"; readonly typeParams: readonly Name[]; readonly incompleteness: Incompleteness<TA>; readonly partialTypeExp: Type<TA> | null };
