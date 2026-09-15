// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The Node filesystem adapter for the document tree (`./layout/node`): the
// only entry point in this package that touches a filesystem, so a browser
// build that only imports `./layout` never pulls `node:fs` in.
//
// Reading walks a directory into the same map `readTree` takes; writing lays
// a map out as files. Neither adapter learns anything about the layout's
// grammar that `./layout` does not already know — this module is the seam
// between that pure map and a real directory, nothing more.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProfileCodec } from "../codec/profile.ts";
import { JSON_PROFILE } from "../codec/profile.ts";
import { YAML_PROFILE } from "../codec/yaml/index.ts";
import { type Diagnostic, diagnostic } from "../model/diagnostic.ts";
import type { IRFile } from "../model/distribution.ts";
import { err, type Result } from "../model/result.ts";
import type { TA, VA } from "../versions/v4/attributes.ts";
import type { Checked } from "../versions/v4/index.ts";
import { fromPhysical, MANIFEST, toPhysical } from "./paths.ts";
import { type DocumentTree, readTree } from "./read-tree.ts";

// Every regular file under `dir`, as a POSIX-separated path relative to it.
// Built with `/` directly rather than normalized after the fact, so it is the
// same on every platform `node:fs` runs on.
async function walk(dir: string, base = ""): Promise<readonly string[]> {
	const out: string[] = [];
	for (const entry of await readdir(path.join(dir, base), { withFileTypes: true })) {
		const relative = base === "" ? entry.name : `${base}/${entry.name}`;
		if (entry.isDirectory()) out.push(...(await walk(dir, relative)));
		else if (entry.isFile()) out.push(relative);
	}
	return out;
}

function toNativePath(dir: string, relative: string): string {
	return path.join(dir, ...relative.split("/"));
}

function manifestPhysical(profile: ProfileCodec): string {
	return `${MANIFEST}${profile.extension}`;
}

// The profile a caller did not name: whichever of `manifest.json` and
// `manifest.yaml` is present. Both present is an error the caller reports
// before any file is read; neither present is not this function's problem —
// `readTree` reports the missing manifest itself, so any profile will do.
function inferProfile(relativePaths: readonly string[]): ProfileCodec {
	if (relativePaths.includes(manifestPhysical(YAML_PROFILE))) return YAML_PROFILE;
	return JSON_PROFILE;
}

/**
 * Reads a directory into the `IRFile` the equivalent document tree would have
 * produced. Walks `dir` recursively; a file `fromPhysical` does not recognize
 * (no known extension) is ignored. Both `manifest.json` and `manifest.yaml`
 * existing is `invalid_distribution_shape`; when `profile` is not given it is
 * inferred from whichever one does. A file whose extension disagrees with the
 * resolved profile is also `invalid_distribution_shape`.
 */
export async function readTreeFromDirectory(dir: string, profile?: ProfileCodec): Promise<Result<Checked<IRFile<TA, VA>>, Diagnostic>> {
	const relativePaths = await walk(dir);

	const hasJsonManifest = relativePaths.includes(manifestPhysical(JSON_PROFILE));
	const hasYamlManifest = relativePaths.includes(manifestPhysical(YAML_PROFILE));
	if (hasJsonManifest && hasYamlManifest) {
		return err(diagnostic("invalid_distribution_shape", "semantic", MANIFEST, "both manifest.json and manifest.yaml exist"));
	}

	const resolved = profile ?? inferProfile(relativePaths);

	const files = new Map<string, string>();
	for (const relative of relativePaths) {
		const logical = fromPhysical(relative);
		if (logical === null) continue;
		if (!relative.endsWith(resolved.extension)) {
			return err(diagnostic("invalid_distribution_shape", "semantic", logical, `${relative} is not a ${resolved.name} file`));
		}
		files.set(logical, await readFile(toNativePath(dir, relative), "utf8"));
	}

	return readTree(files, resolved);
}

/**
 * Writes a document tree to `dir` under `profile`: `mkdir -p` per file, then
 * the file at `toPhysical(path, profile)`. Removes nothing already under
 * `dir`, so a caller wanting a clean directory empties it first.
 */
export async function writeTreeToDirectory(dir: string, files: DocumentTree, profile: ProfileCodec): Promise<void> {
	for (const [logical, text] of files) {
		const target = toNativePath(dir, toPhysical(logical, profile));
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, text, "utf8");
	}
}
