// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { resolveLibrary } from "../src/index.ts";

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
type BindingLiteral = { irPackageName: string; target: ReleaseIdLiteral };
type LockedNodeLiteral = Omit<ReleaseRecordLiteral, "dependencies"> & { bindings: BindingLiteral[] };
type TargetLiteral = { kind: "eligible"; packagePath: string } | { kind: "exact"; packagePath: string; version: string };
type InitialLiteral = {
	formatVersion: "0.1.0-draft.2";
	capability: "flat-library";
	root: ReleaseRecordLiteral;
	mode: "initial";
	catalogs: CatalogLiteral[];
};
type UpdateLiteral = Omit<InitialLiteral, "mode"> & {
	mode: "update";
	lock: { root: ReleaseIdLiteral; nodes: LockedNodeLiteral[] };
	targets: TargetLiteral[];
};

const rootPath = "example.com/app/root";
const targetPath = "example.com/pkg/target";
const reportingPath = "example.com/pkg/reporting";
const sharedPath = "example.com/pkg/shared";

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

const binding = (metadata: ReleaseRecordLiteral): BindingLiteral => ({ irPackageName: metadata.irPackageName, target: { ...metadata.release } });

const node = (metadata: ReleaseRecordLiteral, bindings: BindingLiteral[] = []): LockedNodeLiteral => ({
	release: { ...metadata.release },
	irPackageName: metadata.irPackageName,
	manifestDigest: metadata.manifestDigest,
	contentDigest: metadata.contentDigest,
	bindings,
});

function initial(root: ReleaseRecordLiteral, catalogs: CatalogLiteral[]): InitialLiteral {
	return { formatVersion: "0.1.0-draft.2", capability: "flat-library", root, mode: "initial", catalogs };
}

function update(options: {
	root: ReleaseRecordLiteral;
	catalogs: CatalogLiteral[];
	oldRecords: ReleaseRecordLiteral[];
	oldBindings: ReadonlyMap<string, ReleaseRecordLiteral[]>;
	targets: TargetLiteral[];
}): UpdateLiteral {
	return {
		formatVersion: "0.1.0-draft.2",
		capability: "flat-library",
		root: options.root,
		mode: "update",
		catalogs: options.catalogs,
		lock: {
			root: { ...options.root.release },
			nodes: [options.root, ...options.oldRecords].map((metadata) =>
				node(metadata, (options.oldBindings.get(metadata.release.packagePath) ?? []).map(binding)),
			),
		},
		targets: options.targets,
	};
}

const witnessNode = (occurrence: string[], release: ReleaseIdLiteral, bindings: { irPackageName: string; targetOccurrence: string[] }[] = []) => ({
	occurrence,
	release,
	bindings,
});

describe("resolution failure diagnostics", () => {
	test("reports a complete empty candidate problem as normalized unsatisfiable evidence", () => {
		const alphaPath = "example.com/pkg/alpha";
		const zuluPath = "example.com/pkg/zulu";
		const extraPath = "example.com/pkg/unreachable";
		const root = record(rootPath, "1.0.0", "example/app", [requirement("example/zulu", zuluPath), requirement("example/alpha", alphaPath)]);
		const alpha20 = record(alphaPath, "2.0.0", "example/alpha");
		const alpha10 = record(alphaPath, "1.0.0", "example/alpha");
		const input = initial(root, [
			catalog(zuluPath, []),
			catalog(extraPath, [record(extraPath, "9.0.0", "example/extra")]),
			catalog(alphaPath, [alpha10, alpha20]),
		]);

		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "unsatisfiable-requirements",
				root: { ...root, dependencies: [...root.dependencies].reverse() },
				catalogs: [catalog(alphaPath, [alpha20, alpha10]), catalog(zuluPath, [])],
				targets: [],
			},
		});
	});

	test("classifies a newer outside-scope pin that admits the exact target as a scope conflict and fully unfolds the shared release", () => {
		const shared12 = record(sharedPath, "1.2.0", "example/shared");
		const shared14 = record(sharedPath, "1.4.0", "example/shared");
		const target10 = record(targetPath, "1.0.0", "example/target", [requirement("example/shared", sharedPath, "1.0.0", "2.0.0")]);
		const target20 = record(targetPath, "2.0.0", "example/target", [requirement("example/shared", sharedPath, "1.4.0", "2.0.0")]);
		const reporting10 = record(reportingPath, "1.0.0", "example/reporting", [requirement("example/shared", sharedPath, "1.2.0", "1.3.0")]);
		const reporting11 = record(reportingPath, "1.1.0", "example/reporting", [requirement("example/shared", sharedPath, "1.4.0", "2.0.0")]);
		const root = record(rootPath, "1.0.0", "example/app", [
			requirement("example/target", targetPath, "1.0.0", "3.0.0"),
			requirement("example/reporting", reportingPath),
		]);
		const input = update({
			root,
			catalogs: [catalog(targetPath, [target10, target20]), catalog(reportingPath, [reporting10, reporting11]), catalog(sharedPath, [shared12, shared14])],
			oldRecords: [target10, reporting10, shared12],
			oldBindings: new Map([
				[rootPath, [target10, reporting10]],
				[targetPath, [shared12]],
				[reportingPath, [shared12]],
			]),
			targets: [{ kind: "exact", packagePath: targetPath, version: "2.0.0" }],
		});

		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "update-scope-conflict",
				changedPins: [{ kind: "changed", previous: id(reportingPath), selected: id(reportingPath, "1.1.0") }],
				witness: {
					nodes: [
						witnessNode([], id(rootPath), [
							{ irPackageName: "example/reporting", targetOccurrence: ["example/reporting"] },
							{ irPackageName: "example/target", targetOccurrence: ["example/target"] },
						]),
						witnessNode(["example/reporting"], id(reportingPath, "1.1.0"), [
							{ irPackageName: "example/shared", targetOccurrence: ["example/reporting", "example/shared"] },
						]),
						witnessNode(["example/reporting", "example/shared"], id(sharedPath, "1.4.0")),
						witnessNode(["example/target"], id(targetPath, "2.0.0"), [
							{ irPackageName: "example/shared", targetOccurrence: ["example/target", "example/shared"] },
						]),
						witnessNode(["example/target", "example/shared"], id(sharedPath, "1.4.0")),
					],
				},
			},
		});
	});

	test("classifies disjoint consumer eligibility as unsupported coexistence and preserves occurrence evidence under permutations", () => {
		const alphaPath = "example.com/pkg/alpha";
		const betaPath = "example.com/pkg/beta";
		const alpha = record(alphaPath, "1.0.0", "example/alpha", [requirement("example/shared", sharedPath, "1.0.0", "2.0.0")]);
		const beta = record(betaPath, "1.0.0", "example/beta", [requirement("example/shared", sharedPath, "2.0.0", "3.0.0")]);
		const shared15 = record(sharedPath, "1.5.0", "example/shared");
		const shared25 = record(sharedPath, "2.5.0", "example/shared");
		const root = record(rootPath, "1.0.0", "example/app", [requirement("example/beta", betaPath), requirement("example/alpha", alphaPath)]);
		const forward = initial(root, [catalog(betaPath, [beta]), catalog(sharedPath, [shared15, shared25]), catalog(alphaPath, [alpha])]);
		const reverse = initial(
			{ ...root, dependencies: [...root.dependencies].reverse() },
			[...forward.catalogs].reverse().map((entry) => ({ ...entry, releases: [...entry.releases].reverse() })),
		);
		const expected = {
			ok: false as const,
			diagnostic: {
				code: "unsupported-capability" as const,
				requiredCapabilities: ["graph-aware-coexistence"] as const,
				changedPins: [],
				witness: {
					nodes: [
						witnessNode([], id(rootPath), [
							{ irPackageName: "example/alpha", targetOccurrence: ["example/alpha"] },
							{ irPackageName: "example/beta", targetOccurrence: ["example/beta"] },
						]),
						witnessNode(["example/alpha"], id(alphaPath), [{ irPackageName: "example/shared", targetOccurrence: ["example/alpha", "example/shared"] }]),
						witnessNode(["example/alpha", "example/shared"], id(sharedPath, "1.5.0")),
						witnessNode(["example/beta"], id(betaPath), [{ irPackageName: "example/shared", targetOccurrence: ["example/beta", "example/shared"] }]),
						witnessNode(["example/beta", "example/shared"], id(sharedPath, "2.5.0")),
					],
				},
			},
		};
		expect(resolveLibrary(JSON.stringify(forward))).toEqual(expected);
		expect(resolveLibrary(JSON.stringify(reverse))).toEqual(expected);
	});

	test("ranks coexistence witnesses by the unfolded release-identity list including repeated paths", () => {
		const alphaPath = "example.com/pkg/alpha";
		const betaPath = "example.com/pkg/beta";
		const alpha = record(alphaPath, "1.0.0", "example/alpha", [requirement("example/shared", sharedPath, "1.0.0", "3.0.0")]);
		const beta = record(betaPath, "1.0.0", "example/beta", [requirement("example/shared", sharedPath, "3.0.0", "5.0.0")]);
		const root = record(rootPath, "1.0.0", "example/app", [requirement("example/alpha", alphaPath), requirement("example/beta", betaPath)]);
		const input = initial(root, [
			catalog(alphaPath, [alpha]),
			catalog(betaPath, [beta]),
			catalog(sharedPath, [
				record(sharedPath, "1.5.0", "example/shared"),
				record(sharedPath, "2.5.0", "example/shared"),
				record(sharedPath, "3.5.0", "example/shared"),
				record(sharedPath, "4.5.0", "example/shared"),
			]),
		]);
		const result = resolveLibrary(JSON.stringify(input));
		expect(result).toMatchObject({ ok: false, diagnostic: { code: "unsupported-capability" } });
		if (result.ok || result.diagnostic.code !== "unsupported-capability") throw new Error("expected unsupported coexistence");
		expect(
			result.diagnostic.witness.nodes
				.filter((entry) => entry.release.packagePath === sharedPath)
				.map((entry) => ({ occurrence: entry.occurrence, version: entry.release.version })),
		).toEqual([
			{ occurrence: ["example/alpha", "example/shared"], version: "2.5.0" },
			{ occurrence: ["example/beta", "example/shared"], version: "4.5.0" },
		]);
	});

	test("retains repeated exact identities when their multiplicity changes the canonical winner", () => {
		const rankedSharedPath = "a.example/pkg/shared";
		const alphaPath = "m.example/pkg/alpha";
		const betaPath = "m.example/pkg/beta";
		const gammaPath = "m.example/pkg/gamma";
		const selectorPath = "z.example/pkg/selector";
		const shared10 = record(rankedSharedPath, "1.0.0", "example/shared");
		const shared20 = record(rankedSharedPath, "2.0.0", "example/shared");
		const shared1 = requirement("example/shared", rankedSharedPath, "1.0.0", "2.0.0");
		const shared2 = requirement("example/shared", rankedSharedPath, "2.0.0", "3.0.0");
		const alpha10 = record(alphaPath, "1.0.0", "example/alpha", [shared1]);
		const alpha20 = record(alphaPath, "2.0.0", "example/alpha", [shared1]);
		const beta10 = record(betaPath, "1.0.0", "example/beta", [shared2]);
		const beta20 = record(betaPath, "2.0.0", "example/beta", [shared1]);
		const gamma10 = record(gammaPath, "1.0.0", "example/gamma", [shared2]);
		const gamma20 = record(gammaPath, "2.0.0", "example/gamma", [shared2]);
		const selector10 = record(selectorPath, "1.0.0", "example/selector", [
			requirement("example/alpha", alphaPath, "2.0.0", "3.0.0"),
			requirement("example/beta", betaPath, "2.0.0", "3.0.0"),
			requirement("example/gamma", gammaPath, "2.0.0", "3.0.0"),
		]);
		const selector20 = record(selectorPath, "2.0.0", "example/selector", [
			requirement("example/alpha", alphaPath, "1.0.0", "2.0.0"),
			requirement("example/beta", betaPath, "1.0.0", "2.0.0"),
			requirement("example/gamma", gammaPath, "1.0.0", "2.0.0"),
		]);
		const root = record(rootPath, "1.0.0", "example/app", [requirement("example/selector", selectorPath, "1.0.0", "3.0.0")]);
		const input = initial(root, [
			catalog(selectorPath, [selector10, selector20]),
			catalog(gammaPath, [gamma10, gamma20]),
			catalog(rankedSharedPath, [shared10, shared20]),
			catalog(alphaPath, [alpha10, alpha20]),
			catalog(betaPath, [beta10, beta20]),
		]);

		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "unsupported-capability",
				requiredCapabilities: ["graph-aware-coexistence"],
				changedPins: [],
				witness: {
					nodes: [
						witnessNode([], id(rootPath), [{ irPackageName: "example/selector", targetOccurrence: ["example/selector"] }]),
						witnessNode(["example/selector"], id(selectorPath, "2.0.0"), [
							{ irPackageName: "example/alpha", targetOccurrence: ["example/selector", "example/alpha"] },
							{ irPackageName: "example/beta", targetOccurrence: ["example/selector", "example/beta"] },
							{ irPackageName: "example/gamma", targetOccurrence: ["example/selector", "example/gamma"] },
						]),
						witnessNode(["example/selector", "example/alpha"], id(alphaPath), [
							{ irPackageName: "example/shared", targetOccurrence: ["example/selector", "example/alpha", "example/shared"] },
						]),
						witnessNode(["example/selector", "example/alpha", "example/shared"], id(rankedSharedPath)),
						witnessNode(["example/selector", "example/beta"], id(betaPath), [
							{ irPackageName: "example/shared", targetOccurrence: ["example/selector", "example/beta", "example/shared"] },
						]),
						witnessNode(["example/selector", "example/beta", "example/shared"], id(rankedSharedPath, "2.0.0")),
						witnessNode(["example/selector", "example/gamma"], id(gammaPath), [
							{ irPackageName: "example/shared", targetOccurrence: ["example/selector", "example/gamma", "example/shared"] },
						]),
						witnessNode(["example/selector", "example/gamma", "example/shared"], id(rankedSharedPath, "2.0.0")),
					],
				},
			},
		});
	});

	test("breaks equal release-list ties by the normalized occurrence records", () => {
		const alphaPath = "example.com/pkg/alpha";
		const betaPath = "example.com/pkg/beta";
		const leftPath = "example.com/pkg/left";
		const providerPath = "example.com/pkg/provider";
		const rightPath = "example.com/pkg/right";
		const alpha = record(alphaPath, "1.0.0", "example/alpha");
		const beta = record(betaPath, "1.0.0", "example/beta");
		const provider10 = record(providerPath, "1.0.0", "example/provider", [requirement("example/alpha", alphaPath)]);
		const provider20 = record(providerPath, "2.0.0", "example/provider", [requirement("example/beta", betaPath)]);
		const left = record(leftPath, "1.0.0", "example/left", [requirement("example/provider", providerPath, "1.0.0", "3.0.0")]);
		const right = record(rightPath, "1.0.0", "example/right", [requirement("example/provider", providerPath, "1.0.0", "3.0.0")]);
		const target10 = record(targetPath, "1.0.0", "example/target", [requirement("example/alpha", alphaPath), requirement("example/beta", betaPath)]);
		const target20 = record(targetPath, "2.0.0", "example/target", [requirement("example/left", leftPath), requirement("example/right", rightPath)]);
		const root = record(rootPath, "1.0.0", "example/app", [requirement("example/target", targetPath, "1.0.0", "3.0.0")]);
		const input = update({
			root,
			catalogs: [
				catalog(rightPath, [right]),
				catalog(providerPath, [provider10, provider20]),
				catalog(betaPath, [beta]),
				catalog(targetPath, [target10, target20]),
				catalog(alphaPath, [alpha]),
				catalog(leftPath, [left]),
			],
			oldRecords: [target10, alpha, beta],
			oldBindings: new Map([
				[rootPath, [target10]],
				[targetPath, [alpha, beta]],
			]),
			targets: [
				{ kind: "eligible", packagePath: betaPath },
				{ kind: "exact", packagePath: targetPath, version: "2.0.0" },
				{ kind: "eligible", packagePath: alphaPath },
			],
		});

		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "unsupported-capability",
				requiredCapabilities: ["graph-aware-coexistence"],
				changedPins: [],
				witness: {
					nodes: [
						witnessNode([], id(rootPath), [{ irPackageName: "example/target", targetOccurrence: ["example/target"] }]),
						witnessNode(["example/target"], id(targetPath, "2.0.0"), [
							{ irPackageName: "example/left", targetOccurrence: ["example/target", "example/left"] },
							{ irPackageName: "example/right", targetOccurrence: ["example/target", "example/right"] },
						]),
						witnessNode(["example/target", "example/left"], id(leftPath), [
							{ irPackageName: "example/provider", targetOccurrence: ["example/target", "example/left", "example/provider"] },
						]),
						witnessNode(["example/target", "example/left", "example/provider"], id(providerPath, "2.0.0"), [
							{ irPackageName: "example/beta", targetOccurrence: ["example/target", "example/left", "example/provider", "example/beta"] },
						]),
						witnessNode(["example/target", "example/left", "example/provider", "example/beta"], id(betaPath)),
						witnessNode(["example/target", "example/right"], id(rightPath), [
							{ irPackageName: "example/provider", targetOccurrence: ["example/target", "example/right", "example/provider"] },
						]),
						witnessNode(["example/target", "example/right", "example/provider"], id(providerPath), [
							{ irPackageName: "example/alpha", targetOccurrence: ["example/target", "example/right", "example/provider", "example/alpha"] },
						]),
						witnessNode(["example/target", "example/right", "example/provider", "example/alpha"], id(alphaPath)),
					],
				},
			},
		});
	});

	test("discloses a relaxed outside-scope pin in an abstract coexistence witness", () => {
		const shared10 = record(sharedPath, "1.0.0", "example/shared");
		const shared20 = record(sharedPath, "2.0.0", "example/shared");
		const target10 = record(targetPath, "1.0.0", "example/target");
		const target20 = record(targetPath, "2.0.0", "example/target", [requirement("example/shared", sharedPath, "2.0.0", "3.0.0")]);
		const root = record(rootPath, "1.0.0", "example/app", [
			requirement("example/shared", sharedPath, "1.0.0", "2.0.0"),
			requirement("example/target", targetPath, "1.0.0", "3.0.0"),
		]);
		const input = update({
			root,
			catalogs: [catalog(sharedPath, [shared10, shared20]), catalog(targetPath, [target10, target20])],
			oldRecords: [target10, shared10],
			oldBindings: new Map([[rootPath, [shared10, target10]]]),
			targets: [{ kind: "exact", packagePath: targetPath, version: "2.0.0" }],
		});
		const result = resolveLibrary(JSON.stringify(input));
		expect(result).toMatchObject({
			ok: false,
			diagnostic: {
				code: "unsupported-capability",
				requiredCapabilities: ["graph-aware-coexistence"],
				changedPins: [{ kind: "changed", previous: id(sharedPath), selected: id(sharedPath, "2.0.0") }],
			},
		});
	});

	test("reports a removed outside-scope pin only when no witness occurrence retains its path", () => {
		const obsoletePath = "example.com/pkg/obsolete";
		const obsolete = record(obsoletePath, "1.0.0", "example/obsolete");
		const reporting10 = record(reportingPath, "1.0.0", "example/reporting", [requirement("example/obsolete", obsoletePath)]);
		const reporting20 = record(reportingPath, "2.0.0", "example/reporting");
		const target10 = record(targetPath, "1.0.0", "example/target");
		const target20 = record(targetPath, "2.0.0", "example/target", [requirement("example/reporting", reportingPath, "2.0.0", "3.0.0")]);
		const root = record(rootPath, "1.0.0", "example/app", [
			requirement("example/reporting", reportingPath, "1.0.0", "3.0.0"),
			requirement("example/target", targetPath, "1.0.0", "3.0.0"),
		]);
		const input = update({
			root,
			catalogs: [catalog(obsoletePath, [obsolete]), catalog(reportingPath, [reporting10, reporting20]), catalog(targetPath, [target10, target20])],
			oldRecords: [target10, reporting10, obsolete],
			oldBindings: new Map([
				[rootPath, [reporting10, target10]],
				[reportingPath, [obsolete]],
			]),
			targets: [{ kind: "exact", packagePath: targetPath, version: "2.0.0" }],
		});
		const result = resolveLibrary(JSON.stringify(input));
		expect(result).toMatchObject({
			ok: false,
			diagnostic: {
				code: "update-scope-conflict",
				changedPins: [
					{ kind: "removed", previous: id(obsoletePath) },
					{ kind: "changed", previous: id(reportingPath), selected: id(reportingPath, "2.0.0") },
				],
			},
		});
	});

	test("does not report unsupported capability when the abstract split is itself cyclic", () => {
		const alphaPath = "example.com/pkg/alpha";
		const betaPath = "example.com/pkg/beta";
		const alpha = record(alphaPath, "1.0.0", "example/alpha", [requirement("example/beta", betaPath)]);
		const beta = record(betaPath, "1.0.0", "example/beta", [requirement("example/alpha", alphaPath)]);
		const root = record(rootPath, "1.0.0", "example/app", [requirement("example/alpha", alphaPath)]);
		const result = resolveLibrary(JSON.stringify(initial(root, [catalog(alphaPath, [alpha]), catalog(betaPath, [beta])])));
		expect(result).toMatchObject({ ok: false, diagnostic: { code: "unsatisfiable-requirements" } });
	});

	test("requires every update target to remain reachable in diagnostic searches", () => {
		const childPath = "example.com/pkg/child";
		const child = record(childPath, "1.0.0", "example/child");
		const target10 = record(targetPath, "1.0.0", "example/target", [requirement("example/child", childPath)]);
		const target20 = record(targetPath, "2.0.0", "example/target");
		const root = record(rootPath, "1.0.0", "example/app", [requirement("example/target", targetPath, "1.0.0", "3.0.0")]);
		const input = update({
			root,
			catalogs: [catalog(childPath, [child]), catalog(targetPath, [target10, target20])],
			oldRecords: [target10, child],
			oldBindings: new Map([
				[rootPath, [target10]],
				[targetPath, [child]],
			]),
			targets: [
				{ kind: "exact", packagePath: targetPath, version: "2.0.0" },
				{ kind: "eligible", packagePath: childPath },
			],
		});
		expect(resolveLibrary(JSON.stringify(input))).toMatchObject({ ok: false, diagnostic: { code: "unsatisfiable-requirements" } });
	});

	test("allows a descendant root-path alternate release but rejects an exact ancestor repeat", () => {
		const providerPath = "example.com/lib/provider";
		const providerForAlternate = record(providerPath, "1.0.0", "example/provider", [requirement("example/app", rootPath, "2.0.0", "3.0.0")]);
		const alternateRoot = record(rootPath, "2.0.0", "example/app");
		const root = record(rootPath, "1.0.0", "example/app", [requirement("example/provider", providerPath)]);
		const coexistence = resolveLibrary(JSON.stringify(initial(root, [catalog(rootPath, [alternateRoot]), catalog(providerPath, [providerForAlternate])])));
		expect(coexistence).toMatchObject({
			ok: false,
			diagnostic: {
				code: "unsupported-capability",
				witness: {
					nodes: [
						witnessNode([], id(rootPath), [{ irPackageName: "example/provider", targetOccurrence: ["example/provider"] }]),
						witnessNode(["example/provider"], id(providerPath), [{ irPackageName: "example/app", targetOccurrence: ["example/provider", "example/app"] }]),
						witnessNode(["example/provider", "example/app"], id(rootPath, "2.0.0")),
					],
				},
			},
		});

		const providerForCycle = record(providerPath, "1.0.0", "example/provider", [requirement("example/app", rootPath)]);
		const cycle = resolveLibrary(JSON.stringify(initial(root, [catalog(providerPath, [providerForCycle])])));
		expect(cycle).toMatchObject({ ok: false, diagnostic: { code: "unsatisfiable-requirements", catalogs: [catalog(providerPath, [providerForCycle])] } });
	});

	test("missing selected metadata remains incomplete input instead of becoming empty-candidate unsatisfiability", () => {
		const target10 = record(targetPath, "1.0.0", "example/target");
		const root = record(rootPath, "1.0.0", "example/app", [requirement("example/target", targetPath)]);
		const input = update({
			root,
			catalogs: [catalog(targetPath, [])],
			oldRecords: [target10],
			oldBindings: new Map([[rootPath, [target10]]]),
			targets: [{ kind: "eligible", packagePath: targetPath }],
		});
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: { code: "incomplete-input", missing: [{ kind: "release", release: id(targetPath) }] },
		});
	});

	test("parser resource exhaustion remains an execution failure rather than a domain rejection", () => {
		expect(() => resolveLibrary("[".repeat(1001) + "]".repeat(1001))).toThrow("nesting deeper than 1000");
	});
});
