// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Where a kit's bytes come from. The driver reads the kit either from a
// directory (`--kit`, the parent repository's live checkout) or from the copy
// embedded in the package, and a `text` fence may name any file of the parent
// repository (distributions.md names website/static/ir/examples/v4/...). Every
// path is repository-relative and POSIX, so one key space serves both.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { KitFence } from "./case.ts";
import type { Kit } from "./load.ts";

export const KIT_PATH = "spec/ir/mck";

export interface KitFiles {
	readonly label: string;
	/** Repository-relative POSIX paths of every file under the kit directory. */
	list(): string[];
	/** Content of a repository-relative path, or null when the source cannot provide it. */
	read(relativePath: string): string | null;
	/** What to call the path in messages: the real file for a directory source, the key otherwise. */
	display(relativePath: string): string;
}

function toPosix(p: string): string {
	return p.split(path.sep).join("/");
}

function walk(directory: string, prefix: string, out: string[]): void {
	for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) walk(absolute, `${prefix}/${entry.name}`, out);
		else if (entry.isFile()) out.push(`${prefix}/${entry.name}`);
	}
}

// A relative path must stay inside its root: no absolute paths and no "..".
function safeJoin(root: string, relativePath: string): string | null {
	if (path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) return null;
	return path.join(root, ...relativePath.split("/"));
}

export function kitFilesFromDirectory(kitDirectory: string, repositoryRoot?: string): KitFiles {
	const kitRoot = path.resolve(kitDirectory);
	const repoRoot = repositoryRoot === undefined ? null : path.resolve(repositoryRoot);
	const locate = (relativePath: string): string | null => {
		if (relativePath.startsWith(`${KIT_PATH}/`)) return safeJoin(kitRoot, relativePath.slice(KIT_PATH.length + 1));
		return repoRoot === null ? null : safeJoin(repoRoot, relativePath);
	};
	return {
		label: kitRoot,
		list: () => {
			const out: string[] = [];
			walk(kitRoot, KIT_PATH, out);
			return out;
		},
		read: (relativePath) => {
			const file = locate(relativePath);
			if (file === null || !existsSync(file) || !statSync(file).isFile()) return null;
			return readFileSync(file, "utf8");
		},
		display: (relativePath) => locate(relativePath) ?? relativePath,
	};
}

export function kitFilesFromMap(label: string, files: ReadonlyMap<string, string>): KitFiles {
	return {
		label,
		list: () => [...files.keys()].filter((k) => k.startsWith(`${KIT_PATH}/`)).sort(),
		read: (relativePath) => files.get(relativePath) ?? null,
		display: (relativePath) => relativePath,
	};
}

export function textFenceTarget(body: string): string {
	return (body.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "").trim();
}

export function profileOfPath(relativePath: string): "json" | "yaml" | null {
	if (relativePath.endsWith(".json")) return "json";
	if (relativePath.endsWith(".yaml") || relativePath.endsWith(".yml")) return "yaml";
	return null;
}

export type ResolvedText =
	| { readonly ok: true; readonly path: string; readonly profile: "json" | "yaml"; readonly content: string }
	| { readonly ok: false; readonly message: string };

export function resolveTextFence(kit: Kit, fence: KitFence): ResolvedText {
	const target = toPosix(textFenceTarget(fence.body));
	const profile = profileOfPath(target);
	if (profile === null) return { ok: false, message: `text fence names ${target}, which is neither .json nor .yaml` };
	const content = kit.source.read(target);
	if (content === null) return { ok: false, message: `text fence names ${target}, which is not in the kit source (${kit.source.label})` };
	return { ok: true, path: target, profile, content };
}
