// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The kit is the authority for the YAML profile's bytes: every YAML fence in
// the embedded kit is run through the reader and the canonical writer here, so
// a rule the writer gets wrong shows up as a diff against a fence rather than
// as an opinion. Three assertions per canonical case: the writer emits the YAML
// fence from the JSON fence's value, the reader reads the YAML fence to the
// JSON fence's value, and the writer is idempotent on the YAML fence itself.
import { describe, expect, test } from "bun:test";
import { parseJson } from "../../../ir/src/codec/json/value.ts";
import { parseYaml } from "../../../ir/src/codec/yaml/parse.ts";
import { writeYaml } from "../../../ir/src/codec/yaml/write.ts";
import type { KitCase, KitFence } from "../kit/case.ts";
import { embeddedKitFiles } from "../kit/embedded-source.ts";
import { loadKitFromFiles } from "../kit/load.ts";

// Fences whose bytes disagree with the rest of the kit rather than with the
// writer; each is listed verbatim, with its reason, under "Fences for the
// parent" in
// .superpowers/sdd/2026-09-15-yaml-profile-and-document-tree/task-2-report.md.
// The three below spell an all-scalar `source` mapping under `attributes` as a
// flow mapping, where every other all-scalar mapping in the kit — including
// `DocumentLiteral`'s in patterns-and-literals-0006 — is a block mapping.
const NON_CANONICAL_YAML: ReadonlySet<string> = new Set(["types-0010", "values-0022", "patterns-and-literals-0012"]);

const kit = await loadKitFromFiles(embeddedKitFiles());
const active = kit.cases.filter((c) => c.status === "active");

const yamlOf = (c: KitCase, role: KitFence["info"]["role"]): KitFence | undefined => c.fences.find((f) => f.info.language === "yaml" && f.info.role === role);
const jsonOf = (c: KitCase, role: KitFence["info"]["role"]): KitFence | undefined => c.fences.find((f) => f.info.language === "json" && f.info.role === role);

const json = (text: string) => {
	const r = parseJson(text);
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};
const yaml = (text: string) => {
	const r = parseYaml(text);
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

describe("the canonical YAML writer against every YAML fence of the embedded kit", () => {
	test("the kit loads without errors and carries YAML fences", () => {
		expect(kit.errors).toEqual([]);
		expect(active.length).toBeGreaterThan(60);
		expect(active.flatMap((c) => c.fences).filter((f) => f.info.language === "yaml").length).toBeGreaterThan(60);
	});

	test("the writer emits the YAML canonical fence from the JSON canonical fence", () => {
		let compared = 0;
		for (const c of active) {
			const y = yamlOf(c, "canonical");
			const j = jsonOf(c, "canonical");
			if (y === undefined || j === undefined || NON_CANONICAL_YAML.has(c.id)) continue;
			expect(`${c.id}\n${writeYaml(json(j.body))}`).toBe(`${c.id}\n${y.body}`);
			compared += 1;
		}
		console.log(`yaml canonical fences written from json: ${compared}`);
		expect(compared).toBeGreaterThan(40);
	});

	test("the reader reads the YAML canonical fence to the JSON canonical fence's value", () => {
		let compared = 0;
		for (const c of active) {
			const y = yamlOf(c, "canonical");
			const j = jsonOf(c, "canonical");
			if (y === undefined || j === undefined) continue;
			expect(yaml(y.body)).toEqual(json(j.body));
			compared += 1;
		}
		console.log(`yaml canonical fences read against json: ${compared}`);
		expect(compared).toBeGreaterThan(40);
	});

	test("the writer is idempotent on every canonical YAML fence, including the document-tree files", () => {
		let checked = 0;
		for (const c of active) {
			for (const f of c.fences) {
				if (f.info.language !== "yaml") continue;
				if (f.info.role !== "canonical" && f.info.role !== "file") continue;
				if (NON_CANONICAL_YAML.has(c.id)) continue;
				expect(`${c.id}:${f.index}\n${writeYaml(yaml(f.body))}`).toBe(`${c.id}:${f.index}\n${f.body}`);
				checked += 1;
			}
		}
		console.log(`yaml fences the writer reproduces byte for byte: ${checked}`);
		expect(checked).toBeGreaterThan(50);
	});

	test("the kit's complete-example.yaml document reads to the same value as its JSON fence", () => {
		// distributions-0004 names the document from a `text canonical` fence. Its
		// bytes are not yet the canonical spelling — it quotes FQNames and writes
		// scalar sequences in block style — so only the value is asserted here;
		// the file is listed for the parent in the task report.
		const c = active.find((x) => x.id === "distributions-0004");
		const j = c === undefined ? undefined : jsonOf(c, "canonical");
		const document = kit.source.read("spec/ir/mck/documents/complete-example.yaml");
		expect(j).toBeDefined();
		expect(document).not.toBeNull();
		expect(yaml(document ?? "")).toEqual(json(j?.body ?? ""));
	});

	test("every accepted YAML fence parses and every rejected one answers without throwing", () => {
		let accepted = 0;
		let rejected = 0;
		for (const c of kit.cases) {
			for (const f of c.fences) {
				if (f.info.language !== "yaml") continue;
				if (f.info.role === "accepted") {
					const r = parseYaml(f.body);
					if (!r.ok) throw new Error(`${c.id}: ${r.error.code}: ${r.error.message}`);
					accepted += 1;
				}
				if (f.info.role === "rejected") {
					// Whether the text is refused by the reader or by the node reader is
					// the driver's business; here it only has to answer.
					expect(typeof parseYaml(f.body).ok).toBe("boolean");
					rejected += 1;
				}
			}
		}
		console.log(`yaml accepted fences: ${accepted}; yaml rejected fences: ${rejected}`);
	});
});
