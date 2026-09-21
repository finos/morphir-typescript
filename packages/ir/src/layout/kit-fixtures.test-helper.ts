// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
// Frozen codec regression inputs extracted before the TypeScript IR runner retired.
// Provenance is recorded in the fixture; native MCK owns current compatibility.
// Excluded from the published package alongside *.test.ts.
import fixture from "../../test/fixtures/layout-regressions.json";

export function fileSet(set: string): Map<string, string> {
	const sets: Readonly<Record<string, Readonly<Record<string, string>>>> = fixture.files;
	return new Map(Object.entries(sets[set] ?? {}));
}

export function canonicalYaml(id: string): string {
	const canonicals: Readonly<Record<string, string>> = fixture.canonical;
	const value = canonicals[id];
	if (value === undefined) throw new Error(`no yaml canonical fence in ${id}`);
	return value;
}

export function distributionCanonicals(): readonly (readonly [string, string])[] {
	return fixture.distributions.map(([id, text]) => {
		if (id === undefined || text === undefined) throw new Error("invalid distribution regression fixture");
		return [id, text] as const;
	});
}

export function completeExample(): string {
	return fixture.completeExample;
}
