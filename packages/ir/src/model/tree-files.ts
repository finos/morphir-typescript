// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The document tree's four file kinds, generic over the attribute types.
//
// A distribution can be written as one document or spread over a tree of
// files. The tree's files are not new semantics: each one is a slice of the
// same distribution with the format version repeated at its root, so a reader
// can open any single file on its own. These types are those slices, and
// nothing here knows about paths, extensions or profiles — the layout decides
// those at the physical boundary.
import type { EntryPoint, FormatVersion } from "./distribution.ts";
import type { AccessControlled, Documented, Named } from "./modules.ts";
import type { ModuleName, Name, PackageName } from "./names.ts";
import type { Access, TypeDefinition, TypeSpecification } from "./types.ts";
import type { ValueDefinition, ValueSpecification } from "./values.ts";

/** The distribution kind a manifest names. The same three the wrapper object has. */
export type DistributionKindName = "Library" | "Specs" | "Application";

/**
 * The tree's root file. `pathBudget` is required (decision 0001); dependencies
 * live under `deps/<pkg path>/…` and are listed here by name, with no version
 * segment (ruling S7.3a).
 */
export interface DistributionManifestFile {
	readonly formatVersion: FormatVersion;
	readonly distribution: DistributionKindName;
	readonly packageName: PackageName;
	readonly pathBudget: number;
	readonly dependencies: readonly PackageName[];
	/** Empty unless the distribution is an Application. */
	readonly entryPoints: readonly EntryPoint[];
}

/**
 * How a module manifest lists its types or its values. A tree that keeps each
 * entry in its own node file lists only the names; a tree that inlines them
 * carries the definitions or the specifications, never both.
 */
export type ModuleEntries<TDef, TSpec> =
	| { readonly style: "names"; readonly names: readonly Name[] }
	| { readonly style: "definitions"; readonly items: readonly Named<TDef>[] }
	| { readonly style: "specifications"; readonly items: readonly Named<TSpec>[] };

export interface ModuleManifestFile<TA, VA> {
	readonly formatVersion: FormatVersion;
	readonly path: ModuleName;
	/** "Public" when the file does not say (ruling S7.3a). */
	readonly access: Access;
	readonly doc: string | null;
	readonly types: ModuleEntries<AccessControlled<Documented<TypeDefinition<TA>>>, Documented<TypeSpecification<TA, VA>>>;
	readonly values: ModuleEntries<AccessControlled<Documented<ValueDefinition<TA, VA>>>, Documented<ValueSpecification<TA, VA>>>;
	/** Canonical name to escaped stem, for the names the path budget truncated. */
	readonly fileNames: readonly (readonly [Name, string])[];
}

export type TypeFileBody<TA, VA> =
	| { readonly kind: "def"; readonly value: AccessControlled<Documented<TypeDefinition<TA>>> }
	| { readonly kind: "spec"; readonly value: Documented<TypeSpecification<TA, VA>> };

export type ValueFileBody<TA, VA> =
	| { readonly kind: "def"; readonly value: AccessControlled<Documented<ValueDefinition<TA, VA>>> }
	| { readonly kind: "spec"; readonly value: Documented<ValueSpecification<TA, VA>> };

export interface TypeDefinitionFile<TA, VA> {
	readonly formatVersion: FormatVersion;
	readonly name: Name;
	readonly body: TypeFileBody<TA, VA>;
}

export interface ValueDefinitionFile<TA, VA> {
	readonly formatVersion: FormatVersion;
	readonly name: Name;
	readonly body: ValueFileBody<TA, VA>;
}
