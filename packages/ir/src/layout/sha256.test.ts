// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the pure SHA-256 implementation: the two FIPS 180-4 standard
// vectors, and the kit's document-tree-0004 fact that pins the digest the
// truncation rule depends on. Run with: bun test packages/ir/src/layout/sha256.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sha256Hex } from "./sha256.ts";

describe("sha256Hex", () => {
	test("empty string", () => {
		expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
	});
	test("abc", () => {
		expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	});
	test("kit's document-tree-0004 fact", () => {
		expect(sha256Hex("customer-relationship-management-record").slice(0, 8)).toBe("44a101f8");
	});

	const corpusPath = path.resolve(import.meta.dir, "../../../../../../docs/spec/ir/fixtures/naming-conformance.json");
	if (existsSync(corpusPath)) {
		test("naming corpus truncationCases[1] digest", () => {
			const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
			const second = corpus.truncationCases?.[1];
			expect(second).toBeDefined();
			expect(sha256Hex(second.escapedStem).slice(0, 8)).toBe(second.truncatedStem.split("__")[1]);
		});
	} else {
		console.log(`naming-conformance.json not found at ${corpusPath}; skipping corpus digest assertion (parent-only fixture)`);
	}
});
