// packages/ir/src/model/distribution.ts
//
// Packages, distributions, entry points and the format version.
import type { FQName, PackageName } from "./names.ts";
import type { AccessControlled, ModuleDefinition, ModuleSpecification, NamedModule } from "./modules.ts";

export interface PackageSpecification<TA, VA> { readonly modules: readonly NamedModule<ModuleSpecification<TA, VA>>[] }
export interface PackageDefinition<TA, VA> { readonly modules: readonly NamedModule<AccessControlled<ModuleDefinition<TA, VA>>>[] }

export interface NamedPackage<T> { readonly name: PackageName; readonly value: T }

export type EntryPointKind = "main" | "command" | "handler" | "job" | "policy";
export interface EntryPoint { readonly name: string; readonly target: FQName; readonly kind: EntryPointKind; readonly doc: string | null }

export type Distribution<TA, VA> =
	| { readonly kind: "Library"; readonly packageName: PackageName; readonly dependencies: readonly NamedPackage<PackageSpecification<TA, VA>>[]; readonly def: PackageDefinition<TA, VA> }
	| { readonly kind: "Specs"; readonly packageName: PackageName; readonly dependencies: readonly NamedPackage<PackageSpecification<TA, VA>>[]; readonly spec: PackageSpecification<TA, VA> }
	| { readonly kind: "Application"; readonly packageName: PackageName; readonly dependencies: readonly NamedPackage<PackageDefinition<TA, VA>>[]; readonly def: PackageDefinition<TA, VA>; readonly entryPoints: readonly EntryPoint[] };

/** An exact release, normalized per docs/spec/ir/format-version.md. */
export interface FormatVersion { readonly major: number; readonly minor: number; readonly patch: number }

export interface IRFile<TA, VA> { readonly formatVersion: FormatVersion; readonly distribution: Distribution<TA, VA> }
