// packages/ir/src/model/attributes.ts
//
// Attribute types the v4 profile defines, plus the opaque Json carried by
// v1 to v3 attributes. The model is generic over attributes (Type<A>,
// Value<TA, VA>); these are the concrete instantiations.
import type { Type } from "./types.ts";

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export interface SourceLocation {
	readonly startLine: number;
	readonly startColumn: number;
	readonly endLine: number;
	readonly endColumn: number;
}

export interface TypeAttributes {
	readonly source: SourceLocation | null;
	readonly constraints: { readonly [key: string]: Json };
	readonly extensions: { readonly [key: string]: Json };
}

export interface ValueAttributes<TA> {
	readonly source: SourceLocation | null;
	readonly inferredType: Type<TA> | null;
	readonly extensions: { readonly [key: string]: Json };
}

export const EMPTY_TYPE_ATTRIBUTES: TypeAttributes = { source: null, constraints: {}, extensions: {} };
export function emptyValueAttributes<TA>(): ValueAttributes<TA> {
	return { source: null, inferredType: null, extensions: {} };
}
