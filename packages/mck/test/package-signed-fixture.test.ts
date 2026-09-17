// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "bun:test";
import { generateSignedFixture } from "./support/package-signed-fixture.ts";
import { parseFixtureArguments } from "./support/package-signed-fixture-cli.ts";

test("fixture authoring rejects absent canonical inputs", () => {
	expect(() => generateSignedFixture(new Map())).toThrow("missing input");
});

test("authoring CLI requires explicit source and exactly one destination mode", () => {
	for (const args of [
		[],
		["--source", "parent"],
		["--output", "out"],
		["--source", "parent", "--output", "out", "--check", "check"],
		["--source", "a", "--source", "b", "--output", "out"],
		["--source", "a", "--output", "--check"],
		["--source", "a", "--other", "b"],
	])
		expect(() => parseFixtureArguments(args)).toThrow();
	expect(parseFixtureArguments(["--source", "parent", "--output", "out"])).toEqual({ source: "parent", mode: "output", destination: "out" });
	expect(parseFixtureArguments(["--check", "existing", "--source", "parent"])).toEqual({ source: "parent", mode: "check", destination: "existing" });
});

test("fixture authoring rejects changed source bytes before signing", () => {
	const inputs = new Map([["spec/package/mck/fixtures/two-libraries/eligibility/manifest.json", new TextEncoder().encode("{}")]]);
	expect(() => generateSignedFixture(inputs)).toThrow("input digest");
});
