// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

export interface StableVersion {
	readonly major: number;
	readonly minor: number;
	readonly patch: number;
	readonly text: string;
}

export function parseStableVersion(input: string): StableVersion {
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(input);
	if (match === null) throw new Error(`invalid stable semantic version: ${input}`);
	const [, major, minor, patch] = match;
	return { major: Number(major), minor: Number(minor), patch: Number(patch), text: input };
}

export function parseVersionTag(tag: string): StableVersion {
	try {
		if (!tag.startsWith("v")) throw new Error();
		return parseStableVersion(tag.slice(1));
	} catch {
		throw new Error(`invalid release tag: ${tag}`);
	}
}

export function compareVersions(left: StableVersion, right: StableVersion): number {
	for (const component of ["major", "minor", "patch"] as const) {
		if (left[component] < right[component]) return -1;
		if (left[component] > right[component]) return 1;
	}
	return 0;
}
