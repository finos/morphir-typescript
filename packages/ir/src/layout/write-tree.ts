// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Writing a document tree (S7.3): a distribution becomes a map of logical
// paths to text. Pure — nothing here touches a filesystem, and the profile is
// the only thing that decides what the text looks like.
//
// The canonical layout is the manifest style: one definition per file, the
// module manifest listing names rather than inlining them, and `fileNames`
// present only for the names the path budget had to cut. The map's insertion
// order is the order the spec gives: the distribution manifest, then each
// module's own manifest followed by its types and then its values, the own
// package before the dependencies.
//
// The budget is the reason writing a tree can fail at all. A path is measured
// physically, extension included, from the distribution root; when a stem
// cannot be cut small enough, or when the module directory alone is already
// over, there is no tree to write, and saying so is better than writing one
// that cannot be read back.
import type { ProfileCodec } from "../codec/profile.ts";
import { type Diagnostic, diagnostic } from "../model/diagnostic.ts";
import type { FormatVersion, IRFile, NamedPackage, PackageDefinition, PackageSpecification } from "../model/distribution.ts";
import type { Access, AccessControlled, Documented, ModuleDefinition, ModuleSpecification, Named, NamedModule } from "../model/modules.ts";
import { type ModuleName, type Name, type PackageName, Path } from "../model/names.ts";
import { err, ok, type Result } from "../model/result.ts";
import type { DistributionManifestFile, ModuleManifestFile, TypeFileBody, ValueFileBody } from "../model/tree-files.ts";
import type { TypeDefinition, TypeSpecification } from "../model/types.ts";
import type { ValueDefinition, ValueSpecification } from "../model/values.ts";
import type { TA, VA } from "../versions/v4/attributes.ts";
import { writeDistributionManifestFile, writeModuleManifestFile, writeTypeDefinitionFile, writeValueDefinitionFile } from "../versions/v4/write-tree-files.ts";
import { type LogicalPath, MANIFEST } from "./paths.ts";
import type { DocumentTree } from "./read-tree.ts";
import { stemFor } from "./stems.ts";

/** How a distribution is laid out: which profile spells it, and how long a path may be. */
export interface TreePolicy {
	readonly profile: ProfileCodec;
	readonly pathBudget: number;
}

type TypeDef = AccessControlled<Documented<TypeDefinition<TA>>>;
type ValueDef = AccessControlled<Documented<ValueDefinition<TA, VA>>>;
type TypeSpec = Documented<TypeSpecification<TA, VA>>;
type ValueSpec = Documented<ValueSpecification<TA, VA>>;

interface Stem {
	readonly name: Name;
	readonly stem: string;
	readonly truncated: boolean;
}

interface Writer {
	readonly out: Map<LogicalPath, string>;
	readonly policy: TreePolicy;
	readonly formatVersion: FormatVersion;
}

function budgetError(physical: string, pathBudget: number): Result<never, Diagnostic> {
	return err(diagnostic("invalid_distribution_shape", "semantic", physical, `path budget ${pathBudget} cannot fit ${physical}`));
}

// The stems of one kind inside one module, in listing order. Escaping is
// injective, so two untruncated stems never collide; two truncated ones can,
// and silently overwriting one file with another is the one outcome worth
// refusing.
function stemsFor(items: readonly Named<unknown>[], dir: string, kind: "type" | "value", policy: TreePolicy): Result<readonly Stem[], Diagnostic> {
	const prefix = `${dir}/`;
	const suffix = `.${kind}${policy.profile.extension}`;
	const seen = new Set<string>();
	const out: Stem[] = [];
	for (const item of items) {
		const r = stemFor(item.name, prefix, suffix, policy.pathBudget);
		if (!r.ok) return r;
		if (seen.has(r.value.stem)) {
			const at = `${prefix}${r.value.stem}${suffix}`;
			return err(diagnostic("invalid_distribution_shape", "semantic", at, `two ${kind} names share the file stem "${r.value.stem}"`));
		}
		seen.add(r.value.stem);
		out.push({ name: item.name, stem: r.value.stem, truncated: r.value.truncated });
	}
	return ok(out);
}

/** The escaped directory one module's files live in, under `pkg/` or `deps/`. */
function moduleDir(root: "pkg" | "deps", pkg: PackageName, name: ModuleName): string {
	return `${root}/${Path.escaped(pkg.path)}/${Path.escaped(name.path)}`;
}

// The module directory has to fit before anything inside it can: `module` is
// the shortest leaf a module has, so if that is already over the budget no
// choice of stem can rescue the module.
function fits(dir: string, policy: TreePolicy): Result<null, Diagnostic> {
	const physical = `${dir}/module${policy.profile.extension}`;
	return physical.length > policy.pathBudget ? budgetError(physical, policy.pathBudget) : ok(null);
}

// The manifest is written after the stems are known, because `fileNames` is
// exactly the list of names the budget had to cut.
function writeModuleManifest(
	w: Writer,
	dir: string,
	name: ModuleName,
	access: Access,
	doc: string | null,
	types: readonly Stem[],
	values: readonly Stem[],
): void {
	const truncated = [...types, ...values].filter((s) => s.truncated).map((s) => [s.name, s.stem] as const);
	const manifest: ModuleManifestFile<TA, VA> = {
		formatVersion: w.formatVersion,
		path: name,
		access,
		doc,
		types: { style: "names", names: types.map((s) => s.name) },
		values: { style: "names", names: values.map((s) => s.name) },
		fileNames: truncated,
	};
	w.out.set(`${dir}/module`, w.policy.profile.write(writeModuleManifestFile(manifest)));
}

function writeTypeFile(w: Writer, dir: string, stem: Stem, body: TypeFileBody<TA, VA>): void {
	w.out.set(`${dir}/${stem.stem}.type`, w.policy.profile.write(writeTypeDefinitionFile({ formatVersion: w.formatVersion, name: stem.name, body })));
}

function writeValueFile(w: Writer, dir: string, stem: Stem, body: ValueFileBody<TA, VA>): void {
	w.out.set(`${dir}/${stem.stem}.value`, w.policy.profile.write(writeValueDefinitionFile({ formatVersion: w.formatVersion, name: stem.name, body })));
}

function writeDefinitionPackage(
	w: Writer,
	root: "pkg" | "deps",
	pkg: PackageName,
	modules: readonly NamedModule<AccessControlled<ModuleDefinition<TA, VA>>>[],
): Result<null, Diagnostic> {
	for (const m of modules) {
		const dir = moduleDir(root, pkg, m.name);
		const room = fits(dir, w.policy);
		if (!room.ok) return room;
		const def = m.value.value;
		const types = stemsFor(def.types, dir, "type", w.policy);
		if (!types.ok) return types;
		const values = stemsFor(def.values, dir, "value", w.policy);
		if (!values.ok) return values;
		writeModuleManifest(w, dir, m.name, m.value.access, def.doc, types.value, values.value);
		for (const [i, stem] of types.value.entries()) writeTypeFile(w, dir, stem, { kind: "def", value: (def.types[i] as Named<TypeDef>).value });
		for (const [i, stem] of values.value.entries()) writeValueFile(w, dir, stem, { kind: "def", value: (def.values[i] as Named<ValueDef>).value });
	}
	return ok(null);
}

function writeSpecificationPackage(
	w: Writer,
	root: "pkg" | "deps",
	pkg: PackageName,
	modules: readonly NamedModule<ModuleSpecification<TA, VA>>[],
): Result<null, Diagnostic> {
	for (const m of modules) {
		const dir = moduleDir(root, pkg, m.name);
		// A module manifest has no place for annotations, so a specification that
		// carries any cannot be written as a tree at all (ruling S7.3a).
		if (m.value.annotations.length > 0) {
			return err(diagnostic("invalid_distribution_shape", "semantic", `${dir}/module`, "module annotations cannot be written to a document tree"));
		}
		const room = fits(dir, w.policy);
		if (!room.ok) return room;
		const spec = m.value;
		const types = stemsFor(spec.types, dir, "type", w.policy);
		if (!types.ok) return types;
		const values = stemsFor(spec.values, dir, "value", w.policy);
		if (!values.ok) return values;
		// A module specification has no access of its own: what a specification
		// publishes is public by construction.
		writeModuleManifest(w, dir, m.name, "Public", spec.doc, types.value, values.value);
		for (const [i, stem] of types.value.entries()) writeTypeFile(w, dir, stem, { kind: "spec", value: (spec.types[i] as Named<TypeSpec>).value });
		for (const [i, stem] of values.value.entries()) writeValueFile(w, dir, stem, { kind: "spec", value: (spec.values[i] as Named<ValueSpec>).value });
	}
	return ok(null);
}

/**
 * Lays a distribution out as a document tree under `policy`. Fails with
 * `invalid_distribution_shape` when the path budget cannot hold the tree, or
 * when a module specification carries annotations a tree has nowhere to put.
 */
export function writeTree(file: IRFile<TA, VA>, policy: TreePolicy): Result<DocumentTree, Diagnostic> {
	const d = file.distribution;
	const w: Writer = { out: new Map<LogicalPath, string>(), policy, formatVersion: file.formatVersion };

	const manifest: DistributionManifestFile = {
		formatVersion: file.formatVersion,
		distribution: d.kind,
		packageName: d.packageName,
		pathBudget: policy.pathBudget,
		dependencies: d.dependencies.map((x) => x.name),
		entryPoints: d.kind === "Application" ? d.entryPoints : [],
	};
	w.out.set(MANIFEST, policy.profile.write(writeDistributionManifestFile(manifest)));

	const own =
		d.kind === "Specs" ? writeSpecificationPackage(w, "pkg", d.packageName, d.spec.modules) : writeDefinitionPackage(w, "pkg", d.packageName, d.def.modules);
	if (!own.ok) return own;

	// An application links its dependencies statically, so `deps/` holds package
	// definitions there and package specifications everywhere else (S7.3a).
	if (d.kind === "Application") {
		for (const dep of d.dependencies satisfies readonly NamedPackage<PackageDefinition<TA, VA>>[]) {
			const r = writeDefinitionPackage(w, "deps", dep.name, dep.value.modules);
			if (!r.ok) return r;
		}
	} else {
		for (const dep of d.dependencies satisfies readonly NamedPackage<PackageSpecification<TA, VA>>[]) {
			const r = writeSpecificationPackage(w, "deps", dep.name, dep.value.modules);
			if (!r.ok) return r;
		}
	}

	return ok(w.out);
}
