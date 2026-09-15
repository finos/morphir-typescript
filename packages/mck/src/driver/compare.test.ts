// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { checkCanonical, checkRejected, checkWarnings, normalizeCanonical, pathBudgetOf } from "./compare.ts";

describe("pathBudgetOf", () => {
	test("reads the budget out of either profile's manifest without parsing it", () => {
		expect(pathBudgetOf(["formatVersion: 4", "distribution: Library", "package: a/b", "pathBudget: 4000"].join("\n"))).toBe(4000);
		expect(pathBudgetOf('{ "formatVersion": 4, "distribution": "Library", "package": "a/b", "pathBudget": 64 }')).toBe(64);
		expect(pathBudgetOf('{\n\t"pathBudget" : 128\n}')).toBe(128);
	});
	test("a manifest with no budget, or one that is not a plain integer, reads as null", () => {
		expect(pathBudgetOf("formatVersion: 4\n")).toBeNull();
		expect(pathBudgetOf("pathBudget: four thousand\n")).toBeNull();
		expect(pathBudgetOf("")).toBeNull();
		// A `pathBudget` that is not the whole yaml value is not the budget.
		expect(pathBudgetOf("note: pathBudget: 4000 is the default\n")).toBeNull();
		// The yaml form is anchored at column 0: an indented `pathBudget:` is a
		// nested field, not the manifest's own key, and is not matched.
		expect(pathBudgetOf("  pathBudget: 96  \n")).toBeNull();
	});
});

describe("normalizeCanonical", () => {
	test("strips exactly one trailing newline", () => {
		expect(normalizeCanonical("a\n")).toBe("a");
		expect(normalizeCanonical("a\r\n")).toBe("a");
		expect(normalizeCanonical("a\n\n")).toBe("a\n");
		expect(normalizeCanonical("a")).toBe("a");
	});
});
describe("checkCanonical", () => {
	test("equal modulo one trailing newline is null", () => {
		expect(checkCanonical('{"a":1}\n', '{"a":1}')).toBeNull();
	});
	test("names the first differing line", () => {
		expect(checkCanonical("a\nb\nc", "a\nx\nc")).toBe("line 2 differs: expected b got x");
		expect(checkCanonical("a", "a\nb")).toBe("line 2 differs: expected <end> got b");
	});
});
describe("checkWarnings", () => {
	test("no warning wanted: any warning fails", () => {
		expect(checkWarnings(undefined, [])).toBeNull();
		expect(checkWarnings(undefined, [{ code: "legacy_spelling", cursor: "/x" }])).toBe("warned unexpectedly: legacy_spelling at /x");
	});
	test("warning wanted: at least one and all equal to it", () => {
		expect(
			checkWarnings("legacy_spelling", [
				{ code: "legacy_spelling", cursor: "/a" },
				{ code: "legacy_spelling", cursor: "/b" },
			]),
		).toBeNull();
		expect(checkWarnings("legacy_spelling", [])).toBe("should have warned legacy_spelling and nothing else (got nothing)");
		expect(checkWarnings("legacy_spelling", [{ code: "other", cursor: "/a" }])).toBe("should have warned legacy_spelling and nothing else (got other at /a)");
	});
});
describe("checkRejected", () => {
	const fail = { ok: false as const, diagnostic: { code: "unknown_member", stage: "normalization" as const, cursor: "/x", message: "m" } };
	const okTuple = { ok: true as const, kind: "Tuple", canonical: { json: "[]" }, warnings: [] };
	test("diagnostic= matches the code", () => {
		expect(checkRejected({ diagnostic: "unknown_member" }, fail)).toEqual({
			result: "pass",
			expectedDiagnostic: "unknown_member",
			observedDiagnostic: fail.diagnostic,
		});
		expect(checkRejected({ diagnostic: "missing_member" }, fail)).toMatchObject({
			result: "fail",
			expectedDiagnostic: "missing_member",
			message: "expected missing_member, got unknown_member at /x: m",
		});
		expect(checkRejected({ diagnostic: "missing_member" }, okTuple)).toMatchObject({
			result: "fail",
			message: "expected missing_member, but the fence decoded as Tuple",
		});
	});
	test("expect= matches the kind", () => {
		expect(checkRejected({ expect: "Tuple" }, okTuple)).toEqual({ result: "pass" });
		expect(checkRejected({ expect: "Reference" }, okTuple)).toMatchObject({ result: "fail", message: "expected a Reference, decoded a Tuple" });
		expect(checkRejected({ expect: "Tuple" }, fail)).toMatchObject({ result: "fail", message: "expected a Tuple, got unknown_member at /x: m" });
	});
});
