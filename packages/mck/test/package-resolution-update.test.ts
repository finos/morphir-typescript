// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { resolveLibrary } from "../src/index.ts";
import { parseResolutionInput } from "../src/package/resolution/parse.ts";
import { updateLockedGraph } from "../src/package/resolution/update.ts";

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
type BindingLiteral = { irPackageName: string; target: ReleaseIdLiteral };
type LockedNodeLiteral = Omit<ReleaseRecordLiteral, "dependencies"> & { bindings: BindingLiteral[] };
type CatalogLiteral = { packagePath: string; releases: ReleaseRecordLiteral[] };
type TargetLiteral = { kind: "eligible"; packagePath: string } | { kind: "exact"; packagePath: string; version: string };
type UpdateLiteral = {
	formatVersion: "0.1.0-draft.2";
	capability: "flat-library";
	root: ReleaseRecordLiteral;
	mode: "update";
	catalogs: CatalogLiteral[];
	lock: { root: ReleaseIdLiteral; nodes: LockedNodeLiteral[] };
	targets: TargetLiteral[];
};

const rootPath = "example.com/app/root";
const loanPath = "example.com/finance/loan-rules";
const eligibilityPath = "example.com/finance/eligibility";
const reportingPath = "example.com/finance/reporting";

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

const node = (metadata: ReleaseRecordLiteral, bindings: BindingLiteral[] = []): LockedNodeLiteral => ({
	release: { ...metadata.release },
	irPackageName: metadata.irPackageName,
	manifestDigest: metadata.manifestDigest,
	contentDigest: metadata.contentDigest,
	bindings,
});

const binding = (metadata: ReleaseRecordLiteral): BindingLiteral => ({
	irPackageName: metadata.irPackageName,
	target: { ...metadata.release },
});

const catalog = (packagePath: string, releases: ReleaseRecordLiteral[]): CatalogLiteral => ({ packagePath, releases });

function updateInput(options: {
	root: ReleaseRecordLiteral;
	records: ReleaseRecordLiteral[];
	oldRecords: ReleaseRecordLiteral[];
	oldBindings: ReadonlyMap<string, ReleaseRecordLiteral[]>;
	targets: TargetLiteral[];
}): UpdateLiteral {
	return {
		formatVersion: "0.1.0-draft.2",
		capability: "flat-library",
		root: options.root,
		mode: "update",
		catalogs: [...Map.groupBy(options.records, (metadata) => metadata.release.packagePath)].map(([packagePath, releases]) => catalog(packagePath, releases)),
		lock: {
			root: { ...options.root.release },
			nodes: [options.root, ...options.oldRecords].map((metadata) =>
				node(metadata, (options.oldBindings.get(metadata.release.packagePath) ?? []).map(binding)),
			),
		},
		targets: options.targets,
	};
}

function selected(input: UpdateLiteral) {
	const result = resolveLibrary(JSON.stringify(input));
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(`expected selection, received ${result.diagnostic.code}`);
	return result.graph;
}

function selectedIds(input: UpdateLiteral): ReleaseIdLiteral[] {
	return selected(input).nodes.map((selectedNode) => selectedNode.release);
}

function noSelection(input: UpdateLiteral, diagnosticCode: "update-scope-conflict" | "unsupported-capability"): void {
	const parsed = parseResolutionInput(JSON.stringify(input));
	if (!parsed.ok || parsed.value.mode !== "update") throw new Error("fixture did not parse as update input");
	expect(updateLockedGraph(parsed.value)).toEqual({ kind: "no-selection" });
	expect(resolveLibrary(JSON.stringify(input))).toMatchObject({ ok: false, diagnostic: { code: diagnosticCode } });
}

function loanUpdate(target: TargetLiteral, pinnedReporting = false): UpdateLiteral {
	const eligibility12 = record(eligibilityPath, "1.2.0", "example/eligibility");
	const eligibility13 = record(eligibilityPath, "1.3.0", "example/eligibility");
	const eligibility14 = record(eligibilityPath, "1.4.0", "example/eligibility");
	const eligibility12Plus = requirement("example/eligibility", eligibilityPath, "1.2.0", "2.0.0");
	const eligibility13Plus = requirement("example/eligibility", eligibilityPath, "1.3.0", "2.0.0");
	const loan10 = record(loanPath, "1.0.0", "example/loan-rules", [eligibility12Plus]);
	const loan11 = record(loanPath, "1.1.0", "example/loan-rules", [eligibility12Plus]);
	const loan12 = record(loanPath, "1.2.0", "example/loan-rules", [eligibility13Plus]);
	const reporting = record(reportingPath, "1.0.0", "example/reporting", [requirement("example/eligibility", eligibilityPath, "1.2.0", "1.3.0")]);
	const rootDependencies = [requirement("example/loan-rules", loanPath)];
	if (pinnedReporting) rootDependencies.push(requirement("example/reporting", reportingPath));
	const root = record(rootPath, "1.0.0", "example/app", rootDependencies);
	return updateInput({
		root,
		records: [loan10, loan11, loan12, eligibility12, eligibility13, eligibility14, ...(pinnedReporting ? [reporting] : [])],
		oldRecords: [loan10, eligibility12, ...(pinnedReporting ? [reporting] : [])],
		oldBindings: new Map<string, ReleaseRecordLiteral[]>([
			[rootPath, pinnedReporting ? [loan10, reporting] : [loan10]],
			[loanPath, [eligibility12]],
			...(pinnedReporting ? [[reportingPath, [eligibility12]] as [string, ReleaseRecordLiteral[]]] : []),
		]),
		targets: [target],
	});
}

describe("resolveLibrary scoped update", () => {
	test("applies the literal eligible loan-rules update and maximizes its dependency after target freshness", () => {
		expect(selectedIds(loanUpdate({ kind: "eligible", packagePath: loanPath }))).toEqual([id(rootPath), id(eligibilityPath, "1.4.0"), id(loanPath, "1.2.0")]);
	});

	test("applies the literal exact loan-rules update and retains an already eligible old dependency", () => {
		expect(selectedIds(loanUpdate({ kind: "exact", packagePath: loanPath, version: "1.1.0" }))).toEqual([
			id(rootPath),
			id(eligibilityPath, "1.2.0"),
			id(loanPath, "1.1.0"),
		]);
	});

	test("settles on loan-rules 1.1 when a pinned consumer preserves the shared 1.2 dependency", () => {
		expect(selectedIds(loanUpdate({ kind: "eligible", packagePath: loanPath }, true))).toEqual([
			id(rootPath),
			id(eligibilityPath, "1.2.0"),
			id(loanPath, "1.1.0"),
			id(reportingPath),
		]);
	});

	test("diagnoses an irreconcilable shared release as unsupported coexistence", () => {
		noSelection(loanUpdate({ kind: "exact", packagePath: loanPath, version: "1.2.0" }, true), "unsupported-capability");
	});

	test("rejects root and absent target paths together after validating the old lock", () => {
		const input = loanUpdate({ kind: "eligible", packagePath: loanPath });
		input.targets = [
			{ kind: "eligible", packagePath: "example.com/absent/package" },
			{ kind: "eligible", packagePath: rootPath },
		];
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: {
				code: "invalid-input",
				violations: [
					{ pointer: "/targets/0/packagePath", rule: "identity-mismatch" },
					{ pointer: "/targets/1/packagePath", rule: "identity-mismatch" },
				],
			},
		});
	});

	test("reports candidate completeness after target membership", () => {
		const input = loanUpdate({ kind: "eligible", packagePath: loanPath });
		input.catalogs
			.find((entry) => entry.packagePath === loanPath)
			?.releases.push(record(loanPath, "1.3.0", "example/loan-rules", [requirement("example/missing", "example.com/finance/missing")]));
		expect(resolveLibrary(JSON.stringify(input))).toEqual({
			ok: false,
			diagnostic: { code: "incomplete-input", missing: [{ kind: "catalog", packagePath: "example.com/finance/missing" }] },
		});
	});

	test("changes an unlocked shared dependency when the updated target requires it", () => {
		const sharedPath = "example.com/lib/shared";
		const consumerPath = "example.com/lib/consumer";
		const shared1 = record(sharedPath, "1.0.0", "example/shared");
		const shared2 = record(sharedPath, "2.0.0", "example/shared");
		const target1 = record(loanPath, "1.0.0", "example/loan-rules", [requirement("example/shared", sharedPath, "1.0.0", "3.0.0")]);
		const target2 = record(loanPath, "2.0.0", "example/loan-rules", [requirement("example/shared", sharedPath, "2.0.0", "3.0.0")]);
		const consumer = record(consumerPath, "1.0.0", "example/consumer", [requirement("example/shared", sharedPath, "1.0.0", "3.0.0")]);
		const root = record(rootPath, "1.0.0", "example/app", [
			requirement("example/loan-rules", loanPath, "1.0.0", "3.0.0"),
			requirement("example/consumer", consumerPath),
		]);
		const input = updateInput({
			root,
			records: [target1, target2, consumer, shared1, shared2],
			oldRecords: [target1, consumer, shared1],
			oldBindings: new Map([
				[rootPath, [target1, consumer]],
				[loanPath, [shared1]],
				[consumerPath, [shared1]],
			]),
			targets: [{ kind: "eligible", packagePath: loanPath }],
		});
		expect(selectedIds(input)).toEqual([id(rootPath), id(loanPath, "2.0.0"), id(consumerPath), id(sharedPath, "2.0.0")]);
	});

	test("rejects a new target edge that would require changing an existing outside-scope package", () => {
		const existingPath = "example.com/lib/existing";
		const keeperPath = "example.com/lib/keeper";
		const existing1 = record(existingPath, "1.0.0", "example/existing");
		const existing2 = record(existingPath, "1.5.0", "example/existing");
		const target1 = record(loanPath, "1.0.0", "example/loan-rules");
		const target2 = record(loanPath, "2.0.0", "example/loan-rules", [requirement("example/existing", existingPath, "1.5.0", "2.0.0")]);
		const keeper = record(keeperPath, "1.0.0", "example/keeper", [requirement("example/existing", existingPath)]);
		const root = record(rootPath, "1.0.0", "example/app", [
			requirement("example/loan-rules", loanPath, "1.0.0", "3.0.0"),
			requirement("example/keeper", keeperPath),
		]);
		const input = updateInput({
			root,
			records: [target1, target2, keeper, existing1, existing2],
			oldRecords: [target1, keeper, existing1],
			oldBindings: new Map([
				[rootPath, [target1, keeper]],
				[keeperPath, [existing1]],
			]),
			targets: [{ kind: "eligible", packagePath: loanPath }],
		});
		expect(selectedIds(input)).toEqual([id(rootPath), id(loanPath), id(existingPath), id(keeperPath)]);
		noSelection(
			{
				...input,
				targets: [{ kind: "exact", packagePath: loanPath, version: "2.0.0" }],
			},
			"update-scope-conflict",
		);
	});

	test("allows an updated target to introduce a new dependency path", () => {
		const newPath = "example.com/lib/new-helper";
		const target1 = record(loanPath, "1.0.0", "example/loan-rules");
		const target2 = record(loanPath, "2.0.0", "example/loan-rules", [requirement("example/new-helper", newPath)]);
		const newHelper = record(newPath, "1.5.0", "example/new-helper");
		const root = record(rootPath, "1.0.0", "example/app", [requirement("example/loan-rules", loanPath, "1.0.0", "3.0.0")]);
		const input = updateInput({
			root,
			records: [target1, target2, newHelper],
			oldRecords: [target1],
			oldBindings: new Map([[rootPath, [target1]]]),
			targets: [{ kind: "eligible", packagePath: loanPath }],
		});
		expect(selectedIds(input)).toEqual([id(rootPath), id(loanPath, "2.0.0"), id(newPath, "1.5.0")]);
	});

	test("removes an old dependency that becomes unreachable", () => {
		const oldHelperPath = "example.com/lib/old-helper";
		const oldHelper = record(oldHelperPath, "1.0.0", "example/old-helper");
		const target1 = record(loanPath, "1.0.0", "example/loan-rules", [requirement("example/old-helper", oldHelperPath)]);
		const target2 = record(loanPath, "2.0.0", "example/loan-rules");
		const root = record(rootPath, "1.0.0", "example/app", [requirement("example/loan-rules", loanPath, "1.0.0", "3.0.0")]);
		const input = updateInput({
			root,
			records: [target1, target2, oldHelper],
			oldRecords: [target1, oldHelper],
			oldBindings: new Map([
				[rootPath, [target1]],
				[loanPath, [oldHelper]],
			]),
			targets: [{ kind: "eligible", packagePath: loanPath }],
		});
		expect(selectedIds(input)).toEqual([id(rootPath), id(loanPath, "2.0.0")]);
	});

	test("does not let an ancestor update make a separate target unreachable", () => {
		const childPath = "example.com/lib/child";
		const child = record(childPath, "1.0.0", "example/child");
		const target1 = record(loanPath, "1.0.0", "example/loan-rules", [requirement("example/child", childPath)]);
		const target2 = record(loanPath, "2.0.0", "example/loan-rules");
		const root = record(rootPath, "1.0.0", "example/app", [requirement("example/loan-rules", loanPath, "1.0.0", "3.0.0")]);
		const input = updateInput({
			root,
			records: [target1, target2, child],
			oldRecords: [target1, child],
			oldBindings: new Map([
				[rootPath, [target1]],
				[loanPath, [child]],
			]),
			targets: [
				{ kind: "eligible", packagePath: loanPath },
				{ kind: "eligible", packagePath: childPath },
			],
		});
		expect(selectedIds(input)).toEqual([id(rootPath), id(loanPath), id(childPath)]);
	});

	test("prefers one changed old non-target path over two even when the latter releases are newer", () => {
		const sharedPath = "example.com/lib/shared";
		const leafPath = "example.com/lib/leaf";
		const leaf1 = record(leafPath, "1.0.0", "example/leaf");
		const leaf2 = record(leafPath, "2.0.0", "example/leaf");
		const shared1 = record(sharedPath, "1.0.0", "example/shared", [requirement("example/leaf", leafPath, "1.0.0", "3.0.0")]);
		const shared2 = record(sharedPath, "2.0.0", "example/shared", [requirement("example/leaf", leafPath, "1.0.0", "2.0.0")]);
		const shared3 = record(sharedPath, "3.0.0", "example/shared", [requirement("example/leaf", leafPath, "2.0.0", "3.0.0")]);
		const target1 = record(loanPath, "1.0.0", "example/loan-rules", [requirement("example/shared", sharedPath, "1.0.0", "2.0.0")]);
		const target2 = record(loanPath, "2.0.0", "example/loan-rules", [requirement("example/shared", sharedPath, "2.0.0", "4.0.0")]);
		const root = record(rootPath, "1.0.0", "example/app", [requirement("example/loan-rules", loanPath, "1.0.0", "3.0.0")]);
		const input = updateInput({
			root,
			records: [target1, target2, shared1, shared2, shared3, leaf1, leaf2],
			oldRecords: [target1, shared1, leaf1],
			oldBindings: new Map([
				[rootPath, [target1]],
				[loanPath, [shared1]],
				[sharedPath, [leaf1]],
			]),
			targets: [{ kind: "exact", packagePath: loanPath, version: "2.0.0" }],
		});
		expect(selectedIds(input)).toEqual([id(rootPath), id(loanPath, "2.0.0"), id(leafPath), id(sharedPath, "2.0.0")]);
	});

	test("ranks simultaneous targets by ASCII path rather than request order", () => {
		const alphaPath = "example.com/targets/alpha";
		const zuluPath = "example.com/targets/zulu";
		const sharedPath = "example.com/targets/shared";
		const shared1 = record(sharedPath, "1.0.0", "example/shared");
		const shared2 = record(sharedPath, "2.0.0", "example/shared");
		const alpha1 = record(alphaPath, "1.0.0", "example/alpha", [requirement("example/shared", sharedPath, "1.0.0", "3.0.0")]);
		const alpha2 = record(alphaPath, "2.0.0", "example/alpha", [requirement("example/shared", sharedPath, "2.0.0", "3.0.0")]);
		const zulu1 = record(zuluPath, "1.0.0", "example/zulu", [requirement("example/shared", sharedPath, "1.0.0", "3.0.0")]);
		const zulu2 = record(zuluPath, "2.0.0", "example/zulu", [requirement("example/shared", sharedPath, "1.0.0", "2.0.0")]);
		const root = record(rootPath, "1.0.0", "example/app", [
			requirement("example/alpha", alphaPath, "1.0.0", "3.0.0"),
			requirement("example/zulu", zuluPath, "1.0.0", "3.0.0"),
		]);
		const makeInput = (targets: TargetLiteral[]) =>
			updateInput({
				root,
				records: [alpha1, alpha2, zulu1, zulu2, shared1, shared2],
				oldRecords: [alpha1, zulu1, shared1],
				oldBindings: new Map([
					[rootPath, [alpha1, zulu1]],
					[alphaPath, [shared1]],
					[zuluPath, [shared1]],
				]),
				targets,
			});
		const forward = makeInput([
			{ kind: "eligible", packagePath: alphaPath },
			{ kind: "eligible", packagePath: zuluPath },
		]);
		const reverse = makeInput([...forward.targets].reverse());
		expect(selectedIds(reverse)).toEqual([id(rootPath), id(alphaPath, "2.0.0"), id(sharedPath, "2.0.0"), id(zuluPath)]);
		expect(selected(reverse)).toEqual(selected(forward));
	});
});
