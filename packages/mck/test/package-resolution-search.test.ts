// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { resolveLibrary } from "../src/index.ts";
import { parseResolutionInput } from "../src/package/resolution/parse.ts";
import { searchInitialLibrary } from "../src/package/resolution/search.ts";

const digest = (digit: string) => `sha256:${digit.repeat(64)}`;

type ReleaseIdLiteral = { packagePath: string; version: string };
type RequirementLiteral = {
	irPackageName: string;
	packagePath: string;
	versionRange: { minimumInclusive: string; maximumExclusive: string };
};
type ReleaseRecordLiteral = {
	release: ReleaseIdLiteral;
	irPackageName: string;
	manifestDigest: string;
	contentDigest: string;
	dependencies: RequirementLiteral[];
};
type CatalogLiteral = { packagePath: string; releases: ReleaseRecordLiteral[] };
type InitialLiteral = {
	formatVersion: "0.1.0-draft.2";
	capability: "flat-library";
	root: ReleaseRecordLiteral;
	mode: "initial";
	catalogs: CatalogLiteral[];
};

const id = (packagePath: string, version = "1.0.0"): ReleaseIdLiteral => ({ packagePath, version });

const requirement = (irPackageName: string, packagePath: string, minimumInclusive = "1.0.0", maximumExclusive = "2.0.0"): RequirementLiteral => ({
	irPackageName,
	packagePath,
	versionRange: { minimumInclusive, maximumExclusive },
});

const record = (packagePath: string, version: string, irPackageName: string, dependencies: RequirementLiteral[] = []): ReleaseRecordLiteral => ({
	release: id(packagePath, version),
	irPackageName,
	manifestDigest: digest("0"),
	contentDigest: digest("1"),
	dependencies,
});

const catalog = (packagePath: string, releases: ReleaseRecordLiteral[]): CatalogLiteral => ({ packagePath, releases });

function initial(rootDependencies: RequirementLiteral[], catalogs: CatalogLiteral[]): InitialLiteral {
	return {
		formatVersion: "0.1.0-draft.2",
		capability: "flat-library",
		root: record("example.com/app/root", "1.0.0", "example/app", rootDependencies),
		mode: "initial",
		catalogs,
	};
}

function selected(input: InitialLiteral) {
	const result = resolveLibrary(JSON.stringify(input));
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(`expected selection, received ${result.diagnostic.code}`);
	return result.graph;
}

function selectedIds(input: InitialLiteral): ReleaseIdLiteral[] {
	return selected(input).nodes.map((node) => node.release);
}

describe("resolveLibrary initial search", () => {
	test("selects the highest eligible release in the literal fixed seed", () => {
		const eligibilityPath = "example.com/finance/eligibility";
		const input = initial(
			[requirement("example/eligibility", eligibilityPath)],
			[catalog(eligibilityPath, [record(eligibilityPath, "1.2.0", "example/eligibility"), record(eligibilityPath, "1.3.0", "example/eligibility")])],
		);

		expect(selectedIds(input)).toEqual([id("example.com/app/root"), id(eligibilityPath, "1.3.0")]);
	});

	test("backtracks from the highest fixed-seed release when its helper interval has no candidate", () => {
		const eligibilityPath = "example.com/finance/eligibility";
		const helperPath = "example.com/finance/helper";
		const input = initial(
			[requirement("example/eligibility", eligibilityPath)],
			[
				catalog(eligibilityPath, [
					record(eligibilityPath, "1.2.0", "example/eligibility", [requirement("example/helper", helperPath, "1.0.0", "2.0.0")]),
					record(eligibilityPath, "1.3.0", "example/eligibility", [requirement("example/helper", helperPath, "2.0.0", "3.0.0")]),
				]),
				catalog(helperPath, [record(helperPath, "1.5.0", "example/helper")]),
			],
		);

		expect(selectedIds(input)).toEqual([id("example.com/app/root"), id(eligibilityPath, "1.2.0"), id(helperPath, "1.5.0")]);
	});

	test("resolves overlapping diamond constraints to one flat release", () => {
		const leftPath = "example.com/lib/left";
		const rightPath = "example.com/lib/right";
		const sharedPath = "example.com/lib/shared";
		const input = initial(
			[requirement("example/left", leftPath), requirement("example/right", rightPath)],
			[
				catalog(leftPath, [record(leftPath, "1.0.0", "example/left", [requirement("example/shared", sharedPath, "1.0.0", "3.0.0")])]),
				catalog(rightPath, [record(rightPath, "1.0.0", "example/right", [requirement("example/shared", sharedPath, "2.0.0", "4.0.0")])]),
				catalog(sharedPath, [record(sharedPath, "2.9.0", "example/shared"), record(sharedPath, "2.5.0", "example/shared")]),
			],
		);

		expect(selectedIds(input)).toEqual([id("example.com/app/root"), id(leftPath), id(rightPath), id(sharedPath, "2.9.0")]);
		const sharedBindings = selected(input)
			.nodes.flatMap((node) => node.bindings)
			.filter((binding) => binding.irPackageName === "example/shared");
		expect(sharedBindings).toEqual([
			{ irPackageName: "example/shared", target: id(sharedPath, "2.9.0") },
			{ irPackageName: "example/shared", target: id(sharedPath, "2.9.0") },
		]);
	});

	test("backtracks an earlier shared assignment when a later consumer adds a narrower interval", () => {
		const sharedPath = "example.com/aaa/shared";
		const consumerPath = "example.com/zulu/consumer";
		const input = initial(
			[requirement("example/shared", sharedPath), requirement("example/consumer", consumerPath)],
			[
				catalog(sharedPath, [record(sharedPath, "1.5.0", "example/shared"), record(sharedPath, "1.2.0", "example/shared")]),
				catalog(consumerPath, [record(consumerPath, "1.0.0", "example/consumer", [requirement("example/shared", sharedPath, "1.0.0", "1.3.0")])]),
			],
		);

		expect(selectedIds(input)).toEqual([id("example.com/app/root"), id(sharedPath, "1.2.0"), id(consumerPath)]);
	});

	test("returns no flat selection internally and diagnoses incompatible consumer intervals as unsupported coexistence", () => {
		const leftPath = "example.com/lib/left";
		const rightPath = "example.com/lib/right";
		const sharedPath = "example.com/lib/shared";
		const input = initial(
			[requirement("example/left", leftPath), requirement("example/right", rightPath)],
			[
				catalog(leftPath, [record(leftPath, "1.0.0", "example/left", [requirement("example/shared", sharedPath, "1.0.0", "2.0.0")])]),
				catalog(rightPath, [record(rightPath, "1.0.0", "example/right", [requirement("example/shared", sharedPath, "2.0.0", "3.0.0")])]),
				catalog(sharedPath, [record(sharedPath, "1.5.0", "example/shared"), record(sharedPath, "2.5.0", "example/shared")]),
			],
		);
		const parsed = parseResolutionInput(JSON.stringify(input));
		if (!parsed.ok || parsed.value.mode !== "initial") throw new Error("fixture did not parse as initial input");

		expect(searchInitialLibrary(parsed.value)).toEqual({ kind: "no-selection" });
		expect(resolveLibrary(JSON.stringify(input))).toMatchObject({
			ok: false,
			diagnostic: { code: "unsupported-capability", requiredCapabilities: ["graph-aware-coexistence"] },
		});
	});

	test("rejects a selected cycle but permits an acyclic lower-version fallback", () => {
		const providerPath = "example.com/lib/provider";
		const input = initial(
			[requirement("example/provider", providerPath, "1.0.0", "3.0.0")],
			[
				catalog(providerPath, [
					record(providerPath, "2.0.0", "example/provider", [requirement("example/app", "example.com/app/root")]),
					record(providerPath, "1.0.0", "example/provider"),
				]),
			],
		);

		expect(selectedIds(input)).toEqual([id("example.com/app/root"), id(providerPath, "1.0.0")]);
	});

	test("rejects two selected PackagePaths exposing the same IR package name", () => {
		const alphaPath = "example.com/lib/alpha";
		const betaPath = "example.com/lib/beta";
		const brokerPath = "example.com/lib/broker";
		const input = initial(
			[requirement("example/shared", alphaPath), requirement("example/broker", brokerPath)],
			[
				catalog(alphaPath, [record(alphaPath, "1.0.0", "example/shared")]),
				catalog(brokerPath, [record(brokerPath, "1.0.0", "example/broker", [requirement("example/shared", betaPath)])]),
				catalog(betaPath, [record(betaPath, "1.0.0", "example/shared")]),
			],
		);
		const parsed = parseResolutionInput(JSON.stringify(input));
		if (!parsed.ok || parsed.value.mode !== "initial") throw new Error("fixture did not parse as initial input");
		expect(searchInitialLibrary(parsed.value)).toEqual({ kind: "no-selection" });
	});

	test("chooses the canonical minimum across graphs with different package sets", () => {
		const providerPath = "example.com/lib/provider";
		const earlyPath = "example.com/aaa/early";
		const latePath = "example.com/zzz/late";
		const input = initial(
			[requirement("example/provider", providerPath, "1.0.0", "3.0.0")],
			[
				catalog(providerPath, [
					record(providerPath, "2.0.0", "example/provider", [requirement("example/late", latePath)]),
					record(providerPath, "1.0.0", "example/provider", [requirement("example/early", earlyPath)]),
				]),
				catalog(earlyPath, [record(earlyPath, "1.0.0", "example/early")]),
				catalog(latePath, [record(latePath, "1.0.0", "example/late")]),
			],
		);

		expect(selectedIds(input)).toEqual([id("example.com/app/root"), id(earlyPath), id(providerPath, "1.0.0")]);
	});

	test("reports every missing catalog in the full reachable candidate universe", () => {
		const providerPath = "example.com/lib/provider";
		const missingA = "example.com/missing/alpha";
		const missingZ = "example.com/missing/zulu";
		const input = initial(
			[requirement("example/provider", providerPath)],
			[
				catalog(providerPath, [
					record(providerPath, "1.0.0", "example/provider"),
					record(providerPath, "1.5.0", "example/provider", [requirement("example/zulu", missingZ), requirement("example/alpha", missingA)]),
				]),
				catalog("example.com/unreachable/extra", [
					record("example.com/unreachable/extra", "1.0.0", "example/extra", [requirement("example/ignored", "example.com/missing/ignored")]),
				]),
			],
		);

		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "incomplete-input",
				missing: [
					{ kind: "catalog", packagePath: missingA },
					{ kind: "catalog", packagePath: missingZ },
				],
			},
		});
	});

	test("traverses supplied root-path alternatives when a dependency reaches the fixed root path", () => {
		const rootPath = "example.com/app/root";
		const providerPath = "example.com/lib/provider";
		const missingPath = "example.com/lib/missing";
		const input = initial(
			[requirement("example/provider", providerPath)],
			[
				catalog(providerPath, [record(providerPath, "1.0.0", "example/provider", [requirement("example/app", rootPath, "2.0.0", "3.0.0")])]),
				catalog(rootPath, [record(rootPath, "2.0.0", "example/app", [requirement("example/missing", missingPath)])]),
			],
		);

		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: { code: "incomplete-input", missing: [{ kind: "catalog", packagePath: missingPath }] },
		});
	});

	test("treats a present empty reachable catalog as complete but infeasible", () => {
		const providerPath = "example.com/lib/provider";
		const input = initial([requirement("example/provider", providerPath)], [catalog(providerPath, [])]);
		const parsed = parseResolutionInput(JSON.stringify(input));
		if (!parsed.ok || parsed.value.mode !== "initial") throw new Error("fixture did not parse as initial input");
		expect(searchInitialLibrary(parsed.value)).toEqual({ kind: "no-selection" });
	});

	test("excludes unreachable catalog releases from a successful graph", () => {
		const providerPath = "example.com/lib/provider";
		const extraPath = "example.com/unreachable/extra";
		const input = initial(
			[requirement("example/provider", providerPath)],
			[catalog(providerPath, [record(providerPath, "1.0.0", "example/provider")]), catalog(extraPath, [record(extraPath, "9.0.0", "example/extra")])],
		);
		expect(selectedIds(input)).toEqual([id("example.com/app/root"), id(providerPath)]);
	});

	test("is invariant under catalog, release, and requirement permutations", () => {
		const providerPath = "example.com/lib/provider";
		const helperPath = "example.com/lib/helper";
		const extraPath = "example.com/lib/extra";
		const provider = [
			record(providerPath, "1.0.0", "example/provider", [requirement("example/extra", extraPath), requirement("example/helper", helperPath)]),
			record(providerPath, "2.0.0", "example/provider", [requirement("example/helper", helperPath), requirement("example/extra", extraPath)]),
		];
		const catalogs = [
			catalog(providerPath, provider),
			catalog(helperPath, [record(helperPath, "1.0.0", "example/helper"), record(helperPath, "1.5.0", "example/helper")]),
			catalog(extraPath, [record(extraPath, "1.0.0", "example/extra")]),
		];
		const forward = initial([requirement("example/provider", providerPath)], catalogs);
		const reverse = initial(
			[requirement("example/provider", providerPath)],
			[...catalogs].reverse().map((entry) => ({
				...entry,
				releases: [...entry.releases].reverse().map((release) => ({ ...release, dependencies: [...release.dependencies].reverse() })),
			})),
		);

		expect(selected(reverse)).toEqual(selected(forward));
	});
});
