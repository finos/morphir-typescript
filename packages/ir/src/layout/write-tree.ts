// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Writing a document tree (document-tree page,
// docs/spec/ir/schemas/v4/document-tree-files.md in finos/morphir): a distribution becomes a map of logical
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
import type { FormatVersion, IRFile } from "../model/distribution.ts";
import type { Access, AccessControlled, ModuleDefinition, ModuleSpecification, Named, NamedModule } from "../model/modules.ts";
import type { ModuleName, PackageName } from "../model/names.ts";
import { err, ok, type Result } from "../model/result.ts";
import type { DistributionManifestFile, ModuleManifestFile, TypeFileBody, ValueFileBody } from "../model/tree-files.ts";
import type { TA, VA } from "../versions/v4/attributes.ts";
import { writeDistributionManifestFile, writeModuleManifestFile, writeTypeDefinitionFile, writeValueDefinitionFile } from "../versions/v4/write-tree-files.ts";
import { type LogicalPath, MANIFEST, moduleDir, moduleDirPrefix, moduleManifestPath, nodeFilePath } from "./paths.ts";
import type { DocumentTree } from "./read-tree.ts";
import { stemFor } from "./stems.ts";

/** How a distribution is laid out: which profile spells it, and how long a path may be. */
export interface TreePolicy {
	readonly profile: ProfileCodec;
	readonly pathBudget: number;
}

/** One entry of a module, paired with the file stem the budget gave it. */
interface Stem<T> {
	readonly item: Named<T>;
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
function stemsFor<T>(
	items: readonly Named<T>[],
	root: "pkg" | "deps",
	dir: string,
	kind: "type" | "value",
	policy: TreePolicy,
): Result<readonly Stem<T>[], Diagnostic> {
	const prefix = moduleDirPrefix(root, dir);
	const suffix = `.${kind}${policy.profile.extension}`;
	const seen = new Set<string>();
	const out: Stem<T>[] = [];
	for (const item of items) {
		const r = stemFor(item.name, prefix, suffix, policy.pathBudget);
		if (!r.ok) return r;
		if (seen.has(r.value.stem)) {
			const at = `${prefix}${r.value.stem}${suffix}`;
			return err(diagnostic("invalid_distribution_shape", "semantic", at, `two ${kind} names share the file stem "${r.value.stem}"`));
		}
		seen.add(r.value.stem);
		out.push({ item, stem: r.value.stem, truncated: r.value.truncated });
	}
	return ok(out);
}

// The module directory has to fit before anything inside it can: `module` is
// the shortest leaf a module has, so if that is already over the budget no
// choice of stem can rescue the module.
function fits(root: "pkg" | "deps", dir: string, policy: TreePolicy): Result<null, Diagnostic> {
	const physical = `${moduleManifestPath(root, dir)}${policy.profile.extension}`;
	return physical.length > policy.pathBudget ? budgetError(physical, policy.pathBudget) : ok(null);
}

// The manifest is written after the stems are known, because `fileNames` is
// exactly the list of names the budget had to cut.
function writeModuleManifest<T, V>(
	w: Writer,
	root: "pkg" | "deps",
	dir: string,
	name: ModuleName,
	access: Access,
	doc: string | null,
	types: readonly Stem<T>[],
	values: readonly Stem<V>[],
): void {
	const truncated = [...types, ...values].filter((s) => s.truncated).map((s) => [s.item.name, s.stem] as const);
	const manifest: ModuleManifestFile<TA, VA> = {
		formatVersion: w.formatVersion,
		path: name,
		access,
		doc,
		types: { style: "names", names: types.map((s) => s.item.name) },
		values: { style: "names", names: values.map((s) => s.item.name) },
		fileNames: truncated,
	};
	w.out.set(moduleManifestPath(root, dir), w.policy.profile.write(writeModuleManifestFile(manifest)));
}

function writeTypeFile<T>(w: Writer, root: "pkg" | "deps", dir: string, s: Stem<T>, body: TypeFileBody<TA, VA>): void {
	const file = writeTypeDefinitionFile({ formatVersion: w.formatVersion, name: s.item.name, body });
	w.out.set(nodeFilePath(root, dir, s.stem, "type"), w.policy.profile.write(file));
}

function writeValueFile<T>(w: Writer, root: "pkg" | "deps", dir: string, s: Stem<T>, body: ValueFileBody<TA, VA>): void {
	const file = writeValueDefinitionFile({ formatVersion: w.formatVersion, name: s.item.name, body });
	w.out.set(nodeFilePath(root, dir, s.stem, "value"), w.policy.profile.write(file));
}

function writeDefinitionPackage(
	w: Writer,
	root: "pkg" | "deps",
	pkg: PackageName,
	modules: readonly NamedModule<AccessControlled<ModuleDefinition<TA, VA>>>[],
): Result<null, Diagnostic> {
	for (const m of modules) {
		const dir = moduleDir(root, pkg, m.name);
		const room = fits(root, dir, w.policy);
		if (!room.ok) return room;
		const def = m.value.value;
		const types = stemsFor(def.types, root, dir, "type", w.policy);
		if (!types.ok) return types;
		const values = stemsFor(def.values, root, dir, "value", w.policy);
		if (!values.ok) return values;
		writeModuleManifest(w, root, dir, m.name, m.value.access, def.doc, types.value, values.value);
		for (const s of types.value) writeTypeFile(w, root, dir, s, { kind: "def", value: s.item.value });
		for (const s of values.value) writeValueFile(w, root, dir, s, { kind: "def", value: s.item.value });
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
		// carries any cannot be written as a tree at all (document-tree page,
		// "Module order and annotations").
		if (m.value.annotations.length > 0) {
			return err(
				diagnostic("invalid_distribution_shape", "semantic", moduleManifestPath(root, dir), "module annotations cannot be written to a document tree"),
			);
		}
		const room = fits(root, dir, w.policy);
		if (!room.ok) return room;
		const spec = m.value;
		const types = stemsFor(spec.types, root, dir, "type", w.policy);
		if (!types.ok) return types;
		const values = stemsFor(spec.values, root, dir, "value", w.policy);
		if (!values.ok) return values;
		// A module specification has no access of its own: what a specification
		// publishes is public by construction.
		writeModuleManifest(w, root, dir, m.name, "Public", spec.doc, types.value, values.value);
		for (const s of types.value) writeTypeFile(w, root, dir, s, { kind: "spec", value: s.item.value });
		for (const s of values.value) writeValueFile(w, root, dir, s, { kind: "spec", value: s.item.value });
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
	// definitions there and package specifications everywhere else (document-tree
	// page, "Dependencies").
	if (d.kind === "Application") {
		for (const dep of d.dependencies) {
			const r = writeDefinitionPackage(w, "deps", dep.name, dep.value.modules);
			if (!r.ok) return r;
		}
	} else {
		for (const dep of d.dependencies) {
			const r = writeSpecificationPackage(w, "deps", dep.name, dep.value.modules);
			if (!r.ok) return r;
		}
	}

	return ok(w.out);
}
