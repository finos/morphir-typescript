// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { isObject, type JsonObject, type JsonValue } from "../../../../ir/src/codec/json/value.ts";
import {
	type Binding,
	type Catalog,
	ContentDigest,
	IRPackageName,
	type LockedGraph,
	type LockedGraphWire,
	ManifestDigest,
	PackagePath,
	type ReleaseId,
	type ReleaseRecord,
	type ReleaseRecordWire,
	type Requirement,
	type RequirementWire,
	type ResolutionInputWire,
	StableVersion,
	type StructurallyValidatedResolutionInput,
	type UpdateTarget,
	VersionRange,
} from "./model.ts";
import type { Mode } from "./validate.ts";

function child(pointer: string, segment: string | number): string {
	const escaped = typeof segment === "number" ? segment : segment.replaceAll("~", "~0").replaceAll("/", "~1");
	return `${pointer}/${escaped}`;
}

function asObject(value: JsonValue | undefined): JsonObject {
	if (value === undefined || !isObject(value)) throw new Error("validated resolution object was not an object");
	return value;
}

function asArray(value: JsonValue | undefined): readonly JsonValue[] {
	if (!Array.isArray(value)) throw new Error("validated resolution array was not an array");
	return value;
}

function asString(value: JsonValue | undefined): string {
	if (typeof value !== "string") throw new Error("validated resolution string was not a string");
	return value;
}

function makeReleaseId(value: JsonValue | undefined, pointer: string): ReleaseId {
	const object = asObject(value);
	return Object.freeze({
		packagePath: PackagePath.parse(asString(object.members.get("packagePath"))),
		version: StableVersion.parse(asString(object.members.get("version"))),
		sourcePointer: pointer,
	});
}

function makeRequirement(value: JsonValue, pointer: string): Requirement {
	const object = asObject(value);
	const range = asObject(object.members.get("versionRange"));
	return Object.freeze({
		sourcePointer: pointer,
		irPackageName: IRPackageName.parse(asString(object.members.get("irPackageName"))),
		packagePath: PackagePath.parse(asString(object.members.get("packagePath"))),
		versionRange: VersionRange.parse(asString(range.members.get("minimumInclusive")), asString(range.members.get("maximumExclusive"))),
	});
}

function makeReleaseRecord(value: JsonValue | undefined, pointer: string): ReleaseRecord {
	const object = asObject(value);
	const dependenciesPointer = child(pointer, "dependencies");
	return Object.freeze({
		sourcePointer: pointer,
		release: makeReleaseId(object.members.get("release"), child(pointer, "release")),
		irPackageName: IRPackageName.parse(asString(object.members.get("irPackageName"))),
		manifestDigest: ManifestDigest.parse(asString(object.members.get("manifestDigest"))),
		contentDigest: ContentDigest.parse(asString(object.members.get("contentDigest"))),
		dependencies: Object.freeze(
			asArray(object.members.get("dependencies")).map((dependency, index) => makeRequirement(dependency, child(dependenciesPointer, index))),
		),
	});
}

function makeCatalog(value: JsonValue, pointer: string): Catalog {
	const object = asObject(value);
	return Object.freeze({
		sourcePointer: pointer,
		packagePath: PackagePath.parse(asString(object.members.get("packagePath"))),
		releases: Object.freeze(asArray(object.members.get("releases")).map((release, index) => makeReleaseRecord(release, `${pointer}/releases/${index}`))),
	});
}

function makeBinding(value: JsonValue, pointer: string): Binding {
	const object = asObject(value);
	return Object.freeze({
		sourcePointer: pointer,
		irPackageName: IRPackageName.parse(asString(object.members.get("irPackageName"))),
		target: makeReleaseId(object.members.get("target"), child(pointer, "target")),
	});
}

function makeLockedNode(value: JsonValue, pointer: string) {
	const object = asObject(value);
	return Object.freeze({
		sourcePointer: pointer,
		release: makeReleaseId(object.members.get("release"), child(pointer, "release")),
		irPackageName: IRPackageName.parse(asString(object.members.get("irPackageName"))),
		manifestDigest: ManifestDigest.parse(asString(object.members.get("manifestDigest"))),
		contentDigest: ContentDigest.parse(asString(object.members.get("contentDigest"))),
		bindings: Object.freeze(asArray(object.members.get("bindings")).map((binding, index) => makeBinding(binding, `${pointer}/bindings/${index}`))),
	});
}

function makeLock(value: JsonObject): LockedGraph {
	return Object.freeze({
		sourcePointer: "/lock",
		root: makeReleaseId(value.members.get("root"), "/lock/root"),
		nodes: Object.freeze(asArray(value.members.get("nodes")).map((node, index) => makeLockedNode(node, `/lock/nodes/${index}`))),
	});
}

function makeTarget(value: JsonValue, pointer: string): UpdateTarget {
	const object = asObject(value);
	const packagePath = PackagePath.parse(asString(object.members.get("packagePath")));
	return object.members.get("kind") === "exact"
		? Object.freeze({ kind: "exact", sourcePointer: pointer, packagePath, version: StableVersion.parse(asString(object.members.get("version"))) })
		: Object.freeze({ kind: "eligible", sourcePointer: pointer, packagePath });
}

export function makeInput(root: JsonObject, mode: Mode, lock?: JsonObject): StructurallyValidatedResolutionInput {
	const common = {
		formatVersion: "0.1.0-draft.2" as const,
		capability: "flat-library" as const,
		root: makeReleaseRecord(root.members.get("root"), "/root"),
	};
	if (mode === "initial")
		return Object.freeze({
			...common,
			mode,
			catalogs: Object.freeze(asArray(root.members.get("catalogs")).map((catalog, index) => makeCatalog(catalog, `/catalogs/${index}`))),
		});
	if (lock === undefined) throw new Error("validated update or replay input had no lock");
	if (mode === "update")
		return Object.freeze({
			...common,
			mode,
			catalogs: Object.freeze(asArray(root.members.get("catalogs")).map((catalog, index) => makeCatalog(catalog, `/catalogs/${index}`))),
			lock: makeLock(lock),
			targets: Object.freeze(asArray(root.members.get("targets")).map((target, index) => makeTarget(target, `/targets/${index}`))),
		});
	return Object.freeze({
		...common,
		mode,
		releases: Object.freeze(asArray(root.members.get("releases")).map((release, index) => makeReleaseRecord(release, `/releases/${index}`))),
		lock: makeLock(lock),
	});
}

export function requirementToWire(requirement: Requirement): RequirementWire {
	return {
		irPackageName: requirement.irPackageName.toWire(),
		packagePath: requirement.packagePath.toWire(),
		versionRange: requirement.versionRange.toWire(),
	};
}

export function releaseRecordToWire(record: ReleaseRecord): ReleaseRecordWire {
	return {
		release: { packagePath: record.release.packagePath.toWire(), version: record.release.version.toWire() },
		irPackageName: record.irPackageName.toWire(),
		manifestDigest: record.manifestDigest.toWire(),
		contentDigest: record.contentDigest.toWire(),
		dependencies: record.dependencies.map(requirementToWire),
	};
}

export function lockedGraphToWire(lock: LockedGraph): LockedGraphWire {
	return {
		root: { packagePath: lock.root.packagePath.toWire(), version: lock.root.version.toWire() },
		nodes: lock.nodes.map((node) => ({
			release: { packagePath: node.release.packagePath.toWire(), version: node.release.version.toWire() },
			irPackageName: node.irPackageName.toWire(),
			manifestDigest: node.manifestDigest.toWire(),
			contentDigest: node.contentDigest.toWire(),
			bindings: node.bindings.map((binding) => ({
				irPackageName: binding.irPackageName.toWire(),
				target: { packagePath: binding.target.packagePath.toWire(), version: binding.target.version.toWire() },
			})),
		})),
	};
}

/** Projects validated domain values back to the exact resolution wire shape, omitting source positions. */
export function resolutionInputToWire(input: StructurallyValidatedResolutionInput): ResolutionInputWire {
	const common = { formatVersion: input.formatVersion, capability: input.capability, root: releaseRecordToWire(input.root), mode: input.mode };
	if (input.mode === "initial")
		return {
			...common,
			mode: input.mode,
			catalogs: input.catalogs.map((catalog) => ({ packagePath: catalog.packagePath.toWire(), releases: catalog.releases.map(releaseRecordToWire) })),
		};
	if (input.mode === "update")
		return {
			...common,
			mode: input.mode,
			catalogs: input.catalogs.map((catalog) => ({ packagePath: catalog.packagePath.toWire(), releases: catalog.releases.map(releaseRecordToWire) })),
			lock: lockedGraphToWire(input.lock),
			targets: input.targets.map((target) =>
				target.kind === "exact"
					? { kind: target.kind, packagePath: target.packagePath.toWire(), version: target.version.toWire() }
					: { kind: target.kind, packagePath: target.packagePath.toWire() },
			),
		};
	return { ...common, mode: input.mode, releases: input.releases.map(releaseRecordToWire), lock: lockedGraphToWire(input.lock) };
}
