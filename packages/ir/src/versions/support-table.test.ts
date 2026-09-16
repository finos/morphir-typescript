// packages/ir/src/versions/support-table.test.ts
// Runs docs/spec/ir/fixtures/format-version-conformance.json (finos/morphir)
// supportTableCases alongside the module's own examples.
// Run with: bun test packages/ir/src/versions/support-table.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { canonicalSupportTable, compatibility, parseSupportTable, renderCargo, renderElm, renderProse, supports } from "./support-table.ts";

const corpusPath = path.resolve(import.meta.dir, "../../../../../../docs/spec/ir/fixtures/format-version-conformance.json");
// A missing corpus would quietly skip the conformance cases, so it is an error
// unless a caller has said it is running without the fixtures.
if (!existsSync(corpusPath) && process.env.MORPHIR_FIXTURES_OPTIONAL !== "1") {
	throw new Error(`format-version-conformance.json not found at ${corpusPath}; set MORPHIR_FIXTURES_OPTIONAL=1 to skip`);
}
const corpus = existsSync(corpusPath) ? JSON.parse(readFileSync(corpusPath, "utf8")) : null;
const release = (s: string) => {
	const [major, minor, patch] = s.split(".").map(Number) as [number, number, number];
	return { major, minor, patch };
};
const table = (s: string) => {
	const r = parseSupportTable(s);
	if (!r.ok) throw new Error(`${s}: ${r.error}`);
	return r.value;
};

describe("parseSupportTable", () => {
	test("reference table round-trips", () => {
		expect(canonicalSupportTable(table("[3.0.0,3.1.0),[4.0.0,4.1.0)"))).toBe("[3.0.0,3.1.0),[4.0.0,4.1.0)");
	});
	test("inclusive upper advances to the next patch", () => {
		expect(canonicalSupportTable(table("[4.0.0,4.0.2]"))).toBe("[4.0.0,4.0.3)");
	});
	test("inverted interval is an error naming the interval", () => {
		const r = parseSupportTable("[4.1.0,4.0.0)");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toContain("[4.1.0,4.0.0)");
	});
	test("an interval whose only candidate release is above its upper bound is empty", () => {
		expect(parseSupportTable("(4.0.4294967295,4.1.0)").ok).toBe(false);
		expect(canonicalSupportTable(table("(4.0.4294967295,4.2.0)"))).toBe("(4.0.4294967295,4.2.0)");
	});
	test("a table that excludes no release is an error naming the input", () => {
		const r = parseSupportTable("(,4.0.0),[3.0.0,)");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toContain("(,4.0.0),[3.0.0,)");
	});
	test("nothing below the domain floor, so an interval that ends at it is empty", () => {
		expect(parseSupportTable("(,3.0.0)").ok).toBe(false);
		expect(canonicalSupportTable(table("(,3.0.1)"))).toBe("(,3.0.1)");
	});
	test("an exact release at the patch maximum keeps both brackets", () => {
		expect(canonicalSupportTable(table("[4.0.4294967295]"))).toBe("[4.0.4294967295,4.0.4294967295]");
	});
	test("intervals adjacent across the patch maximum merge", () => {
		expect(canonicalSupportTable(table("[4.0.0,4.0.4294967295],[4.1.0,4.2.0)"))).toBe("[4.0.0,4.2.0)");
		expect(canonicalSupportTable(table("[4.0.4294967295],[4.1.0,4.2.0)"))).toBe("[4.0.4294967295,4.2.0)");
	});
	test("a contained interval disappears into the ones around it", () => {
		expect(canonicalSupportTable(table("[3.0.0,3.5.0),[3.1.0,3.2.0),[3.4.0,4.0.0)"))).toBe("[3.0.0,4.0.0)");
	});
});

describe("compatibility", () => {
	const ref = table("[3.0.0,3.1.0),[4.0.0,4.1.0)");
	test("patch inside, minor outside, major outside", () => {
		expect(compatibility(ref, release("4.0.7"))).toBe("supported");
		expect(compatibility(ref, release("4.1.0"))).toBe("unsupported_format_version_minor");
		expect(compatibility(ref, release("5.0.0"))).toBe("unsupported_format_version_major");
		expect(supports(ref, release("3.0.1"))).toBe(true);
	});
	test("a table must contain a release of the major to be a minor mismatch", () => {
		expect(compatibility(table("[3.0.0,4.0.0)"), release("4.5.0"))).toBe("unsupported_format_version_major");
		expect(compatibility(table("[3.0.0,4.0.1)"), release("4.5.0"))).toBe("unsupported_format_version_minor");
	});
});

describe("render", () => {
	const ref = table("[3.0.0,3.1.0),[4.0.0,4.1.0)");
	test("cargo, elm and prose", () => {
		expect(renderCargo(ref)).toEqual([">=3.0.0, <3.1.0", ">=4.0.0, <4.1.0"]);
		expect(renderElm(ref)).toEqual({ ok: true, value: ["3.0.0 <= v < 3.1.0", "4.0.0 <= v < 4.1.0"] });
		expect(renderProse(ref)).toBe("3.0.0 up to but not including 3.1.0, or 4.0.0 up to but not including 4.1.0");
	});
	test("elm refuses an unbounded interval", () => {
		expect(renderElm(table("[4.0.0,)")).ok).toBe(false);
	});
	test("the one-sided and inclusive-upper spellings", () => {
		const t = table("(,4.0.4294967295],[4.2.0,)");
		expect(canonicalSupportTable(t)).toBe("(,4.0.4294967295],[4.2.0,)");
		expect(renderCargo(t)).toEqual(["<=4.0.4294967295", ">=4.2.0"]);
		expect(renderProse(t)).toBe("4.0.4294967295 and earlier, or 4.2.0 and later");
		expect(renderProse(table("(4.0.4294967295,4.2.0)"))).toBe("after 4.0.4294967295 up to but not including 4.2.0");
	});
	// parseSupportTable rejects an interval with no bounds, so this shape can
	// only be built by hand; the renderers still have to say something true.
	test("the renderers are total over a bounds-free interval", () => {
		const unbounded = [{ lowerInclusive: false, upperInclusive: false }];
		expect(renderCargo(unbounded)).toEqual(["*"]);
		expect(renderProse(unbounded)).toBe("every release");
	});
});

if (corpus) {
	describe("corpus supportTableCases", () => {
		for (const c of corpus.supportTableCases.parse) {
			test(`parse: ${c.name}`, () => {
				const r = parseSupportTable(c.input);
				if (c.invalid) expect(r.ok).toBe(false);
				else {
					expect(r.ok).toBe(true);
					if (r.ok) {
						const canonical = canonicalSupportTable(r.value);
						expect(canonical).toBe(c.canonical);
						// One canonical spelling means the canonical form parses
						// back to itself; anything else is a form no consumer can
						// re-read.
						const again = parseSupportTable(canonical);
						expect(again.ok).toBe(true);
						if (again.ok) expect(canonicalSupportTable(again.value)).toBe(canonical);
					}
				}
			});
		}
		for (const c of corpus.supportTableCases.membership) {
			test(`membership: ${c.table} ${c.release}`, () => {
				expect(compatibility(table(c.table), release(c.release))).toBe(c.compatibility);
			});
		}
		for (const c of corpus.supportTableCases.render) {
			test(`render: ${c.table}`, () => {
				const t = table(c.table);
				expect(canonicalSupportTable(t)).toBe(c.table);
				expect(renderCargo(t)).toEqual(c.cargo);
				const elm = renderElm(t);
				if (c.elm === null) expect(elm.ok).toBe(false);
				else expect(elm).toEqual({ ok: true, value: c.elm });
				expect(renderProse(t)).toBe(c.prose);
			});
		}
	});
}
