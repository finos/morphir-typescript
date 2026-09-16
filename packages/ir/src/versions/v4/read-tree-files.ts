// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The v4 readers for the document tree's four file kinds.
//
// Every one of these files repeats the format version at its root, so each is
// read and checked for support the same way a whole document is — against the
// same table, so the two cannot drift. A top-level `$meta` member is reserved
// and ignored (decision 0014): it is filtered out of the root object before
// the member check runs, so no reader below ever sees it and no writer emits
// one.
//
// The wire labels here are manifest constants, not node variants — a file kind
// is a wrapper around nodes the other readers own. They are matched with
// lookups and plain conditionals rather than `case "<Label>":` switches so the
// vocabulary drift test's label scan never mistakes "Library" or "Public" for
// an unlisted variant of a new node.
import {
	at,
	type Ctx,
	describeJson,
	expectArray,
	expectNumber,
	expectObject,
	expectString,
	fail,
	members,
	newRoot,
	optionalString,
} from "../../codec/json/cursor.ts";
import { isInteger, isObject, type JsonObject, type JsonValue, jsonObject } from "../../codec/json/value.ts";
import type { Diagnostic } from "../../model/diagnostic.ts";
import type { EntryPoint, FormatVersion } from "../../model/distribution.ts";
import type { AccessControlled, Documented, Named } from "../../model/modules.ts";
import { Name, PackageName } from "../../model/names.ts";
import { ok, type Result } from "../../model/result.ts";
import type {
	DistributionKindName,
	DistributionManifestFile,
	ModuleEntries,
	ModuleManifestFile,
	TypeDefinitionFile,
	TypeFileBody,
	ValueDefinitionFile,
	ValueFileBody,
} from "../../model/tree-files.ts";
import type { Access, TypeDefinition, TypeSpecification } from "../../model/types.ts";
import type { ValueDefinition, ValueSpecification } from "../../model/values.ts";
import type { TA, VA } from "./attributes.ts";
import { compatibility, readFormatVersionMember } from "./format-version.ts";
import {
	readAccess,
	readAccessControlledTypeDefinition,
	readAccessControlledValueDefinition,
	readDocumentedTypeSpecification,
	readDocumentedValueSpecification,
	readNamedMap,
} from "./read-definitions.ts";
import { readEntryPoints, SUPPORT_TABLE } from "./read-distribution.ts";
import { readModuleName, readName, readPackageName } from "./read-names.ts";

type Read<T> = (ctx: Ctx, v: JsonValue) => Result<T, Diagnostic>;

const DISTRIBUTION_KIND_NAMES: readonly string[] = ["Library", "Specs", "Application"];

// Decision 0001's escaped stem: lowercase words joined by hyphens, an optional
// leading or trailing underscore for the escape forms, and the eight hex
// digits a truncated stem carries after "__".
const ESCAPED_STEM = /^_?[a-z0-9]+(-_?[a-z0-9]+)*(__[0-9a-f]{8})?_?$/;

// The smallest budget a tree can be laid out under; below this the escaped
// stems have nowhere to go (decision 0012).
const MIN_PATH_BUDGET = 64;

// ------------------------------------------------------------- the preamble

// `$meta` is reserved and carries no meaning to a reader, so it is taken off
// here rather than listed as an optional member of all four kinds: a member
// check that never sees it can never report it, and a writer that never holds
// it can never write it back.
function rootWithoutMeta(ctx: Ctx, v: JsonValue): Result<JsonObject, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	return ok(o.value.members.has("$meta") ? jsonObject([...o.value.members].filter(([key]) => key !== "$meta")) : o.value);
}

// Read before the member check and listed as optional there, so a file with no
// formatVersion answers missing_format_version — what readIRFile answers for a
// single-file document — rather than a plain missing_member.
function readFileFormatVersion(ctx: Ctx, o: JsonObject): Result<FormatVersion, Diagnostic> {
	const recognized = readFormatVersionMember(ctx, o);
	if (!recognized.ok) return recognized;
	const fv = recognized.value.normalized;
	const compat = compatibility(fv, SUPPORT_TABLE);
	if (compat === "supported") return ok(fv);
	return fail(at(ctx, "formatVersion"), compat, `format version ${fv.major}.${fv.minor}.${fv.patch} is not supported`, o.members.get("formatVersion"));
}

// ------------------------------------------------- the distribution manifest

function readPathBudget(ctx: Ctx, v: JsonValue): Result<number, Diagnostic> {
	const tooSmall = (): Result<never, Diagnostic> => fail(ctx, "invalid_type", `pathBudget must be an integer of at least ${MIN_PATH_BUDGET}`, v);
	const n = expectNumber(ctx, v);
	if (!n.ok) return n;
	if (!isInteger(n.value)) return tooSmall();
	const budget = Number(n.value.text);
	return budget < MIN_PATH_BUDGET ? tooSmall() : ok(budget);
}

// A manifest that lists the same dependency twice would give `readTree`'s
// `owner()` two package roots with the identical directory prefix; reporting
// it here, at the second occurrence, keeps that a diagnostic instead of a
// crash further down the pipeline. "duplicate_member" is the closest existing
// code — the array plays the role a JSON object's members would, and
// `read-values.ts`'s duplicate `externals` binding already reports a
// duplicate array entry the same way.
function readPackageNames(ctx: Ctx, v: JsonValue): Result<readonly PackageName[], Diagnostic> {
	const items = expectArray(ctx, v);
	if (!items.ok) return items;
	const out: PackageName[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < items.value.length; i += 1) {
		const name = readPackageName(at(ctx, i), items.value[i] as JsonValue);
		if (!name.ok) return name;
		const canonical = PackageName.canonical(name.value);
		if (seen.has(canonical)) {
			return fail(at(ctx, i), "duplicate_member", `duplicate dependency "${canonical}"`, items.value[i] as JsonValue);
		}
		seen.add(canonical);
		out.push(name.value);
	}
	return ok(out);
}

// "version", "created" and "layout" are recorded by the writer that produced
// the tree and mean nothing to a reader; they are still checked to be strings
// so a mistyped one is caught here rather than carried through unseen.
function readDiscardedString(ctx: Ctx, m: ReadonlyMap<string, JsonValue>, key: string): Result<null, Diagnostic> {
	const raw = m.get(key);
	if (raw === undefined) return ok(null);
	const s = expectString(at(ctx, key), raw);
	return s.ok ? ok(null) : s;
}

export function readDistributionManifestFile(v: JsonValue, ctx: Ctx = newRoot()): Result<DistributionManifestFile, Diagnostic> {
	const o = rootWithoutMeta(ctx, v);
	if (!o.ok) return o;
	const formatVersion = readFileFormatVersion(ctx, o.value);
	if (!formatVersion.ok) return formatVersion;
	const m = members(ctx, o.value, ["distribution", "package", "pathBudget"], ["formatVersion", "dependencies", "entryPoints", "version", "created", "layout"]);
	if (!m.ok) return m;

	const kind = expectString(at(ctx, "distribution"), m.value.get("distribution") as JsonValue);
	if (!kind.ok) return kind;
	if (!DISTRIBUTION_KIND_NAMES.includes(kind.value)) {
		return fail(at(ctx, "distribution"), "invalid_distribution_shape", `unknown distribution "${kind.value}"`, o.value);
	}
	const distribution = kind.value as DistributionKindName;

	const packageName = readPackageName(at(ctx, "package"), m.value.get("package") as JsonValue);
	if (!packageName.ok) return packageName;
	const pathBudget = readPathBudget(at(ctx, "pathBudget"), m.value.get("pathBudget") as JsonValue);
	if (!pathBudget.ok) return pathBudget;

	const rawDependencies = m.value.get("dependencies");
	const dependencies: Result<readonly PackageName[], Diagnostic> =
		rawDependencies === undefined ? ok([]) : readPackageNames(at(ctx, "dependencies"), rawDependencies);
	if (!dependencies.ok) return dependencies;

	// Only an Application has entry points, so the member is unknown on the
	// other two kinds rather than merely ignored.
	const rawEntryPoints = m.value.get("entryPoints");
	if (rawEntryPoints !== undefined && distribution !== "Application") {
		return fail(at(ctx, "entryPoints"), "unknown_member", `unknown member "entryPoints" on a ${distribution} manifest`, o.value);
	}
	const entryPoints: Result<readonly EntryPoint[], Diagnostic> =
		rawEntryPoints === undefined ? ok([]) : readEntryPoints(at(ctx, "entryPoints"), rawEntryPoints);
	if (!entryPoints.ok) return entryPoints;

	for (const key of ["version", "created", "layout"]) {
		const discarded = readDiscardedString(ctx, m.value, key);
		if (!discarded.ok) return discarded;
	}

	return ok({
		formatVersion: formatVersion.value,
		distribution,
		packageName: packageName.value,
		pathBudget: pathBudget.value,
		dependencies: dependencies.value,
		entryPoints: entryPoints.value,
	});
}

// ------------------------------------------------------ the module manifest

// The page allows a doc to be one string or a list of lines; a list is joined
// the way the text would have read, and the writer only ever emits a string.
function readManifestDoc(ctx: Ctx, m: ReadonlyMap<string, JsonValue>): Result<string | null, Diagnostic> {
	const raw = m.get("doc");
	if (raw === undefined) return ok(null);
	if (!Array.isArray(raw)) return optionalString(ctx, m, "doc");
	const lines: string[] = [];
	for (let i = 0; i < raw.length; i += 1) {
		const s = expectString(at(at(ctx, "doc"), i), raw[i] as JsonValue);
		if (!s.ok) return s;
		lines.push(s.value);
	}
	return ok(lines.join("\n"));
}

export type ModuleEntryExpectation = "definitions" | "specifications";

// The two shapes readAccessControlled recognizes: "access" beside the payload,
// or the tag form under a lone Public/Private key. Used only to tell a
// definition from a specification when the caller said which it expected.
function isAccessControlled(v: JsonValue): boolean {
	if (!isObject(v)) return false;
	if (v.members.has("access")) return true;
	const keys = [...v.members.keys()];
	return keys.length === 1 && (keys[0] === "Public" || keys[0] === "Private");
}

// Which of the two object styles a `types` or `values` object is read as is
// the caller's to say: the layout knows the distribution kind, and guessing
// from the shape would make a Specs tree whose specification happens to look
// access-controlled read as something else.
function readModuleEntries<TDef, TSpec>(
	ctx: Ctx,
	raw: JsonValue | undefined,
	expect: ModuleEntryExpectation,
	readDef: Read<TDef>,
	readSpec: Read<TSpec>,
): Result<ModuleEntries<TDef, TSpec>, Diagnostic> {
	if (raw === undefined) return ok({ style: "names", names: [] });
	if (Array.isArray(raw)) {
		const names: Name[] = [];
		for (let i = 0; i < raw.length; i += 1) {
			const name = readName(at(ctx, i), raw[i] as JsonValue);
			if (!name.ok) return name;
			names.push(name.value);
		}
		return ok({ style: "names", names });
	}
	if (!isObject(raw)) return fail(ctx, "invalid_type", `expected an array of names or an object of entries, found ${describeJson(raw)}`, raw);
	if (expect === "specifications") {
		// A definition where a specification was expected is a mistake about what
		// the tree holds, so it is reported as one here rather than reaching the
		// specification reader and coming back as an unknown variant wrapper.
		const guarded: Read<TSpec> = (c, x) =>
			isAccessControlled(x) ? fail(c, "invalid_distribution_shape", "expected a specification, found an access-controlled definition", x) : readSpec(c, x);
		const items: Result<readonly Named<TSpec>[], Diagnostic> = readNamedMap(ctx, raw, guarded);
		return items.ok ? ok({ style: "specifications", items: items.value }) : items;
	}
	const items: Result<readonly Named<TDef>[], Diagnostic> = readNamedMap(ctx, raw, readDef);
	return items.ok ? ok({ style: "definitions", items: items.value }) : items;
}

function namesOf<TDef, TSpec>(entries: ModuleEntries<TDef, TSpec>): readonly Name[] {
	return entries.style === "names" ? entries.names : entries.items.map((x) => x.name);
}

function readFileNames(ctx: Ctx, raw: JsonValue | undefined, listed: ReadonlySet<string>): Result<readonly (readonly [Name, string])[], Diagnostic> {
	if (raw === undefined) return ok([]);
	const o = expectObject(ctx, raw);
	if (!o.ok) return o;
	const out: (readonly [Name, string])[] = [];
	for (const [key, member] of o.value.members) {
		const name = readName(at(ctx, key), key);
		if (!name.ok) return name;
		if (!listed.has(Name.canonical(name.value))) {
			return fail(at(ctx, key), "invalid_distribution_shape", "fileNames key not listed in types or values", o.value);
		}
		const stem = expectString(at(ctx, key), member);
		if (!stem.ok) return stem;
		if (!ESCAPED_STEM.test(stem.value)) return fail(at(ctx, key), "invalid_name", `"${stem.value}" is not an escaped stem`, member);
		out.push([name.value, stem.value] as const);
	}
	return ok(out);
}

export interface ModuleManifestOptions {
	/** How a `types` or `values` object is read. Definitions unless told otherwise. */
	readonly expect?: ModuleEntryExpectation;
}

export function readModuleManifestFile(
	v: JsonValue,
	ctx: Ctx = newRoot(),
	options: ModuleManifestOptions = {},
): Result<ModuleManifestFile<TA, VA>, Diagnostic> {
	const expect: ModuleEntryExpectation = options.expect ?? "definitions";
	const o = rootWithoutMeta(ctx, v);
	if (!o.ok) return o;
	const formatVersion = readFileFormatVersion(ctx, o.value);
	if (!formatVersion.ok) return formatVersion;
	const m = members(ctx, o.value, [], ["formatVersion", "path", "module", "access", "doc", "types", "values", "fileNames"]);
	if (!m.ok) return m;

	// "module" is an accepted spelling of "path" rather than a legacy one in
	// decision 0006's window, so it is not read through windowed() and never
	// warns; the writer still only ever emits "path".
	const canonical = m.value.get("path");
	const alternate = m.value.get("module");
	if (canonical !== undefined && alternate !== undefined) {
		return fail(at(ctx, "module"), "unknown_member", "module is the legacy spelling of path; write only one", o.value);
	}
	const rawPath = canonical ?? alternate;
	if (rawPath === undefined) return fail(ctx, "missing_member", 'missing member "path"', o.value);
	const path = readModuleName(at(ctx, canonical !== undefined ? "path" : "module"), rawPath);
	if (!path.ok) return path;

	const rawAccess = m.value.get("access");
	const access: Result<Access, Diagnostic> = rawAccess === undefined ? ok("Public") : readAccess(at(ctx, "access"), rawAccess);
	if (!access.ok) return access;

	const doc = readManifestDoc(ctx, m.value);
	if (!doc.ok) return doc;

	const types = readModuleEntries<AccessControlled<Documented<TypeDefinition<TA>>>, Documented<TypeSpecification<TA, VA>>>(
		at(ctx, "types"),
		m.value.get("types"),
		expect,
		readAccessControlledTypeDefinition,
		readDocumentedTypeSpecification,
	);
	if (!types.ok) return types;
	const values = readModuleEntries<AccessControlled<Documented<ValueDefinition<TA, VA>>>, Documented<ValueSpecification<TA, VA>>>(
		at(ctx, "values"),
		m.value.get("values"),
		expect,
		readAccessControlledValueDefinition,
		readDocumentedValueSpecification,
	);
	if (!values.ok) return values;

	const listed = new Set([...namesOf(types.value), ...namesOf(values.value)].map((n) => Name.canonical(n)));
	const fileNames = readFileNames(at(ctx, "fileNames"), m.value.get("fileNames"), listed);
	if (!fileNames.ok) return fileNames;

	return ok({
		formatVersion: formatVersion.value,
		path: path.value,
		access: access.value,
		doc: doc.value,
		types: types.value,
		values: values.value,
		fileNames: fileNames.value,
	});
}

// ----------------------------------------------------------- the node files

// A node file carries exactly one of "def" and "spec"; which one it is decides
// what the file means, so neither and both are shape errors rather than a
// missing or an unknown member.
function readNodeFileBody<TDef, TSpec>(
	ctx: Ctx,
	m: ReadonlyMap<string, JsonValue>,
	near: JsonObject,
	readDef: Read<TDef>,
	readSpec: Read<TSpec>,
): Result<{ readonly kind: "def"; readonly value: TDef } | { readonly kind: "spec"; readonly value: TSpec }, Diagnostic> {
	const rawDef = m.get("def");
	const rawSpec = m.get("spec");
	if ((rawDef === undefined) === (rawSpec === undefined)) {
		return fail(ctx, "invalid_distribution_shape", "exactly one of def or spec", near);
	}
	if (rawDef !== undefined) {
		const def = readDef(at(ctx, "def"), rawDef);
		return def.ok ? ok({ kind: "def", value: def.value } as const) : def;
	}
	const spec = readSpec(at(ctx, "spec"), rawSpec as JsonValue);
	return spec.ok ? ok({ kind: "spec", value: spec.value } as const) : spec;
}

function readNodeFilePreamble(
	ctx: Ctx,
	v: JsonValue,
): Result<{ readonly o: JsonObject; readonly m: ReadonlyMap<string, JsonValue>; readonly formatVersion: FormatVersion; readonly name: Name }, Diagnostic> {
	const o = rootWithoutMeta(ctx, v);
	if (!o.ok) return o;
	const formatVersion = readFileFormatVersion(ctx, o.value);
	if (!formatVersion.ok) return formatVersion;
	const m = members(ctx, o.value, ["name"], ["formatVersion", "def", "spec"]);
	if (!m.ok) return m;
	const name = readName(at(ctx, "name"), m.value.get("name") as JsonValue);
	if (!name.ok) return name;
	return ok({ o: o.value, m: m.value, formatVersion: formatVersion.value, name: name.value });
}

export function readTypeDefinitionFile(v: JsonValue, ctx: Ctx = newRoot()): Result<TypeDefinitionFile<TA, VA>, Diagnostic> {
	const head = readNodeFilePreamble(ctx, v);
	if (!head.ok) return head;
	const body: Result<TypeFileBody<TA, VA>, Diagnostic> = readNodeFileBody(
		ctx,
		head.value.m,
		head.value.o,
		readAccessControlledTypeDefinition,
		readDocumentedTypeSpecification,
	);
	return body.ok ? ok({ formatVersion: head.value.formatVersion, name: head.value.name, body: body.value }) : body;
}

export function readValueDefinitionFile(v: JsonValue, ctx: Ctx = newRoot()): Result<ValueDefinitionFile<TA, VA>, Diagnostic> {
	const head = readNodeFilePreamble(ctx, v);
	if (!head.ok) return head;
	const body: Result<ValueFileBody<TA, VA>, Diagnostic> = readNodeFileBody(
		ctx,
		head.value.m,
		head.value.o,
		readAccessControlledValueDefinition,
		readDocumentedValueSpecification,
	);
	return body.ok ? ok({ formatVersion: head.value.formatVersion, name: head.value.name, body: body.value }) : body;
}
