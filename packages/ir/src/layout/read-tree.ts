// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Reading a document tree (S7.2): a map of logical paths to text becomes the
// same IRFile the equivalent single document would have produced.
//
// A tree is a distribution taken apart, so reading one is putting it back
// together: the root manifest says which kind it is and which packages live
// under `deps/`, each `…/module` file says what its directory holds, and each
// node file is one type or one value. Nothing here parses anything itself —
// the profile turns text into the same JsonValue tree both profiles produce,
// and the v4 tree-file readers turn that into the model. What this module adds
// is the part a single document does not have: which file a name is in, which
// package a directory belongs to, and the fact that every file under `pkg/`
// and `deps/` must be claimed by exactly one module.
//
// A directory carries no order, so modules are assembled in logical-path
// order. That is the one thing a tree does not preserve: a distribution whose
// modules were written in some other order comes back sorted.
import { type Ctx, newRoot } from "../codec/json/cursor.ts";
import type { JsonValue } from "../codec/json/value.ts";
import type { ProfileCodec } from "../codec/profile.ts";
import { type Diagnostic, diagnostic } from "../model/diagnostic.ts";
import type { Distribution, IRFile, NamedPackage, PackageDefinition, PackageSpecification } from "../model/distribution.ts";
import type { AccessControlled, Documented, ModuleDefinition, ModuleSpecification, Named, NamedModule } from "../model/modules.ts";
import { Name, type PackageName, Path } from "../model/names.ts";
import { err, ok, type Result } from "../model/result.ts";
import type { DistributionManifestFile, ModuleEntries, ModuleManifestFile, TypeDefinitionFile, ValueDefinitionFile } from "../model/tree-files.ts";
import type { TypeDefinition, TypeSpecification } from "../model/types.ts";
import type { ValueDefinition, ValueSpecification } from "../model/values.ts";
import type { TA, VA } from "../versions/v4/attributes.ts";
import type { Checked } from "../versions/v4/index.ts";
import { readDistributionManifestFile, readModuleManifestFile, readTypeDefinitionFile, readValueDefinitionFile } from "../versions/v4/read-tree-files.ts";
import { classify, type LogicalPath, MANIFEST } from "./paths.ts";

/** A distribution spread over files, keyed by logical path (no extension). */
export type DocumentTree = ReadonlyMap<LogicalPath, string>;

type TypeDef = AccessControlled<Documented<TypeDefinition<TA>>>;
type ValueDef = AccessControlled<Documented<ValueDefinition<TA, VA>>>;
type TypeSpec = Documented<TypeSpecification<TA, VA>>;
type ValueSpec = Documented<ValueSpecification<TA, VA>>;
type Manifest = ModuleManifestFile<TA, VA>;
type Load<T> = (name: Name, stem: string) => Result<T, Diagnostic>;

// A diagnostic about the tree itself rather than about the inside of one file:
// the cursor is the logical path, with the file's own pointer after "#".
function shape(path: LogicalPath, pointer: string, message: string): Result<never, Diagnostic> {
	return err(diagnostic("invalid_distribution_shape", "semantic", `${path}#${pointer}`, message));
}

// A file's own diagnostic, re-cursored onto the path it came from. The code,
// stage and location stay the file reader's; only the cursor grows a prefix.
function recursor(path: LogicalPath, d: Diagnostic): Diagnostic {
	const location = d.line === null || d.column === null ? undefined : { line: d.line, column: d.column };
	return diagnostic(d.code, d.stage, `${path}#${d.cursor || "/"}`, d.message, location);
}

interface PackageRoot {
	readonly root: "pkg" | "deps";
	readonly name: PackageName;
	/** The escaped package path the directories under `root` start with. */
	readonly prefix: string;
}

// The own package first, then the dependencies in the order the manifest listed
// them: a directory tree does not order its dependencies, the manifest does.
function packageRoots(manifest: DistributionManifestFile): readonly PackageRoot[] {
	return [
		{ root: "pkg", name: manifest.packageName, prefix: Path.escaped(manifest.packageName.path) },
		...manifest.dependencies.map((name) => ({ root: "deps" as const, name, prefix: Path.escaped(name.path) })),
	];
}

// Which package a directory belongs to: the longest listed prefix under the
// same root, so a dependency named `a/b` wins over one named `a` for `a/b/…`.
function owner(packages: readonly PackageRoot[], root: "pkg" | "deps", dir: string): PackageRoot | null {
	let best: PackageRoot | null = null;
	for (const p of packages) {
		if (p.root !== root || !dir.startsWith(`${p.prefix}/`)) continue;
		if (best === null || p.prefix.length > best.prefix.length) best = p;
	}
	return best;
}

// The module directories of one package, in logical-path order. A directory is
// a module exactly when it holds a `module` file; a directory of node files
// without one is left unclaimed and reported as such.
function moduleDirs(files: DocumentTree, packages: readonly PackageRoot[], p: PackageRoot): readonly string[] {
	const dirs: string[] = [];
	for (const path of files.keys()) {
		const c = classify(path);
		if (c.kind !== "module" || owner(packages, c.root, c.dir) !== p) continue;
		dirs.push(c.dir);
	}
	return dirs.sort();
}

// The stem a name's file is under: the one the manifest recorded for a name the
// path budget truncated, the escaped name otherwise.
function stemOf(m: Manifest, name: Name): string {
	const canonical = Name.canonical(name);
	for (const [listed, stem] of m.fileNames) {
		if (Name.canonical(listed) === canonical) return stem;
	}
	return Name.fileStem(name);
}

// A names-style listing is read file by file; the inline styles are already the
// entries themselves. Which inline style a manifest was read in was decided by
// the distribution kind, so the other one here means the tree disagrees with
// what its own manifest says it holds.
function listed<TDef, TSpec>(
	manifestPath: LogicalPath,
	entries: ModuleEntries<TDef, TSpec>,
	m: Manifest,
	load: Load<TDef>,
): Result<readonly Named<TDef>[], Diagnostic> {
	if (entries.style === "definitions") return ok(entries.items);
	if (entries.style === "specifications") return shape(manifestPath, "/", "expected a definition file");
	return eachName(entries.names, m, load);
}

function listedSpecs<TDef, TSpec>(
	manifestPath: LogicalPath,
	entries: ModuleEntries<TDef, TSpec>,
	m: Manifest,
	load: Load<TSpec>,
): Result<readonly Named<TSpec>[], Diagnostic> {
	if (entries.style === "specifications") return ok(entries.items);
	if (entries.style === "definitions") return shape(manifestPath, "/", "expected a specification file");
	return eachName(entries.names, m, load);
}

function eachName<T>(names: readonly Name[], m: Manifest, load: Load<T>): Result<readonly Named<T>[], Diagnostic> {
	const out: Named<T>[] = [];
	for (const name of names) {
		const value = load(name, stemOf(m, name));
		if (!value.ok) return value;
		out.push({ name, value: value.value });
	}
	return ok(out);
}

/**
 * Reads a document tree into the IRFile the equivalent single document would
 * have produced. Every diagnostic carries `<logical path>#<json pointer>`, so
 * a failure names the file it is about as well as the place inside it.
 */
export function readTree(files: DocumentTree, profile: ProfileCodec, ctx: Ctx = newRoot()): Result<Checked<IRFile<TA, VA>>, Diagnostic> {
	// Warnings are collected with the path they came from and sorted at the end,
	// so what a caller sees does not depend on the order the map iterates in.
	const warnings: { readonly path: LogicalPath; readonly diagnostic: Diagnostic }[] = [];
	const consumed = new Set<LogicalPath>();

	function readFile<T>(path: LogicalPath, read: (v: JsonValue, c: Ctx) => Result<T, Diagnostic>): Result<T, Diagnostic> {
		const text = files.get(path);
		if (text === undefined) return err(diagnostic("missing_member", "semantic", path, `missing file "${path}"`));
		const parsed = profile.parse(text);
		consumed.add(path);
		if (!parsed.ok) return err(recursor(path, parsed.error));
		const fileCtx = newRoot();
		const r = read(parsed.value, fileCtx);
		for (const w of fileCtx.warnings) warnings.push({ path, diagnostic: recursor(path, w) });
		return r.ok ? r : err(recursor(path, r.error));
	}

	// The file one listed name lives in, checked against the name that pointed
	// at it. A manifest that lists a name with no file, or a file whose own name
	// is not the one that found it, would silently rename a definition.
	function nodeFile<T extends { readonly name: Name }>(
		dir: string,
		manifestPath: LogicalPath,
		kind: "type" | "value",
		read: (v: JsonValue, c: Ctx) => Result<T, Diagnostic>,
		name: Name,
		stem: string,
	): Result<{ readonly path: LogicalPath; readonly file: T }, Diagnostic> {
		const path = `${dir}/${stem}.${kind}`;
		if (!files.has(path)) {
			return err(diagnostic("missing_member", "semantic", path, `${manifestPath} lists "${Name.canonical(name)}" but there is no ${path}`));
		}
		const file = readFile(path, read);
		if (!file.ok) return file;
		if (!Name.equals(file.value.name, name)) {
			return shape(path, "/name", `expected "${Name.canonical(name)}", the name ${manifestPath} listed, found "${Name.canonical(file.value.name)}"`);
		}
		return ok({ path, file: file.value });
	}

	function typeDefLoader(dir: string, manifestPath: LogicalPath): Load<TypeDef> {
		return (name, stem) => {
			const f = nodeFile<TypeDefinitionFile<TA, VA>>(dir, manifestPath, "type", readTypeDefinitionFile, name, stem);
			if (!f.ok) return f;
			return f.value.file.body.kind === "def" ? ok(f.value.file.body.value) : shape(f.value.path, "/", "expected a definition file");
		};
	}

	function valueDefLoader(dir: string, manifestPath: LogicalPath): Load<ValueDef> {
		return (name, stem) => {
			const f = nodeFile<ValueDefinitionFile<TA, VA>>(dir, manifestPath, "value", readValueDefinitionFile, name, stem);
			if (!f.ok) return f;
			return f.value.file.body.kind === "def" ? ok(f.value.file.body.value) : shape(f.value.path, "/", "expected a definition file");
		};
	}

	function typeSpecLoader(dir: string, manifestPath: LogicalPath): Load<TypeSpec> {
		return (name, stem) => {
			const f = nodeFile<TypeDefinitionFile<TA, VA>>(dir, manifestPath, "type", readTypeDefinitionFile, name, stem);
			if (!f.ok) return f;
			return f.value.file.body.kind === "spec" ? ok(f.value.file.body.value) : shape(f.value.path, "/", "expected a specification file");
		};
	}

	function valueSpecLoader(dir: string, manifestPath: LogicalPath): Load<ValueSpec> {
		return (name, stem) => {
			const f = nodeFile<ValueDefinitionFile<TA, VA>>(dir, manifestPath, "value", readValueDefinitionFile, name, stem);
			if (!f.ok) return f;
			return f.value.file.body.kind === "spec" ? ok(f.value.file.body.value) : shape(f.value.path, "/", "expected a specification file");
		};
	}

	// A module manifest, checked against the directory it was found in. The
	// directory is the authority on the module's path: a manifest that disagrees
	// would put the same module in two places at once.
	function readModuleManifest(p: PackageRoot, dir: string, expect: "definitions" | "specifications"): Result<Manifest, Diagnostic> {
		const manifestPath = `${p.root}/${dir}/module`;
		const m = readFile(manifestPath, (v, c) => readModuleManifestFile(v, c, { expect }));
		if (!m.ok) return m;
		const relative = dir.slice(p.prefix.length + 1);
		const spelled = Path.escaped(m.value.path.path);
		if (spelled !== relative) return shape(manifestPath, "/path", `module path "${spelled}" does not match its directory "${relative}"`);
		return m;
	}

	function definitionPackage(packages: readonly PackageRoot[], p: PackageRoot): Result<PackageDefinition<TA, VA>, Diagnostic> {
		const modules: NamedModule<AccessControlled<ModuleDefinition<TA, VA>>>[] = [];
		for (const dir of moduleDirs(files, packages, p)) {
			const manifestPath = `${p.root}/${dir}/module`;
			const m = readModuleManifest(p, dir, "definitions");
			if (!m.ok) return m;
			const types = listed(manifestPath, m.value.types, m.value, typeDefLoader(`${p.root}/${dir}`, manifestPath));
			if (!types.ok) return types;
			const values = listed(manifestPath, m.value.values, m.value, valueDefLoader(`${p.root}/${dir}`, manifestPath));
			if (!values.ok) return values;
			modules.push({ name: m.value.path, value: { access: m.value.access, value: { doc: m.value.doc, types: types.value, values: values.value } } });
		}
		return ok({ modules });
	}

	function specificationPackage(packages: readonly PackageRoot[], p: PackageRoot): Result<PackageSpecification<TA, VA>, Diagnostic> {
		const modules: NamedModule<ModuleSpecification<TA, VA>>[] = [];
		for (const dir of moduleDirs(files, packages, p)) {
			const manifestPath = `${p.root}/${dir}/module`;
			const m = readModuleManifest(p, dir, "specifications");
			if (!m.ok) return m;
			const types = listedSpecs(manifestPath, m.value.types, m.value, typeSpecLoader(`${p.root}/${dir}`, manifestPath));
			if (!types.ok) return types;
			const values = listedSpecs(manifestPath, m.value.values, m.value, valueSpecLoader(`${p.root}/${dir}`, manifestPath));
			if (!values.ok) return values;
			// A tree has nowhere to keep module annotations, so a module read out
			// of one has none (ruling S7.3a); the writer refuses one that has any.
			modules.push({ name: m.value.path, value: { annotations: [], doc: m.value.doc, types: types.value, values: values.value } });
		}
		return ok({ modules });
	}

	if (!files.has(MANIFEST)) return err(diagnostic("missing_member", "semantic", MANIFEST, 'missing member "manifest"'));
	const manifest = readFile(MANIFEST, readDistributionManifestFile);
	if (!manifest.ok) return manifest;

	const packages = packageRoots(manifest.value);
	const own = packages[0] as PackageRoot;
	const deps = packages.slice(1);
	const packageName = manifest.value.packageName;
	const entryPoints = manifest.value.entryPoints;

	function dependencySpecs(): Result<readonly NamedPackage<PackageSpecification<TA, VA>>[], Diagnostic> {
		const out: NamedPackage<PackageSpecification<TA, VA>>[] = [];
		for (const p of deps) {
			const spec = specificationPackage(packages, p);
			if (!spec.ok) return spec;
			out.push({ name: p.name, value: spec.value });
		}
		return ok(out);
	}

	function dependencyDefs(): Result<readonly NamedPackage<PackageDefinition<TA, VA>>[], Diagnostic> {
		const out: NamedPackage<PackageDefinition<TA, VA>>[] = [];
		for (const p of deps) {
			const def = definitionPackage(packages, p);
			if (!def.ok) return def;
			out.push({ name: p.name, value: def.value });
		}
		return ok(out);
	}

	function assemble(kind: DistributionManifestFile["distribution"]): Result<Distribution<TA, VA>, Diagnostic> {
		if (kind === "Specs") {
			const spec = specificationPackage(packages, own);
			if (!spec.ok) return spec;
			const dependencies = dependencySpecs();
			if (!dependencies.ok) return dependencies;
			return ok({ kind: "Specs", packageName, dependencies: dependencies.value, spec: spec.value });
		}
		const def = definitionPackage(packages, own);
		if (!def.ok) return def;
		if (kind === "Library") {
			const dependencies = dependencySpecs();
			if (!dependencies.ok) return dependencies;
			return ok({ kind: "Library", packageName, dependencies: dependencies.value, def: def.value });
		}
		// An application links its dependencies statically, so `deps/` holds
		// package definitions rather than specifications (S7.3a).
		const dependencies = dependencyDefs();
		if (!dependencies.ok) return dependencies;
		return ok({ kind: "Application", packageName, dependencies: dependencies.value, def: def.value, entryPoints });
	}

	const distribution = assemble(manifest.value.distribution);
	if (!distribution.ok) return distribution;

	// Everything under `pkg/` or `deps/` belongs to a module; a file no module
	// manifest claimed is either in the wrong package or was left behind, and
	// either way the tree is not the distribution it says it is. Anything the
	// grammar does not recognize is not ours and is ignored.
	const stray = [...files.keys()].filter((p) => !consumed.has(p) && classify(p).kind !== "other").sort()[0];
	if (stray !== undefined) return shape(stray, "/", "file belongs to no module");

	warnings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	const collected = warnings.map((w) => w.diagnostic);
	ctx.warnings.push(...collected);
	return ok({ value: { formatVersion: manifest.value.formatVersion, distribution: distribution.value }, warnings: collected });
}
