// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The drift guard for vocabulary.ts (ruling in plan 2b's global constraints):
// VOCABULARY is hand-written, so this test scans read-types.ts,
// read-values.ts, read-definitions.ts and read-distribution.ts for the variant
// names and member spellings the readers actually accept, and fails when it has
// drifted from them. It is the arbiter of completeness — extend it, watch it
// fail, then edit vocabulary.ts to match.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { VOCABULARY } from "./vocabulary.ts";

const READ_TYPES = readFileSync(path.join(import.meta.dir, "read-types.ts"), "utf8");
const READ_VALUES = readFileSync(path.join(import.meta.dir, "read-values.ts"), "utf8");
const READ_DEFINITIONS = readFileSync(path.join(import.meta.dir, "read-definitions.ts"), "utf8");
const READ_DISTRIBUTION = readFileSync(path.join(import.meta.dir, "read-distribution.ts"), "utf8");
const SOURCES: readonly (readonly [string, string])[] = [
	["read-types.ts", READ_TYPES],
	["read-values.ts", READ_VALUES],
	["read-definitions.ts", READ_DEFINITIONS],
	// The distribution reader owns the IRFile node's three variants and their
	// members; without it in this scan those entries had no drift guard at all.
	["read-distribution.ts", READ_DISTRIBUTION],
];

// A variant label is PascalCase by Morphir convention. The readers also
// accept a handful of lowercase access spellings ("pub", "public",
// "private") that are not variants; restricting the scan to labels starting
// with an uppercase letter excludes them without an explicit exclusion list
// for each one. The tradeoff: a future variant spelled lowercase (unlikely,
// given the convention, but not impossible) would silently miss this scan
// rather than fail loudly.
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
	// The attributes/attrs pair is read once, in expanded.ts's shared helper,
	// not per wrapper via windowed() — so it is not in the scanned files at
	// all and is asserted here for the two places it is modeled (Type/Record,
	// Value/Record).
	{ node: "Type", variant: "Record", member: "attrs" },
	{ node: "Value", variant: "Record", member: "attrs" },
	{ node: "AccessControlledTypeDefinition", variant: "Public", member: "value" },
	{ node: "AccessControlledTypeDefinition", variant: "Private", member: "value" },
	// The value twin goes through the same readAccessControlled/readDocumented
	// pair, so it accepts the same nested {doc,value} wrapper.
	{ node: "AccessControlledValueDefinition", variant: "Public", member: "value" },
	{ node: "AccessControlledValueDefinition", variant: "Private", member: "value" },
	// ValueDefinition's ExternalBody: the pre-decision-0008 top-level
	// "externalName"/"targetPlatform" pair, read as a one-entry "externals"
	// list by readExternals rather than through windowed().
	{ node: "ValueDefinition", variant: "ExternalBody", member: "externalName" },
	{ node: "ValueDefinition", variant: "ExternalBody", member: "targetPlatform" },
];

// Warn sites with no member representation in VOCABULARY at all: the legacy
// shape is the whole payload, not a named member, so there is no JSON key to
// model as a VocabularySpelling — the coverage rule can only ever look for
// object keys. The kit already exercises the shape via an
// `accepted warning=legacy_spelling` fence; this list just keeps the reader's
// warn site itself anchored, by variant and a source substring, so removing
// it still fails this test.
const WARN_ONLY_VARIANT_SITES: readonly { readonly node: string; readonly variant: string; readonly source: string; readonly sourceContains: string }[] = [
	{ node: "Type", variant: "Record", source: "read-types.ts", sourceContains: "isRecordPayload" },
	{ node: "Value", variant: "Record", source: "read-values.ts", sourceContains: "isRecordPayload" },
];

// Variants recognized by key membership (readValueDefinition's if/else over
// DEFINITION_KEYS) rather than a `case "<Label>":` switch, so the LABEL scan
// above cannot find them. Each is asserted here against a plain string
// literal in read-values.ts instead, so a rename still breaks this test.
const NON_LABEL_VARIANTS: readonly { readonly node: string; readonly variant: string; readonly source: string }[] = [
	{ node: "ValueDefinition", variant: "ExpressionBody", source: "read-values.ts" },
	{ node: "ValueDefinition", variant: "NativeBody", source: "read-values.ts" },
	{ node: "ValueDefinition", variant: "IncompleteBody", source: "read-values.ts" },
	{ node: "ValueDefinition", variant: "ExternalBody", source: "read-values.ts" },
	// readDistribution's DISTRIBUTION_KEYS list, checked with `includes`.
	{ node: "IRFile", variant: "Library", source: "read-distribution.ts" },
	{ node: "IRFile", variant: "Specs", source: "read-distribution.ts" },
	{ node: "IRFile", variant: "Application", source: "read-distribution.ts" },
];

// The IRFile members the distribution reader names, with the variants that
// carry each. Every one is canonical — this reader accepts no legacy spelling —
// so the windowed() scan cannot find them; they are anchored here against a
// plain string literal in read-distribution.ts instead.
const DISTRIBUTION_MEMBERS: readonly { readonly variant: string; readonly member: string }[] = [
	{ variant: "Library", member: "packageName" },
	{ variant: "Library", member: "dependencies" },
	{ variant: "Library", member: "def" },
	{ variant: "Specs", member: "packageName" },
	{ variant: "Specs", member: "dependencies" },
	{ variant: "Specs", member: "spec" },
	{ variant: "Application", member: "packageName" },
	{ variant: "Application", member: "dependencies" },
	{ variant: "Application", member: "def" },
	{ variant: "Application", member: "entryPoints" },
	{ variant: "Application", member: "doc" },
];
const SOURCE_BY_NAME = new Map(SOURCES);

describe("VOCABULARY drift guard", () => {
	test("every scanned case label is a VOCABULARY variant, or a listed non-variant label", () => {
		const variants = new Set(VOCABULARY.map((e) => e.variant));
		for (const label of ALL_LABELS) {
			if (NON_VARIANT_LABELS.includes(label)) continue;
			expect(variants.has(label), `label "${label}" is neither a VOCABULARY variant nor a NON_VARIANT_LABEL`).toBe(true);
		}
	});

	test("every VOCABULARY variant appears as a scanned case label, or is a listed non-label variant", () => {
		const nonLabel = new Set(NON_LABEL_VARIANTS.map((w) => `${w.node}/${w.variant}`));
		for (const entry of VOCABULARY) {
			if (nonLabel.has(`${entry.node}/${entry.variant}`)) continue;
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

	test("the non-label variants (ValueDefinition's body kinds) are present in VOCABULARY and still named in the readers", () => {
		for (const w of NON_LABEL_VARIANTS) {
			const entry = VOCABULARY.find((e) => e.node === w.node && e.variant === w.variant);
			expect(entry, `no VOCABULARY entry for ${w.node}/${w.variant}`).toBeDefined();
			const source = SOURCE_BY_NAME.get(w.source);
			expect(source, `no scanned source named "${w.source}"`).toBeDefined();
			expect(source).toContain(`"${w.variant}"`);
		}
	});

	test("the Record direct-field-map warn site is acknowledged without a fake member entry", () => {
		for (const w of WARN_ONLY_VARIANT_SITES) {
			const entry = VOCABULARY.find((e) => e.node === w.node && e.variant === w.variant);
			expect(entry, `no VOCABULARY entry for ${w.node}/${w.variant}`).toBeDefined();
			expect(entry?.members.some((m) => m.name === "<direct map>")).toBe(false);
			const source = SOURCE_BY_NAME.get(w.source);
			expect(source, `no scanned source named "${w.source}"`).toBeDefined();
			expect(source).toContain(w.sourceContains);
		}
	});

	test("every IRFile member is in VOCABULARY as canonical and still named in read-distribution.ts", () => {
		for (const w of DISTRIBUTION_MEMBERS) {
			const entry = VOCABULARY.find((e) => e.node === "IRFile" && e.variant === w.variant);
			expect(entry, `no VOCABULARY entry for IRFile/${w.variant}`).toBeDefined();
			expect(
				entry?.members.some((m) => m.name === w.member && m.spelling === "canonical"),
				`IRFile/${w.variant} is missing member "${w.member}"`,
			).toBe(true);
			expect(READ_DISTRIBUTION).toContain(`"${w.member}"`);
		}
		// And nothing extra: an entry whose members drift ahead of this list is
		// as much of a gap as one that drifts behind it.
		for (const entry of VOCABULARY.filter((e) => e.node === "IRFile")) {
			const listed = DISTRIBUTION_MEMBERS.filter((w) => w.variant === entry.variant).map((w) => w.member);
			expect([...entry.members].map((m) => m.name).sort()).toEqual([...listed].sort());
		}
	});

	test("the AccessControlled twins carry the same legacy wrapper member", () => {
		for (const node of ["AccessControlledTypeDefinition", "AccessControlledValueDefinition"] as const) {
			for (const variant of ["Public", "Private"] as const) {
				const entry = VOCABULARY.find((e) => e.node === node && e.variant === variant);
				expect(entry, `no VOCABULARY entry for ${node}/${variant}`).toBeDefined();
				expect(entry?.members.some((m) => m.name === "value" && m.spelling === "legacy")).toBe(true);
			}
		}
		expect(READ_DEFINITIONS).toContain("readAccessControlled");
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
