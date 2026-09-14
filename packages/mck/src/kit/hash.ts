// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// A reproducible hash of a file map: sorted `<path>\0<sha256 of bytes>\n`
// lines, hashed once more. Independent of git and of the platform.
import { createHash } from "node:crypto";

export function contentHash(files: ReadonlyMap<string, Uint8Array>): string {
	const lines = [...files.keys()].sort().map(
		(p) =>
			`${p}\0${createHash("sha256")
				.update(files.get(p) as Uint8Array)
				.digest("hex")}\n`,
	);
	return `sha256-${createHash("sha256").update(lines.join("")).digest("hex")}`;
}
