// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Reading a document tree (document-tree page, "Reading a tree",
// docs/spec/ir/schemas/v4/document-tree-files.md in finos/morphir): a map of
// logical paths to text becomes the
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
import { classify, type LogicalPath, MANIFEST, moduleManifestPath, nodeFilePath, packageDir, VERSION_SLOT } from "./paths.ts";

/** A distribution spread over files, keyed by logical path (no extension). */
export type DocumentTree = ReadonlyMap<LogicalPath, string>;

type TypeDef = AccessControlled<Documented<TypeDefinition<TA>>>;
type ValueDef = AccessControlled<Documented<ValueDefinition<TA, VA>>>;
type TypeSpec = Documented<TypeSpecification<TA, VA>>;
type ValueSpec = Documented<ValueSpecification<TA, VA>>;
type Manifest = ModuleManifestFile<TA, VA>;
type Load<T> = (name: Name, stem: string) => Result<T, Diagnostic>;

/** One module directory: where its files are, and where its own manifest is. */
interface Where {
	readonly root: "pkg" | "deps";
	readonly dir: string;
	readonly manifestPath: LogicalPath;
}

function whereIn(root: "pkg" | "deps", dir: string): Where {
	return { root, dir, manifestPath: moduleManifestPath(root, dir) };
}

/** Whether a logical path is one a distribution owns, whatever shape it has. */
function isUnderPackageRoot(path: LogicalPath): boolean {
	return path.startsWith("pkg/") || path.startsWith("deps/");
}

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
	/** The escaped package path itself, with no version slot. */
	readonly pkgPath: string;
	/** The escaped directory prefix every one of the package's module directories starts with. */
	readonly prefix: string;
}

// The own package first, then the dependencies in the order the manifest listed
// them: a directory tree does not order its dependencies, the manifest does.
function packageRoots(manifest: DistributionManifestFile): readonly PackageRoot[] {
	const ownPath = Path.escaped(manifest.packageName.path);
	return [
		{ root: "pkg", name: manifest.packageName, pkgPath: ownPath, prefix: ownPath },
		...manifest.dependencies.map((name) => ({ root: "deps" as const, name, pkgPath: Path.escaped(name.path), prefix: packageDir("deps", name) })),
	];
}

// Which package a directory belongs to: the one listed package, under the same
// root, whose directory prefix it starts with. Under `deps/` the prefix ends
// in the version slot (`<escaped pkg>/@/`), so a package named `a` and one
// named `a/b` can never both prefix the same directory (decision 0015) — at
// most one package ever matches, and the filter below is a defensive check
// that reports rather than silently picking if that invariant is ever wrong.
function owner(packages: readonly PackageRoot[], root: "pkg" | "deps", dir: string): PackageRoot | null {
	const matches = packages.filter((p) => p.root === root && dir.startsWith(`${p.prefix}/`));
	if (matches.length > 1) {
		throw new Error(`directory "${root}/${dir}" matches more than one package's prefix: ${matches.map((p) => p.prefix).join(", ")}`);
	}
	return matches[0] ?? null;
}

// The message for a `deps/` directory no package claimed. If its leading
// segments match a listed dependency's package path, the directory is missing
// or misspelling the version slot; otherwise it belongs to no listed package
// at all, the way any unclaimed directory does.
function strayMessage(path: LogicalPath, packages: readonly PackageRoot[]): string {
	const generic = "file belongs to no module";
	const c = classify(path);
	if (c.kind === "other" || c.kind === "manifest" || c.root !== "deps") return generic;
	for (const p of packages) {
		if (p.root !== "deps") continue;
		if (c.dir !== p.pkgPath && !c.dir.startsWith(`${p.pkgPath}/`)) continue;
		const segment = c.dir.slice(p.pkgPath.length + 1).split("/")[0] ?? "";
		if (segment.startsWith(VERSION_SLOT) && segment !== VERSION_SLOT) {
			return `the dependency directory's version segment "${segment}" carries a version, but the v4 model has no package version to hold (decision 0015); expected a bare "${VERSION_SLOT}"`;
		}
	}
	return `${generic}; a dependency directory expects a version segment ("${VERSION_SLOT}") after the package path`;
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

// A names-style listing is read file by file; an inline listing is already the
// entries themselves. A manifest read with `expect: "definitions"` can only
// come back in the names style or the definitions style, and one read with
// `expect: "specifications"` only in the names style or the specifications
// style, so the entries a caller finds inline are the ones it asked for — the
// cast says what the `expect` argument already decided, and there is no third
// case to guard against. A file that carries the wrong one of `def` and `spec`
// is a different mistake, caught where the file is read.
function entriesOf<TDef, TSpec, T>(entries: ModuleEntries<TDef, TSpec>, m: Manifest, load: Load<T>): Result<readonly Named<T>[], Diagnostic> {
	if (entries.style !== "names") return ok(entries.items as readonly Named<unknown>[] as readonly Named<T>[]);
	const out: Named<T>[] = [];
	for (const name of entries.names) {
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
		where: Where,
		kind: "type" | "value",
		read: (v: JsonValue, c: Ctx) => Result<T, Diagnostic>,
		name: Name,
		stem: string,
	): Result<{ readonly path: LogicalPath; readonly file: T }, Diagnostic> {
		const manifestPath = where.manifestPath;
		const path = nodeFilePath(where.root, where.dir, stem, kind);
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

	function typeDefLoader(where: Where): Load<TypeDef> {
		return (name, stem) => {
			const f = nodeFile<TypeDefinitionFile<TA, VA>>(where, "type", readTypeDefinitionFile, name, stem);
			if (!f.ok) return f;
			return f.value.file.body.kind === "def" ? ok(f.value.file.body.value) : shape(f.value.path, "/", "expected a definition file");
		};
	}

	function valueDefLoader(where: Where): Load<ValueDef> {
		return (name, stem) => {
			const f = nodeFile<ValueDefinitionFile<TA, VA>>(where, "value", readValueDefinitionFile, name, stem);
			if (!f.ok) return f;
			return f.value.file.body.kind === "def" ? ok(f.value.file.body.value) : shape(f.value.path, "/", "expected a definition file");
		};
	}

	function typeSpecLoader(where: Where): Load<TypeSpec> {
		return (name, stem) => {
			const f = nodeFile<TypeDefinitionFile<TA, VA>>(where, "type", readTypeDefinitionFile, name, stem);
			if (!f.ok) return f;
			return f.value.file.body.kind === "spec" ? ok(f.value.file.body.value) : shape(f.value.path, "/", "expected a specification file");
		};
	}

	function valueSpecLoader(where: Where): Load<ValueSpec> {
		return (name, stem) => {
			const f = nodeFile<ValueDefinitionFile<TA, VA>>(where, "value", readValueDefinitionFile, name, stem);
			if (!f.ok) return f;
			return f.value.file.body.kind === "spec" ? ok(f.value.file.body.value) : shape(f.value.path, "/", "expected a specification file");
		};
	}

	// A module manifest, checked against the directory it was found in. The
	// directory is the authority on the module's path: a manifest that disagrees
	// would put the same module in two places at once.
	function readModuleManifest(where: Where, p: PackageRoot, expect: "definitions" | "specifications"): Result<Manifest, Diagnostic> {
		const m = readFile(where.manifestPath, (v, c) => readModuleManifestFile(v, c, { expect }));
		if (!m.ok) return m;
		const relative = where.dir.slice(p.prefix.length + 1);
		const spelled = Path.escaped(m.value.path.path);
		if (spelled !== relative) return shape(where.manifestPath, "/path", `module path "${spelled}" does not match its directory "${relative}"`);
		return m;
	}

	function definitionPackage(packages: readonly PackageRoot[], p: PackageRoot): Result<PackageDefinition<TA, VA>, Diagnostic> {
		const modules: NamedModule<AccessControlled<ModuleDefinition<TA, VA>>>[] = [];
		for (const dir of moduleDirs(files, packages, p)) {
			const where = whereIn(p.root, dir);
			const m = readModuleManifest(where, p, "definitions");
			if (!m.ok) return m;
			const types = entriesOf(m.value.types, m.value, typeDefLoader(where));
			if (!types.ok) return types;
			const values = entriesOf(m.value.values, m.value, valueDefLoader(where));
			if (!values.ok) return values;
			modules.push({ name: m.value.path, value: { access: m.value.access, value: { doc: m.value.doc, types: types.value, values: values.value } } });
		}
		return ok({ modules });
	}

	function specificationPackage(packages: readonly PackageRoot[], p: PackageRoot): Result<PackageSpecification<TA, VA>, Diagnostic> {
		const modules: NamedModule<ModuleSpecification<TA, VA>>[] = [];
		for (const dir of moduleDirs(files, packages, p)) {
			const where = whereIn(p.root, dir);
			const m = readModuleManifest(where, p, "specifications");
			if (!m.ok) return m;
			const types = entriesOf(m.value.types, m.value, typeSpecLoader(where));
			if (!types.ok) return types;
			const values = entriesOf(m.value.values, m.value, valueSpecLoader(where));
			if (!values.ok) return values;
			// A tree has nowhere to keep module annotations, so a module read out
			// of one has none (document-tree page, "Module order and annotations");
			// the writer refuses one that has any.
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
		// package definitions rather than specifications (document-tree page,
		// "Dependencies").
		const dependencies = dependencyDefs();
		if (!dependencies.ok) return dependencies;
		return ok({ kind: "Application", packageName, dependencies: dependencies.value, def: def.value, entryPoints });
	}

	const distribution = assemble(manifest.value.distribution);
	if (!distribution.ok) return distribution;

	// Everything under `pkg/` or `deps/` belongs to a module; a file no module
	// manifest claimed is in the wrong package, spelled in a way the grammar
	// does not recognize, or simply left behind, and either way the tree is not
	// the distribution it says it is (document-tree page, "Reading a tree").
	// Only files outside those two roots are ignored.
	const stray = [...files.keys()].filter((p) => !consumed.has(p) && isUnderPackageRoot(p)).sort()[0];
	if (stray !== undefined) return shape(stray, "/", strayMessage(stray, packages));

	warnings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	const collected = warnings.map((w) => w.diagnostic);
	ctx.warnings.push(...collected);
	return ok({ value: { formatVersion: manifest.value.formatVersion, distribution: distribution.value }, warnings: collected });
}
