// packages/ir/test/mck.test.ts
// Runs the Morphir Compatibility Kit's JSON fences against the v4 JSON codec, in
// process. YAML and text fences are skipped until the YAML profile lands (plan 2c).
// Run with: bun test packages/ir/test/mck.test.ts   (MORPHIR_MCK_DIR overrides the kit path)
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { type KitCase, loadKit } from "@finos/morphir-mck";
import { NODE_ALIASES, type NodeKind, nodeKindOf, readNode, stripNode, writeNode } from "../src/versions/v4/index.ts";

const kitDir = process.env.MORPHIR_MCK_DIR ?? path.resolve(import.meta.dir, "../../../../../spec/ir/mck");

// The kit names a node; this is the node kind that name reads as, including the
// kit's own spellings that differ from the module's.
const NODE_KINDS: readonly NodeKind[] = [
	"Name", "Path", "FQName", "FormatVersion", "Type", "Literal", "Pattern", "Value", "TypeSpecification", "TypeDefinition",
	"ValueSpecification", "ValueDefinition", "AccessControlledTypeDefinition", "AccessControlledValueDefinition", "IRFile",
];
const NODES: ReadonlyMap<string, NodeKind> = new Map<string, NodeKind>([
	...NODE_KINDS.map((k): readonly [string, NodeKind] => [k, k]),
	...Object.entries(NODE_ALIASES),
]);

const kit = existsSync(kitDir) ? await loadKit(kitDir) : null;
let checked = 0;
let skipped = 0;

function runCase(c: KitCase, node: NodeKind): void {
	const jsonFences = c.fences.filter((f) => f.info.language === "json");
	skipped += c.fences.length - jsonFences.length;
	const canonical = jsonFences.find((f) => f.info.role === "canonical");
	const encodings: string[] = [];
	for (const f of jsonFences) {
		const body = f.body.replace(/\n$/, "");
		if (f.info.role === "canonical" || f.info.role === "accepted") {
			const r = readNode(node, body);
			expect(r.ok ? "" : `${f.info.role} fence ${f.index} failed: ${r.error.code} at ${r.error.cursor}: ${r.error.message}`).toBe("");
			if (!r.ok) continue;
			encodings.push(writeNode(c.compare === "attributes" ? r.value : stripNode(r.value)));
			checked += 1;
		} else if (f.info.role === "rejected") {
			const r = readNode(node, body);
			const expectKind = f.info.keys["expect"];
			const code = f.info.keys["diagnostic"];
			if (expectKind !== undefined) {
				expect(r.ok ? "" : `expected a ${expectKind}, got ${r.error.code}: ${r.error.message}`).toBe("");
				if (r.ok) expect(nodeKindOf(r.value)).toBe(expectKind);
			} else if (code !== undefined) {
				expect(r.ok ? `expected ${code}, but the fence decoded` : r.error.code).toBe(code);
			} else {
				expect("rejected fence carries neither diagnostic= nor expect=").toBe("");
			}
			checked += 1;
		}
	}
	if (canonical !== undefined) {
		const want = canonical.body.replace(/\n$/, "");
		for (const got of encodings) expect(got).toBe(want);
	} else {
		for (const got of encodings) expect(got).toBe(encodings[0] ?? got);
	}
}

describe.skipIf(kit === null)("Morphir Compatibility Kit (JSON fences)", () => {
	if (kit === null) return;
	test("the kit parses cleanly", () => {
		expect(kit.errors).toEqual([]);
	});
	let run = 0;
	for (const c of kit.cases) {
		if (c.status !== "active") { skipped += c.fences.length; continue; }
		if (c.version !== null && c.version !== 4) { skipped += c.fences.length; continue; }
		const node = c.node === null ? undefined : NODES.get(c.node);
		if (node === undefined) { console.log(`kit: skipping ${c.id} (node ${c.node ?? "unset"} not runnable in process yet)`); skipped += c.fences.length; continue; }
		run += 1;
		test(c.id, () => runCase(c, node));
	}
	test("summary", () => {
		console.log(`kit: ${run} cases run, ${checked} fences checked, ${skipped} fences skipped (yaml/text/version/pending)`);
		expect(run).toBeGreaterThan(20);
	});
});
