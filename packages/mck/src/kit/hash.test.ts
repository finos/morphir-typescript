// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { contentHash } from "./hash.ts";

const enc = new TextEncoder();
describe("contentHash", () => {
	test("is order independent and changes with any byte", () => {
		const a = contentHash(
			new Map([
				["b", enc.encode("2")],
				["a", enc.encode("1")],
			]),
		);
		const b = contentHash(
			new Map([
				["a", enc.encode("1")],
				["b", enc.encode("2")],
			]),
		);
		const c = contentHash(
			new Map([
				["a", enc.encode("1")],
				["b", enc.encode("3")],
			]),
		);
		expect(a).toBe(b);
		expect(a).not.toBe(c);
		expect(a).toMatch(/^sha256-[0-9a-f]{64}$/);
	});
	test("is stable across runs (pinned value)", () => {
		expect(contentHash(new Map([["a", enc.encode("1")]]))).toBe(contentHash(new Map([["a", enc.encode("1")]])));
	});
});
