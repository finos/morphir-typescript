// packages/ir/src/versions/v4/read-distribution.ts
//
// The v4 reader for packages, distributions and the root of an IR file.
//
// Two rulings shape this module. A distribution is a single-key wrapper
// object, so a v3 tagged array — or any other shape — at that position is
// invalid_distribution_shape rather than a plain type mismatch (kit
// distributions-0003, bead morphir-ir-v4-stabilize.11). And the root carries
// exactly formatVersion and distribution, in either order; the version is read
// and checked for support before the document under it is read at all (kit
// distributions-0001, distributions-0002).
import { type Ctx, at, expectObject, expectString, fail, members, optionalString, root } from "../../codec/json/cursor.ts";
import { type JsonValue, isNumber, isObject } from "../../codec/json/value.ts";
import type { Diagnostic } from "../../model/diagnostic.ts";
import type {
	Distribution,
	EntryPoint,
	EntryPointKind,
	IRFile,
	NamedPackage,
	PackageDefinition,
	PackageSpecification,
} from "../../model/distribution.ts";
import type { AccessControlled, ModuleDefinition, ModuleSpecification, NamedModule } from "../../model/modules.ts";
import { type Result, ok } from "../../model/result.ts";
import type { TA, VA } from "./attributes.ts";
import { compatibility, readFormatVersionMember } from "./format-version.ts";
import { readAccessControlled, readModuleDefinition, readModuleSpecification } from "./read-definitions.ts";
import { readFQName, readModuleName, readPackageName } from "./read-names.ts";

// This plan pins the binding to exactly 4.0.0; the v3 reader and its wider
// support table arrive with the cross-version plan.
const SUPPORTED_HERE: readonly string[] = ["4.0.0"];

const DISTRIBUTION_KEYS: readonly string[] = ["Library", "Specs", "Application"];
const ENTRY_POINT_KINDS: readonly string[] = ["main", "command", "handler", "job", "policy"];

type Read<T> = (ctx: Ctx, v: JsonValue) => Result<T, Diagnostic>;

const describe = (v: JsonValue): string =>
	v === null ? "null" : Array.isArray(v) ? "array" : isObject(v) ? "object" : isNumber(v) ? "number" : typeof v;

// --------------------------------------------------------------- packages

// Module and package maps are keyed by canonical path strings; a key that is
// not one is invalid_path at that key's cursor.
function readModuleMap<T>(ctx: Ctx, v: JsonValue, read: Read<T>): Result<readonly NamedModule<T>[], Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const out: NamedModule<T>[] = [];
	for (const [key, member] of o.value.members) {
		const name = readModuleName(at(ctx, key), key);
		if (!name.ok) return name;
		const value = read(at(ctx, key), member);
		if (!value.ok) return value;
		out.push({ name: name.value, value: value.value });
	}
	return ok(out);
}

function readPackageMap<T>(ctx: Ctx, v: JsonValue, read: Read<T>): Result<readonly NamedPackage<T>[], Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const out: NamedPackage<T>[] = [];
	for (const [key, member] of o.value.members) {
		const name = readPackageName(at(ctx, key), key);
		if (!name.ok) return name;
		const value = read(at(ctx, key), member);
		if (!value.ok) return value;
		out.push({ name: name.value, value: value.value });
	}
	return ok(out);
}

function readAccessControlledModuleDefinition(
	ctx: Ctx,
	v: JsonValue,
): Result<AccessControlled<ModuleDefinition<TA, VA>>, Diagnostic> {
	return readAccessControlled(ctx, v, readModuleDefinition);
}

export function readPackageDefinition(ctx: Ctx, v: JsonValue): Result<PackageDefinition<TA, VA>, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const m = members(ctx, o.value, [], ["modules"]);
	if (!m.ok) return m;
	const raw = m.value.get("modules");
	if (raw === undefined) return ok({ modules: [] });
	const modules = readModuleMap(at(ctx, "modules"), raw, readAccessControlledModuleDefinition);
	return modules.ok ? ok({ modules: modules.value }) : modules;
}

export function readPackageSpecification(ctx: Ctx, v: JsonValue): Result<PackageSpecification<TA, VA>, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const m = members(ctx, o.value, [], ["modules"]);
	if (!m.ok) return m;
	const raw = m.value.get("modules");
	if (raw === undefined) return ok({ modules: [] });
	const modules: Result<readonly NamedModule<ModuleSpecification<TA, VA>>[], Diagnostic> =
		readModuleMap(at(ctx, "modules"), raw, readModuleSpecification);
	return modules.ok ? ok({ modules: modules.value }) : modules;
}

// ----------------------------------------------------------- entry points

// An entry point map is keyed by the entry point's own name, which is a plain
// label rather than a Morphir name, so it is carried through as written.
function readEntryPoints(ctx: Ctx, v: JsonValue): Result<readonly EntryPoint[], Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const out: EntryPoint[] = [];
	for (const [key, member] of o.value.members) {
		const inner = at(ctx, key);
		const body = expectObject(inner, member);
		if (!body.ok) return body;
		const m = members(inner, body.value, ["target", "kind"], ["doc"]);
		if (!m.ok) return m;
		const target = readFQName(at(inner, "target"), m.value.get("target") as JsonValue);
		if (!target.ok) return target;
		const kind = expectString(at(inner, "kind"), m.value.get("kind") as JsonValue);
		if (!kind.ok) return kind;
		if (!ENTRY_POINT_KINDS.includes(kind.value)) {
			return fail(at(inner, "kind"), "invalid_type", `unknown entry point kind "${kind.value}"`);
		}
		const doc = optionalString(inner, m.value, "doc");
		if (!doc.ok) return doc;
		out.push({ name: key, target: target.value, kind: kind.value as EntryPointKind, doc: doc.value });
	}
	return ok(out);
}

// ---------------------------------------------------------- distributions

export function readDistribution(ctx: Ctx, v: JsonValue): Result<Distribution<TA, VA>, Diagnostic> {
	if (!isObject(v)) {
		return fail(ctx, "invalid_distribution_shape", `expected a distribution wrapper object, found ${describe(v)}`);
	}
	const entries = [...v.members.entries()];
	const first = entries[0];
	if (entries.length !== 1 || first === undefined) {
		return fail(ctx, "invalid_distribution_shape", `expected a wrapper object with one member, found ${entries.length}`);
	}
	const [key, payload] = first;
	if (!DISTRIBUTION_KEYS.includes(key)) return fail(ctx, "invalid_distribution_shape", `unknown distribution "${key}"`);
	const inner = at(ctx, key);
	const body = expectObject(inner, payload);
	if (!body.ok) return body;
	const optional = key === "Specs" ? ["dependencies", "spec"] : ["dependencies", "def"];
	const required = key === "Application" ? ["packageName", "entryPoints"] : ["packageName"];
	const m = members(inner, body.value, required, optional);
	if (!m.ok) return m;
	const packageName = readPackageName(at(inner, "packageName"), m.value.get("packageName") as JsonValue);
	if (!packageName.ok) return packageName;
	if (key === "Application") {
		const dependencies = readDependencies(inner, m.value, readPackageDefinition);
		if (!dependencies.ok) return dependencies;
		const def = readOptionalPackageDefinition(inner, m.value, "def");
		if (!def.ok) return def;
		const entryPoints = readEntryPoints(at(inner, "entryPoints"), m.value.get("entryPoints") as JsonValue);
		if (!entryPoints.ok) return entryPoints;
		return ok({
			kind: "Application",
			packageName: packageName.value,
			dependencies: dependencies.value,
			def: def.value,
			entryPoints: entryPoints.value,
		});
	}
	const dependencies = readDependencies(inner, m.value, readPackageSpecification);
	if (!dependencies.ok) return dependencies;
	if (key === "Specs") {
		const raw = m.value.get("spec");
		const spec: Result<PackageSpecification<TA, VA>, Diagnostic> =
			raw === undefined ? ok({ modules: [] }) : readPackageSpecification(at(inner, "spec"), raw);
		if (!spec.ok) return spec;
		return ok({ kind: "Specs", packageName: packageName.value, dependencies: dependencies.value, spec: spec.value });
	}
	const def = readOptionalPackageDefinition(inner, m.value, "def");
	if (!def.ok) return def;
	return ok({ kind: "Library", packageName: packageName.value, dependencies: dependencies.value, def: def.value });
}

function readDependencies<T>(
	ctx: Ctx,
	m: ReadonlyMap<string, JsonValue>,
	read: Read<T>,
): Result<readonly NamedPackage<T>[], Diagnostic> {
	const raw = m.get("dependencies");
	return raw === undefined ? ok([]) : readPackageMap(at(ctx, "dependencies"), raw, read);
}

function readOptionalPackageDefinition(
	ctx: Ctx,
	m: ReadonlyMap<string, JsonValue>,
	key: string,
): Result<PackageDefinition<TA, VA>, Diagnostic> {
	const raw = m.get(key);
	return raw === undefined ? ok({ modules: [] }) : readPackageDefinition(at(ctx, key), raw);
}

// ------------------------------------------------------------- the root

export function readIRFile(v: JsonValue): Result<IRFile<TA, VA>, Diagnostic> {
	const o = expectObject(root, v);
	if (!o.ok) return o;
	for (const key of o.value.members.keys()) {
		if (key !== "formatVersion" && key !== "distribution") {
			return fail(at(root, key), "unknown_member", `unknown member "${key}"`);
		}
	}
	const recognized = readFormatVersionMember(root, o.value);
	if (!recognized.ok) return recognized;
	const compat = compatibility(recognized.value.normalized, SUPPORTED_HERE);
	if (compat !== "supported") {
		const fv = recognized.value.normalized;
		return fail(at(root, "formatVersion"), compat, `format version ${fv.major}.${fv.minor}.${fv.patch} is not supported`);
	}
	const raw = o.value.members.get("distribution");
	if (raw === undefined) return fail(root, "missing_member", 'missing member "distribution"');
	const distribution = readDistribution(at(root, "distribution"), raw);
	return distribution.ok ? ok({ formatVersion: recognized.value.normalized, distribution: distribution.value }) : distribution;
}
