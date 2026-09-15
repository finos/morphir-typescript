// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// File-stem escaping with path-budget truncation (decision 0012). A stem
// that fits the manifest's `pathBudget` alongside its directory prefix and
// profile suffix is used as-is; one that does not is cut to make room for a
// content hash, so two names that share a long common prefix still produce
// distinct files.
import { type Diagnostic, diagnostic } from "../model/diagnostic.ts";
import { Name } from "../model/names.ts";
import type { Result } from "../model/result.ts";
import { err, ok } from "../model/result.ts";
import { sha256Hex } from "./sha256.ts";

/** A file stem: an escaped name, or an escaped name cut and hash-suffixed to fit a path budget. */
export const FILE_STEM = /^_?[a-z0-9]+(-_?[a-z0-9]+)*(__[0-9a-f]{8})?_?$/;

export interface StemResult {
	readonly stem: string;
	readonly truncated: boolean;
}

const HASH_SUFFIX_LEN = 10; // "__" + 8 hex digits

/**
 * The file stem for `name` under a directory whose logical path is
 * `physicalPrefix` (e.g. `"pkg/my-org/my-project/domain/"`), given the
 * profile's file `suffix` (e.g. `".type.yaml"`) and the distribution's
 * `pathBudget`. Fails with `invalid_distribution_shape` when the budget
 * cannot fit even a one-character truncated stem plus its hash suffix.
 */
export function stemFor(name: Name, physicalPrefix: string, suffix: string, pathBudget: number): Result<StemResult, Diagnostic> {
	const escaped = Name.fileStem(name);
	if (physicalPrefix.length + escaped.length + suffix.length <= pathBudget) {
		return ok({ stem: escaped, truncated: false });
	}

	const keep = pathBudget - physicalPrefix.length - suffix.length - HASH_SUFFIX_LEN;
	if (keep < 1) {
		return err(diagnostic("invalid_distribution_shape", "semantic", "/", `path budget ${pathBudget} cannot fit ${physicalPrefix}${escaped}${suffix}`));
	}

	const kept = escaped.slice(0, keep).replace(/[-_]+$/, "");
	const stem = `${kept}__${sha256Hex(escaped).slice(0, 8)}`;
	return ok({ stem, truncated: true });
}
