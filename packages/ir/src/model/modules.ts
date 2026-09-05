// packages/ir/src/model/modules.ts
//
// Access control, documentation, and module specifications and definitions.
import type { ModuleName, Name } from "./names.ts";
import type { Access, Annotation, TypeDefinition, TypeSpecification } from "./types.ts";
import type { ValueDefinition, ValueSpecification } from "./values.ts";

export type { Access };

export interface AccessControlled<T> { readonly access: Access; readonly value: T }
export interface Documented<T> { readonly doc: string | null; readonly value: T }

export interface Named<T> { readonly name: Name; readonly value: T }
export interface NamedModule<T> { readonly name: ModuleName; readonly value: T }

export interface ModuleSpecification<TA, VA> {
	readonly annotations: readonly Annotation<TA, VA>[];
	readonly doc: string | null;
	readonly types: readonly Named<Documented<TypeSpecification<TA, VA>>>[];
	readonly values: readonly Named<Documented<ValueSpecification<TA, VA>>>[];
}

export interface ModuleDefinition<TA, VA> {
	readonly doc: string | null;
	readonly types: readonly Named<AccessControlled<Documented<TypeDefinition<TA>>>>[];
	readonly values: readonly Named<AccessControlled<Documented<ValueDefinition<TA, VA>>>>[];
}
