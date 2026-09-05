// packages/ir/src/versions/v4/format-version.test.ts
// Runs docs/spec/ir/fixtures/format-version-conformance.json (finos/morphir) scalarCases
// and rootDiagnosticCases for the JSON format.
// Run with: bun test packages/ir/src/versions/v4/format-version.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { newRoot } from "../../codec/json/cursor.ts";
import { isObject, jsonNumber, parseJson, writeJson } from "../../codec/json/value.ts";
import { compatibility, readFormatVersionMember, recognize } from "./format-version.ts";

const corpusPath = path.resolve(import.meta.dir, "../../../../../../../docs/spec/ir/fixtures/format-version-conformance.json");
// A missing corpus would quietly skip the conformance cases, so it is an error
// unless a caller has said it is running without the fixtures.
if (!existsSync(corpusPath) && process.env.MORPHIR_FIXTURES_OPTIONAL !== "1") {
	throw new Error(`format-version-conformance.json not found at ${corpusPath}; set MORPHIR_FIXTURES_OPTIONAL=1 to skip`);
}
const corpus = existsSync(corpusPath) ? JSON.parse(readFileSync(corpusPath, "utf8")) : null;

describe("recognize", () => {
	test("integer 4 and \"4.0.0\" normalize to 4.0.0 with canonical integer 4", () => {
		for (const v of [jsonNumber("4"), "4.0.0"]) {
			const r = recognize(newRoot(), v);
			expect(r.ok).toBe(true);
			if (r.ok) { expect(r.value.normalized).toEqual({ major: 4, minor: 0, patch: 0 }); expect(writeJson(r.value.canonical)).toBe("4"); }
		}
	});
	test("rejects prerelease, leading zeros, majors below 3 as strings, and zero", () => {
		for (const bad of ["4.0.0-beta", "4.01.0", "2.0.0", "0.0.0"]) expect(recognize(newRoot(), bad).ok).toBe(false);
		expect(recognize(newRoot(), jsonNumber("0")).ok).toBe(false);
		expect(recognize(newRoot(), jsonNumber("4.5")).ok).toBe(false);
		expect(recognize(newRoot(), true).ok).toBe(false);
	});
	test("out of range", () => {
		const r = recognize(newRoot(), "3.4294967296.0");
		expect(!r.ok && r.error.code).toBe("format_version_out_of_range");
	});
	test("compatibility against the reference table", () => {
		expect(compatibility({ major: 4, minor: 0, patch: 0 })).toBe("supported");
		expect(compatibility({ major: 4, minor: 1, patch: 0 })).toBe("unsupported_format_version_revision");
		expect(compatibility({ major: 5, minor: 0, patch: 0 })).toBe("unsupported_format_version_major");
	});
});

describe.skipIf(corpus === null)("format-version-conformance.json", () => {
	test("scalarCases", () => {
		for (const c of corpus.scalarCases) {
			const value = typeof c.value === "number" ? jsonNumber(String(c.value)) : c.value;
			const r = recognize(newRoot(), value);
			// The corpus nests the expected diagnostic under `normalization.diagnostic`
			// rather than a top-level `diagnostic` field; adapted here per the task's
			// resolution note (adapt the key access, not the assertion).
			if (c.normalization.diagnostic !== undefined) {
				expect(r.ok).toBe(false);
				if (!r.ok) expect(r.error.code).toBe(c.normalization.diagnostic);
			} else {
				expect(r.ok).toBe(true);
				if (r.ok) {
					const n = r.value.normalized;
					expect(`${n.major}.${n.minor}.${n.patch}`).toBe(c.normalization.normalized);
					expect(writeJson(r.value.canonical)).toBe(JSON.stringify(c.normalization.canonical));
					expect(compatibility(n, corpus.supportedVersions)).toBe(c.compatibility);
				}
			}
		}
	});
	test("rootDiagnosticCases for JSON sources", () => {
		for (const c of corpus.rootDiagnosticCases.filter((x: { format: string }) => x.format === "json")) {
			const parsed = parseJson(c.source);
			if (!parsed.ok) {
				// The strict parser rejects duplicate members (including a duplicated
				// formatVersion) as `duplicate_member` before the formatVersion contract
				// ever sees the document, so `duplicate_format_version` is unobservable
				// here; the corpus case still counts as a pass. Per the task's ruling.
				if (parsed.error.code === "duplicate_member" && c.diagnostic === "duplicate_format_version") continue;
				expect(parsed.error.code).toBe(c.diagnostic);
				continue;
			}
			const o = parsed.value;
			expect(isObject(o)).toBe(true);
			if (isObject(o)) {
				const r = readFormatVersionMember(newRoot(), o);
				expect(!r.ok && r.error.code).toBe(c.diagnostic);
			}
		}
	});
});
