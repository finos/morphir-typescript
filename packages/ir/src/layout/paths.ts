// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The document tree's logical paths: a POSIX path with no extension, so it
// is profile-blind by construction. The profile decides the extension only
// at the physical boundary (toPhysical/fromPhysical); everything else in the
// layout works with logical paths.
import type { ProfileCodec } from "../codec/profile.ts";
import type { ModuleName, PackageName } from "../model/names.ts";
import { Path } from "../model/names.ts";

/** A POSIX-style path with no extension, e.g. `"pkg/my-org/domain/customer.type"`. */
export type LogicalPath = string;

export type PathKind =
	| { readonly kind: "manifest" }
	| { readonly kind: "module"; readonly root: "pkg" | "deps"; readonly dir: string }
	| { readonly kind: "type" | "value"; readonly root: "pkg" | "deps"; readonly dir: string; readonly stem: string }
	| { readonly kind: "other" };

export const MANIFEST: LogicalPath = "manifest";

const DEFINITION_LEAF = /^(.+)\.(type|value)$/;

/** Which shape a logical path has, without knowing the profile that will serialize it. */
export function classify(path: LogicalPath): PathKind {
	if (path === MANIFEST) return { kind: "manifest" };

	const parts = path.split("/");
	const root = parts[0];
	if (root !== "pkg" && root !== "deps") return { kind: "other" };

	const rest = parts.slice(1);
	if (rest.length === 0) return { kind: "other" };

	const leaf = rest[rest.length - 1] as string;
	const dir = rest.slice(0, -1).join("/");

	if (leaf === "module") return { kind: "module", root, dir };

	const m = DEFINITION_LEAF.exec(leaf);
	if (m !== null) {
		const stem = m[1] as string;
		const kind = m[2] as "type" | "value";
		return { kind, root, dir, stem };
	}

	return { kind: "other" };
}

/** Appends the profile's extension; the one place a logical path grows one. */
export function toPhysical(path: LogicalPath, profile: ProfileCodec): string {
	return `${path}${profile.extension}`;
}

const KNOWN_EXTENSIONS: readonly string[] = [".json", ".yaml", ".yml"];

/** Strips a known extension and normalizes separators; null for anything else. */
export function fromPhysical(name: string): LogicalPath | null {
	const normalized = name.replace(/\\/g, "/");
	for (const ext of KNOWN_EXTENSIONS) {
		if (normalized.endsWith(ext)) return normalized.slice(0, normalized.length - ext.length);
	}
	return null;
}

/** The escaped directory one module's files live in, as `classify` spells it: without the root. */
export function moduleDir(pkg: PackageName, mod: ModuleName): string {
	return `${Path.escaped(pkg.path)}/${Path.escaped(mod.path)}`;
}

/**
 * The `<root>/<dir>/` every file of one module directory starts with. The
 * grammar of a logical path lives here and nowhere else, so a reader that
 * classified a directory and a writer that escaped one build the same strings.
 */
export function moduleDirPrefix(root: "pkg" | "deps", dir: string): string {
	return `${root}/${dir}/`;
}

/** The module manifest inside the directory `dir` under `root`. */
export function moduleManifestPath(root: "pkg" | "deps", dir: string): LogicalPath {
	return `${moduleDirPrefix(root, dir)}module`;
}

/** One type's or one value's own file inside the directory `dir` under `root`. */
export function nodeFilePath(root: "pkg" | "deps", dir: string, stem: string, kind: "type" | "value"): LogicalPath {
	return `${moduleDirPrefix(root, dir)}${stem}.${kind}`;
}

/** The logical path of a module's manifest, under `pkg/` or `deps/<pkg path>/…` (ruling S7.3a). */
export function modulePath(root: "pkg" | "deps", pkg: PackageName, mod: ModuleName): LogicalPath {
	return moduleManifestPath(root, moduleDir(pkg, mod));
}

/** The logical path of one type's or one value's own file, when the tree keeps each in its own file. */
export function definitionPath(root: "pkg" | "deps", pkg: PackageName, mod: ModuleName, stem: string, kind: "type" | "value"): LogicalPath {
	return nodeFilePath(root, moduleDir(pkg, mod), stem, kind);
}
