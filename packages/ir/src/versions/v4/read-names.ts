// packages/ir/src/versions/v4/read-names.ts
//
// Readers for the name vocabulary. v4 writes canonical strings, but every
// reader also accepts the legacy word arrays v1 to v3 used, because a v4
// document may have been produced by a transitional encoder. The model's
// parse functions own the grammar; this module only decides which shape is
// in front of it and re-anchors the resulting diagnostic on the cursor.
import { type Ctx, at, expectString, fail } from "../../codec/json/cursor.ts";
import type { JsonValue } from "../../codec/json/value.ts";
import { type Diagnostic, diagnostic } from "../../model/diagnostic.ts";
import { FQName, ModuleName, Name, PackageName, Path } from "../../model/names.ts";
import { type Result, err, ok } from "../../model/result.ts";

// A canonical FQName string is "pkg:mod#local"; a Name or Path string never
// carries either separator, so these two characters are enough to tell a
// reference from a variable at type position.
export function isFQNameString(s: string): boolean {
	return s.includes(":") && s.includes("#");
}

// The model's parse functions build diagnostics without a cursor, since they
// know nothing about the document; re-issue them here so the caller can point
// at the offending member.
function withCursor<T>(ctx: Ctx, r: Result<T, Diagnostic>): Result<T, Diagnostic> {
	return r.ok ? r : err(diagnostic(r.error.code, r.error.stage, ctx.cursor || "/", r.error.message));
}

function readWords(ctx: Ctx, items: readonly JsonValue[]): Result<readonly string[], Diagnostic> {
	const words: string[] = [];
	for (let i = 0; i < items.length; i += 1) {
		const s = expectString(at(ctx, i), items[i] as JsonValue);
		if (!s.ok) return s;
		words.push(s.value);
	}
	return ok(words);
}

export function readName(ctx: Ctx, v: JsonValue): Result<Name, Diagnostic> {
	if (typeof v === "string") return withCursor(ctx, Name.parse(v));
	if (Array.isArray(v)) {
		const words = readWords(ctx, v);
		return words.ok ? withCursor(ctx, Name.fromLegacyArray(words.value)) : words;
	}
	return fail(ctx, "invalid_name", "expected a name string or a legacy array of words");
}

export function readPath(ctx: Ctx, v: JsonValue): Result<Path, Diagnostic> {
	if (typeof v === "string") return withCursor(ctx, Path.parse(v));
	if (Array.isArray(v)) {
		const names: (readonly string[])[] = [];
		for (let i = 0; i < v.length; i += 1) {
			const item = v[i] as JsonValue;
			if (!Array.isArray(item)) return fail(at(ctx, i), "invalid_path", "expected a legacy array of words");
			const words = readWords(at(ctx, i), item);
			if (!words.ok) return words;
			names.push(words.value);
		}
		return withCursor(ctx, Path.fromLegacyArray(names));
	}
	return fail(ctx, "invalid_path", "expected a path string or a legacy array of word arrays");
}

export function readPackageName(ctx: Ctx, v: JsonValue): Result<PackageName, Diagnostic> {
	const p = readPath(ctx, v);
	return p.ok ? ok(PackageName.of(p.value)) : p;
}

export function readModuleName(ctx: Ctx, v: JsonValue): Result<ModuleName, Diagnostic> {
	const p = readPath(ctx, v);
	return p.ok ? ok(ModuleName.of(p.value)) : p;
}

export function readFQName(ctx: Ctx, v: JsonValue): Result<FQName, Diagnostic> {
	if (typeof v === "string") return withCursor(ctx, FQName.parse(v));
	if (Array.isArray(v) && v.length === 3) {
		const pkg = readPackageName(at(ctx, 0), v[0] as JsonValue);
		if (!pkg.ok) return pkg;
		const mod = readModuleName(at(ctx, 1), v[1] as JsonValue);
		if (!mod.ok) return mod;
		const local = readName(at(ctx, 2), v[2] as JsonValue);
		if (!local.ok) return local;
		return ok(FQName.of(pkg.value, mod.value, local.value));
	}
	return fail(ctx, "invalid_fqname", 'expected "pkg:mod#local" or a legacy [package, module, name] array');
}
