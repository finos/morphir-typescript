// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the coverage rule. Run with: bun test packages/mck/src/coverage/coverage.test.ts
import { describe, expect, test } from "bun:test";
import type { VocabularyEntry } from "../../../ir/src/versions/v4/vocabulary.ts";
import type { KitCase, KitFence } from "../kit/case.ts";
import type { Kit } from "../kit/load.ts";
import { coverageGaps, formatGap } from "./coverage.ts";

function fence(body: string, over: Partial<KitFence> = {}): KitFence {
	return { info: { language: "json", role: "canonical", keys: {} }, body, line: 1, index: 0, ...over };
}

function kitCase(over: Partial<KitCase> = {}): KitCase {
	return {
		id: "t-0001",
		topic: "t",
		number: 1,
		title: "a case",
		node: "Type",
		version: null,
		status: "active",
		compare: "stripped",
		prose: [],
		fences: [],
		file: "t.md",
		line: 1,
		...over,
	};
}

function kit(cases: readonly KitCase[]): Kit {
	return { cases, errors: [], files: ["t.md"], source: { label: "t", list: () => [], read: () => null, display: (p) => p } };
}

// A resolver that mimics the real one closely enough for these tests: the
// kit's node names pass through unchanged, and "Distribution" is the kit's
// alias for the reader's "IRFile".
const resolveNode = (name: string): string | null => (name === "Distribution" ? "IRFile" : name);

describe("coverageGaps", () => {
	test("a variant with no case in any active fence is a gap; a covered one is not", () => {
		const vocabulary: readonly VocabularyEntry[] = [
			{ node: "Type", variant: "Reference", members: [] },
			{ node: "Type", variant: "Tuple", members: [] },
		];
		const k = kit([kitCase({ fences: [fence('{ "Reference": ["a:b#c"] }')] })]);
		const gaps = coverageGaps(k, vocabulary, resolveNode);
		expect(gaps).toEqual([{ node: "Type", variant: "Tuple" }]);
	});

	test("a member spelling entry is covered when its accepted fence carries the legacy key, and gaps when it does not", () => {
		const vocabulary: readonly VocabularyEntry[] = [{ node: "Type", variant: "Function", members: [{ name: "arg", spelling: "legacy" }] }];
		const covered = kit([kitCase({ fences: [fence('{ "Function": { "arg": "a", "returnType": "b" } }')] })]);
		expect(coverageGaps(covered, vocabulary, resolveNode)).toEqual([]);

		const notCovered = kit([kitCase({ fences: [fence('{ "Function": { "parameterType": "a", "returnType": "b" } }')] })]);
		expect(coverageGaps(notCovered, vocabulary, resolveNode)).toEqual([{ node: "Type", variant: "Function", member: "arg" }]);
	});

	test("a pending case covers a variant when its title names it", () => {
		const vocabulary: readonly VocabularyEntry[] = [{ node: "Type", variant: "Tuple", members: [] }];
		const k = kit([kitCase({ id: "types-0009", title: "Tuple", status: "pending", fences: [] })]);
		expect(coverageGaps(k, vocabulary, resolveNode)).toEqual([]);
	});

	test("a pending case covers a member when its prose names it", () => {
		const vocabulary: readonly VocabularyEntry[] = [{ node: "Type", variant: "Function", members: [{ name: "arg", spelling: "legacy" }] }];
		const k = kit([kitCase({ id: "types-0010", title: "Function", status: "pending", prose: ["still needs the arg spelling"], fences: [] })]);
		expect(coverageGaps(k, vocabulary, resolveNode)).toEqual([]);
	});

	test("the kit's Distribution alias resolves to IRFile entries through resolveNode", () => {
		const vocabulary: readonly VocabularyEntry[] = [{ node: "IRFile", variant: "IRFile", members: [] }];
		const k = kit([kitCase({ node: "Distribution", fences: [fence('{ "IRFile": { "formatVersion": 4 } }')] })]);
		expect(coverageGaps(k, vocabulary, resolveNode)).toEqual([]);
	});

	test("a case whose node does not resolve is ignored, not a crash", () => {
		const vocabulary: readonly VocabularyEntry[] = [{ node: "Type", variant: "Tuple", members: [] }];
		const noResolve = (name: string): string | null => (name === "Distribution" ? "IRFile" : name === "Type" ? null : name);
		const k = kit([kitCase({ node: "Type", fences: [fence('{ "Tuple": [1, 2] }')] })]);
		expect(coverageGaps(k, vocabulary, noResolve)).toEqual([{ node: "Type", variant: "Tuple" }]);
	});

	test("an unambiguous variant is covered by a fence nested in a case of a different node kind", () => {
		// TypeAliasDefinition only ever appears under node "TypeDefinition" in
		// the manifest, so it is unambiguous even though the kit case that
		// exercises it is tagged node=AccessControlledTypeDefinition (its own
		// access-controlled wrapper nests a TypeDefinition's tag inside).
		const vocabulary: readonly VocabularyEntry[] = [{ node: "TypeDefinition", variant: "TypeAliasDefinition", members: [] }];
		const k = kit([
			kitCase({
				node: "AccessControlledTypeDefinition",
				fences: [fence('{ "Public": { "TypeAliasDefinition": { "typeParams": [], "typeExp": "a" } } }')],
			}),
		]);
		expect(coverageGaps(k, vocabulary, resolveNode)).toEqual([]);
	});

	test("an ambiguous variant is still a gap when only a different node kind's case carries the tag", () => {
		// "Record" is a variant of both Type and Value in the real manifest;
		// putting it under two nodes here reproduces that ambiguity.
		const vocabulary: readonly VocabularyEntry[] = [
			{ node: "Type", variant: "Record", members: [] },
			{ node: "Value", variant: "Record", members: [] },
		];
		const k = kit([kitCase({ node: "Value", fences: [fence('{ "Record": { "fields": { "a": 1 } } }')] })]);
		const gaps = coverageGaps(k, vocabulary, resolveNode);
		expect(gaps).toEqual([{ node: "Type", variant: "Record" }]);
	});

	test("a member spelling is still a gap when only a different node kind's case carries it", () => {
		const vocabulary: readonly VocabularyEntry[] = [{ node: "Type", variant: "Function", members: [{ name: "arg", spelling: "legacy" }] }];
		const k = kit([kitCase({ node: "Value", fences: [fence('{ "Function": { "arg": "a", "returnType": "b" } }')] })]);
		const gaps = coverageGaps(k, vocabulary, resolveNode);
		expect(gaps).toEqual([{ node: "Type", variant: "Function", member: "arg" }]);
	});

	test("formatGap formats a variant gap and a member gap", () => {
		expect(formatGap({ node: "Value", variant: "Destructure" })).toBe("Value/Destructure has no case");
		expect(formatGap({ node: "Type", variant: "Function", member: "arg" })).toBe("Type/Function member arg has no case");
	});
});
