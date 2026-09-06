// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { compareVersions, parseStableVersion, parseVersionTag } from "./version.ts";

describe("parseStableVersion", () => {
	test.each([
		["0.0.1", { major: 0, minor: 0, patch: 1, text: "0.0.1" }],
		["1.2.3", { major: 1, minor: 2, patch: 3, text: "1.2.3" }],
		["10.20.30", { major: 10, minor: 20, patch: 30, text: "10.20.30" }],
	])("parses exact stable version %s", (input, expected) => {
		expect(parseStableVersion(input)).toEqual(expected);
	});

	test.each(["v1.2.3", "01.2.3", "1.02.3", "1.2.03", "1.2", "1.2.3-beta.1", "1.2.3+build.4"])("rejects non-stable or inexact version %s", (input) => {
		expect(() => parseStableVersion(input)).toThrow(`invalid stable semantic version: ${input}`);
	});

	test("accepts components at Number.MAX_SAFE_INTEGER", () => {
		expect(parseStableVersion("9007199254740991.9007199254740991.9007199254740991")).toEqual({
			major: Number.MAX_SAFE_INTEGER,
			minor: Number.MAX_SAFE_INTEGER,
			patch: Number.MAX_SAFE_INTEGER,
			text: "9007199254740991.9007199254740991.9007199254740991",
		});
	});

	test.each(["9007199254740992.0.0", "9007199254740993.0.0", "0.9007199254740992.0", "0.0.9007199254740992"])(
		"rejects unsafe numeric components in %s",
		(input) => {
			expect(() => parseStableVersion(input)).toThrow(`invalid stable semantic version: ${input}`);
		},
	);
});

describe("parseVersionTag", () => {
	test("parses an exact release tag", () => {
		expect(parseVersionTag("v10.20.30")).toEqual({ major: 10, minor: 20, patch: 30, text: "10.20.30" });
	});

	test.each(["1.2.3", "v01.2.3", "v1.2", "v1.2.3-rc.1", "v1.2.3+build", "v9007199254740992.0.0"])("maps invalid tag %s to a release-tag error", (tag) => {
		expect(() => parseVersionTag(tag)).toThrow(`invalid release tag: ${tag}`);
	});
});

describe("compareVersions", () => {
	test.each([
		["1.0.0", "2.0.0", -1],
		["2.1.0", "2.0.9", 1],
		["2.1.9", "2.1.10", -1],
		["10.0.0", "2.0.0", 1],
		["1.2.3", "1.2.3", 0],
	] as const)("compares %s with %s numerically", (left, right, expected) => {
		expect(compareVersions(parseStableVersion(left), parseStableVersion(right))).toBe(expected);
	});

	test("compares adjacent large safe components exactly", () => {
		expect(compareVersions(parseStableVersion("9007199254740990.0.0"), parseStableVersion("9007199254740991.0.0"))).toBe(-1);
	});
});
