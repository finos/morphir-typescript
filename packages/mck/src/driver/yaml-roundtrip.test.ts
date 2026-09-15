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
import { parseYaml, writeYaml } from "../../../ir/src/codec/yaml/index.ts";
import type { KitCase, KitFence } from "../kit/case.ts";
import { embeddedKitFiles } from "../kit/embedded-source.ts";
import { loadKitFromFiles } from "../kit/load.ts";

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
			if (y === undefined || j === undefined) continue;
			expect(`${c.id}\n${writeYaml(json(j.body))}`).toBe(`${c.id}\n${y.body}`);
			compared += 1;
		}
		console.log(`yaml canonical fences written from json: ${compared}`);
		// Pinned, not bounded: the embedded kit is a fixed set of bytes, so this
		// number moves only when a kit resync deliberately moves it.
		expect(compared).toBe(84);
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
		// Same set the writer compares above: every YAML canonical fence with a
		// JSON twin now round-trips byte for byte.
		expect(compared).toBe(84);
	});

	test("the writer is idempotent on every canonical YAML fence, including the document-tree files", () => {
		let checked = 0;
		for (const c of active) {
			for (const f of c.fences) {
				if (f.info.language !== "yaml") continue;
				if (f.info.role !== "canonical" && f.info.role !== "file") continue;
				expect(`${c.id}:${f.index}\n${writeYaml(yaml(f.body))}`).toBe(`${c.id}:${f.index}\n${f.body}`);
				checked += 1;
			}
		}
		console.log(`yaml fences the writer reproduces byte for byte: ${checked}`);
		// 84 canonical with a JSON twin, plus canonical fences without one and
		// `file` fences.
		expect(checked).toBe(102);
	});

	test("the writer reproduces the kit's complete-example.yaml document byte for byte", () => {
		// distributions-0004 names the document from a `text canonical` fence.
		const c = active.find((x) => x.id === "distributions-0004");
		const j = c === undefined ? undefined : jsonOf(c, "canonical");
		const document = kit.source.read("spec/ir/mck/documents/complete-example.yaml");
		expect(j).toBeDefined();
		expect(document).not.toBeNull();
		expect(yaml(document ?? "")).toEqual(json(j?.body ?? ""));
		expect(writeYaml(json(j?.body ?? ""))).toBe(document ?? "");
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
					// the driver's business; here it only has to answer rather than
					// throw, and the kit has to keep carrying the fence.
					parseYaml(f.body);
					rejected += 1;
				}
			}
		}
		console.log(`yaml accepted fences: ${accepted}; yaml rejected fences: ${rejected}`);
		// The kit has no `yaml accepted` fence yet. Both numbers move only with a
		// kit resync.
		expect(accepted).toBe(0);
		expect(rejected).toBe(9);
	});
});
