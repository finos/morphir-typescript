// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The drift guard for vocabulary.ts (ruling in plan 2b's global constraints):
// VOCABULARY is hand-written, so this test scans read-types.ts,
// read-values.ts and read-definitions.ts for the variant names and member
// spellings the readers actually accept, and fails when VOCABULARY has
// drifted from them. It is the arbiter of completeness — extend it, watch it
// fail, then edit vocabulary.ts to match.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { VOCABULARY } from "./vocabulary.ts";

const READ_TYPES = readFileSync(path.join(import.meta.dir, "read-types.ts"), "utf8");
const READ_VALUES = readFileSync(path.join(import.meta.dir, "read-values.ts"), "utf8");
const READ_DEFINITIONS = readFileSync(path.join(import.meta.dir, "read-definitions.ts"), "utf8");
const SOURCES: readonly (readonly [string, string])[] = [
	["read-types.ts", READ_TYPES],
	["read-values.ts", READ_VALUES],
	["read-definitions.ts", READ_DEFINITIONS],
];

// A variant label is PascalCase by Morphir convention. The readers also
// accept a handful of lowercase access spellings ("pub", "public",
// "private") that are not variants; restricting the scan to labels starting
// with an uppercase letter excludes them without an explicit exclusion list
// for each one.
const LABEL = /case\s+"([A-Z][A-Za-z0-9]*)"\s*:/g;

function scanLabels(source: string): ReadonlySet<string> {
	return new Set([...source.matchAll(LABEL)].map((m) => m[1] as string));
}

const ALL_LABELS = new Set<string>();
for (const [, source] of SOURCES) for (const label of scanLabels(source)) ALL_LABELS.add(label);

// windowed(ctx, m, "<canonical>", "<legacy>", ...) pairs one canonical member
// name with the legacy spelling it replaces.
const WINDOWED = /windowed\([^,]+,\s*[^,]+,\s*"([A-Za-z0-9]+)",\s*"([A-Za-z0-9]+)"/g;

interface WindowedPair {
	readonly canonical: string;
	readonly legacy: string;
}

function scanWindowed(source: string): readonly WindowedPair[] {
	return [...source.matchAll(WINDOWED)].map((m) => ({ canonical: m[1] as string, legacy: m[2] as string }));
}

const ALL_WINDOWED: WindowedPair[] = [];
for (const [, source] of SOURCES) ALL_WINDOWED.push(...scanWindowed(source));

// "pub" is an access spelling, not a variant. The seven literal kinds
// (BoolLiteral, CharLiteral, StringLiteral, IntegerLiteral,
// WholeNumberLiteral, FloatLiteral, DecimalLiteral) are variants of the
// Literal node and must NOT be listed here — they are checked like every
// other variant below.
const NON_VARIANT_LABELS: readonly string[] = ["pub"];

// Legacy shapes the readers accept without going through windowed(), so the
// regex scan above cannot find them. Each is asserted here by hand, plus a
// source substring check so removing the behavior still fails this test.
const WARN_ONLY_LEGACY: readonly { readonly node: string; readonly variant: string; readonly member: string }[] = [
	{ node: "Type", variant: "Function", member: "arg" },
	{ node: "Type", variant: "Record", member: "<direct map>" },
	{ node: "Value", variant: "Record", member: "<direct map>" },
	// The attributes/attrs pair is read once, in expanded.ts's shared helper,
	// not per wrapper via windowed() — so it is not in the scanned files at
	// all and is asserted here for the two places it is modeled (Type/Record,
	// Value/Record).
	{ node: "Type", variant: "Record", member: "attrs" },
	{ node: "Value", variant: "Record", member: "attrs" },
	{ node: "AccessControlledTypeDefinition", variant: "Public", member: "value" },
	{ node: "AccessControlledTypeDefinition", variant: "Private", member: "value" },
];

describe("VOCABULARY drift guard", () => {
	test("every scanned case label is a VOCABULARY variant, or a listed non-variant label", () => {
		const variants = new Set(VOCABULARY.map((e) => e.variant));
		for (const label of ALL_LABELS) {
			if (NON_VARIANT_LABELS.includes(label)) continue;
			expect(variants.has(label), `label "${label}" is neither a VOCABULARY variant nor a NON_VARIANT_LABEL`).toBe(true);
		}
	});

	test("every VOCABULARY variant appears as a scanned case label", () => {
		for (const entry of VOCABULARY) {
			expect(ALL_LABELS.has(entry.variant), `VOCABULARY entry ${entry.node}/${entry.variant} has no matching case label`).toBe(true);
		}
	});

	test("every windowed() legacy name is a legacy member of some VOCABULARY entry", () => {
		const legacyMembers = new Set<string>();
		for (const entry of VOCABULARY) for (const m of entry.members) if (m.spelling === "legacy") legacyMembers.add(m.name);
		for (const pair of ALL_WINDOWED) {
			expect(legacyMembers.has(pair.legacy), `windowed legacy member "${pair.legacy}" (canonical "${pair.canonical}") is not in VOCABULARY`).toBe(true);
		}
	});

	test("every legacy member in VOCABULARY is a windowed() pair or a known warn-only shape", () => {
		const windowedLegacy = new Set(ALL_WINDOWED.map((p) => p.legacy));
		const warnOnly = new Set(WARN_ONLY_LEGACY.map((w) => w.member));
		for (const entry of VOCABULARY) {
			for (const m of entry.members) {
				if (m.spelling !== "legacy") continue;
				const known = windowedLegacy.has(m.name) || warnOnly.has(m.name);
				expect(known, `VOCABULARY legacy member ${entry.node}/${entry.variant}/${m.name} is absent from the readers`).toBe(true);
			}
		}
	});

	test("the warn-only legacy shapes are present in VOCABULARY, and still in the readers", () => {
		for (const w of WARN_ONLY_LEGACY) {
			const entry = VOCABULARY.find((e) => e.node === w.node && e.variant === w.variant);
			expect(entry, `no VOCABULARY entry for ${w.node}/${w.variant}`).toBeDefined();
			expect(entry?.members.some((m) => m.name === w.member && m.spelling === "legacy")).toBe(true);
		}
		expect(READ_TYPES).toContain('"arg"');
		expect(READ_TYPES).toContain("isRecordPayload");
		expect(READ_VALUES).toContain("isRecordPayload");
		expect(READ_DEFINITIONS).toContain('"doc"');
	});

	test("attributes/attrs is modeled once under Type/Record and once under Value/Record", () => {
		for (const node of ["Type", "Value"] as const) {
			const entry = VOCABULARY.find((e) => e.node === node && e.variant === "Record");
			expect(entry, `no VOCABULARY entry for ${node}/Record`).toBeDefined();
			expect(entry?.members.some((m) => m.name === "attributes" && m.spelling === "canonical")).toBe(true);
			expect(entry?.members.some((m) => m.name === "attrs" && m.spelling === "legacy")).toBe(true);
		}
	});
});
