// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for file-stem escaping with path-budget truncation (decision 0012):
// the kit's document-tree-0004 fact, the naming corpus's host-verified
// truncation cases when the parent-only fixture is present, and the failure
// and regex-conformance edges the brief calls out.
// Run with: bun test packages/ir/src/layout/stems.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Name } from "../model/names.ts";
import { FILE_STEM, stemFor } from "./stems.ts";

function nameFor(escapedStem: string): ReturnType<typeof Name.parse> {
	// The corpus records already-escaped stems (initialisms prefixed with
	// "_"); Name.parse expects the canonical uppercase or doubled-hyphen
	// spelling, so rebuild a canonical form by un-escaping the "_" marker.
	const canonical = escapedStem
		.split("-")
		.map((seg) => (seg.startsWith("_") ? seg.slice(1).toUpperCase() : seg))
		.join("-");
	return Name.parse(canonical);
}

describe("stemFor", () => {
	test("kit's document-tree-0004 fact: truncates when the budget is tight", () => {
		const name = Name.parse("customer-relationship-management-record");
		expect(name.ok).toBe(true);
		if (!name.ok) return;
		const r = stemFor(name.value, "pkg/my-org/my-project/domain/", ".type.yaml", 64);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual({ stem: "customer-relati__44a101f8", truncated: true });
	});

	test("does not truncate when the budget is generous", () => {
		const name = Name.parse("customer-relationship-management-record");
		expect(name.ok).toBe(true);
		if (!name.ok) return;
		const r = stemFor(name.value, "pkg/my-org/my-project/domain/", ".type.yaml", 4000);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual({ stem: "customer-relationship-management-record", truncated: false });
	});

	test("fails when the budget cannot fit even a one-character stem", () => {
		const name = Name.parse("a");
		expect(name.ok).toBe(true);
		if (!name.ok) return;
		const r = stemFor(name.value, "pkg/my-org/my-project/domain/", ".type.yaml", 39);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.code).toBe("invalid_distribution_shape");
			expect(r.error.stage).toBe("semantic");
			expect(r.error.cursor).toBe("/");
			expect(r.error.message).toContain("path budget 39 cannot fit");
		}
	});

	test("every produced stem matches FILE_STEM", () => {
		const name = Name.parse("customer-relationship-management-record");
		expect(name.ok).toBe(true);
		if (!name.ok) return;
		const truncated = stemFor(name.value, "pkg/my-org/my-project/domain/", ".type.yaml", 64);
		expect(truncated.ok && FILE_STEM.test(truncated.value.stem)).toBe(true);
		const untruncated = stemFor(name.value, "pkg/my-org/my-project/domain/", ".type.yaml", 4000);
		expect(untruncated.ok && FILE_STEM.test(untruncated.value.stem)).toBe(true);
	});

	const corpusPath = path.resolve(import.meta.dir, "../../../../../../docs/spec/ir/fixtures/naming-conformance.json");
	if (existsSync(corpusPath)) {
		const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
		const cases = (corpus.truncationCases ?? []) as readonly { readonly escapedStem: string; readonly available: number; readonly truncatedStem: string }[];
		test("naming corpus truncationCases[1]: trailing hyphen/underscore drop", () => {
			const second = cases[1];
			expect(second).toBeDefined();
			if (second === undefined) return;
			const name = nameFor(second.escapedStem);
			expect(name.ok).toBe(true);
			if (!name.ok) return;
			// With an empty prefix/suffix, `available` (budget - prefix -
			// suffix) equals the budget itself, and this stem is long enough
			// that it will not fit, so the full stemFor decision truncates it
			// exactly as the corpus's isolated transform does.
			const r = stemFor(name.value, "", "", second.available);
			expect(r.ok).toBe(true);
			if (r.ok) expect(r.value).toEqual({ stem: second.truncatedStem, truncated: true });
		});
	} else {
		console.log(`naming-conformance.json not found at ${corpusPath}; skipping corpus truncation assertion (parent-only fixture)`);
	}
});
