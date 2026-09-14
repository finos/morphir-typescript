// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EMBEDDED_KIT_COMMIT } from "../../kit/embedded.ts";
import pkg from "../../package.json" with { type: "json" };
import { driverVersion, kitVersion } from "./version.ts";

const dirs: string[] = [];
const temp = (): string => {
	const d = mkdtempSync(path.join(tmpdir(), "mck-version-"));
	dirs.push(d);
	return d;
};
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { force: true, recursive: true });
});

describe("driverVersion", () => {
	test("equals the version in package.json", () => {
		expect(driverVersion()).toBe(pkg.version);
	});
});

describe("kitVersion", () => {
	test("null means the embedded commit", () => {
		expect(kitVersion(null)).toBe(EMBEDDED_KIT_COMMIT);
	});
	test("a directory without git is unknown", () => {
		const dir = temp();
		expect(kitVersion(dir)).toBe("unknown");
	});
});
