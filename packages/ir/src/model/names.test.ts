// packages/ir/src/model/names.test.ts
// Runs the generated naming corpus (docs/spec/ir/fixtures/naming-conformance.json in
// finos/morphir) against the Name, Path and FQName newtypes.
// Run with: bun test packages/ir/src/model/names.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { FQName, Name, Path, type NameStyle } from "./names.ts";

const corpusPath = path.resolve(import.meta.dir, "../../../../../../docs/spec/ir/fixtures/naming-conformance.json");
const corpus = existsSync(corpusPath) ? JSON.parse(readFileSync(corpusPath, "utf8")) : null;
const styles: readonly NameStyle[] = ["uppercase", "doubledHyphen"];

describe("Name grammar (hand cases)", () => {
	test("parses words and initialisms in both styles", () => {
		for (const text of ["value-in-USD", "value-in--usd"]) {
			const r = Name.parse(text);
			expect(r.ok).toBe(true);
			if (r.ok) expect(r.value.segments).toEqual([
				{ kind: "word", text: "value" }, { kind: "word", text: "in" }, { kind: "initialism", text: "usd" },
			]);
		}
	});
	test("rejects mixed case, empty, and bad separators", () => {
		for (const bad of ["Usd", "", "-a", "a-", "a--", "a b", "value-in-(usd)"]) {
			const r = Name.parse(bad);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.code).toBe("invalid_name");
		}
	});
	test("legacy array collapses runs of single letters", () => {
		const r = Name.fromLegacyArray(["value", "in", "u", "s", "d"]);
		expect(r.ok && Name.canonical(r.value)).toBe("value-in-USD");
		const a = Name.fromLegacyArray(["a"]);
		expect(a.ok && Name.canonical(a.value)).toBe("a");
	});
	test("file stems escape initialisms and reserved device names", () => {
		const usd = Name.parse("value-in-USD");
		expect(usd.ok && Name.fileStem(usd.value)).toBe("value-in-_usd");
		const aux = Name.parse("aux");
		expect(aux.ok && Name.fileStem(aux.value)).toBe("aux_");
		const con = Name.parse("CON");
		expect(con.ok && Name.fileStem(con.value)).toBe("_con");
	});
	test("FQName round-trips", () => {
		const r = FQName.parse("morphir/SDK:list#map");
		expect(r.ok && FQName.canonical(r.value)).toBe("morphir/SDK:list#map");
		expect(r.ok && FQName.canonical(r.value, "doubledHyphen")).toBe("morphir/--sdk:list#map");
		expect(FQName.parse("morphir/SDK:list").ok).toBe(false);
	});
});

describe.skipIf(corpus === null)("naming-conformance.json", () => {
	test("roundTripCases", () => {
		for (const c of corpus.roundTripCases) {
			const name = Name.fromSegments(c.segments);
			for (const s of styles) {
				expect(Name.canonical(name, s)).toBe(c.canonical[s]);
				const back = Name.parse(c.canonical[s]);
				expect(back.ok && Name.equals(back.value, name)).toBe(true);
			}
			expect(Name.fileStem(name)).toBe(c.escapedStem);
			if (c.legacyArray !== undefined) expect(Name.legacyArray(name)).toEqual(c.legacyArray);
		}
	});
	test("legacyDecodeCases", () => {
		for (const c of corpus.legacyDecodeCases) {
			const r = Name.fromLegacyArray(c.legacyArray);
			expect(r.ok).toBe(true);
			if (r.ok) {
				expect(r.value.segments).toEqual(c.segments);
				for (const s of styles) expect(Name.canonical(r.value, s)).toBe(c.canonical[s]);
			}
		}
	});
	test("rejectCases", () => {
		for (const c of corpus.rejectCases) {
			const r = Name.parse(c.input);
			const anyValid = c.validAs.uppercase || c.validAs.doubledHyphen;
			expect(r.ok).toBe(anyValid);
		}
	});
	test("pathCases", () => {
		for (const c of corpus.pathCases) {
			const r = Path.parse(c.canonical.uppercase);
			expect(r.ok).toBe(true);
			if (r.ok) {
				for (const s of styles) expect(Path.canonical(r.value, s)).toBe(c.canonical[s]);
				expect(Path.escaped(r.value)).toBe(c.escapedPath);
			}
		}
	});
	test("fqNameCases", () => {
		for (const c of corpus.fqNameCases) {
			const r = FQName.parse(c.canonical.uppercase);
			expect(r.ok).toBe(true);
			if (r.ok) for (const s of styles) expect(FQName.canonical(r.value, s)).toBe(c.canonical[s]);
		}
	});
});
