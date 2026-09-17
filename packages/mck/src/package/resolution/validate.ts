// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { isObject, type JsonObject, type JsonValue } from "../../../../ir/src/codec/json/value.ts";
import { ContentDigest, IRPackageName, ManifestDigest, PackagePath, StableVersion, type Violation, type ViolationRule } from "./model.ts";

export type Mode = "initial" | "update" | "replay";

function escapePointerSegment(segment: string): string {
	return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function child(pointer: string, segment: string | number): string {
	return `${pointer}/${typeof segment === "number" ? segment : escapePointerSegment(segment)}`;
}

function add(violations: Violation[], pointer: string, rule: ViolationRule): void {
	violations.push({ pointer, rule });
}

function objectAt(value: JsonValue | undefined, pointer: string, violations: Violation[]): JsonObject | undefined {
	if (value === undefined) return undefined;
	if (!isObject(value)) {
		add(violations, pointer, "invalid-type");
		return undefined;
	}
	return value;
}

function arrayAt(value: JsonValue | undefined, pointer: string, violations: Violation[], nonempty = false): readonly JsonValue[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) {
		add(violations, pointer, "invalid-type");
		return undefined;
	}
	if (nonempty && value.length === 0) add(violations, pointer, "invalid-value");
	return value;
}

function fields(object: JsonObject, pointer: string, required: readonly string[], allowed: readonly string[], violations: Violation[]): void {
	for (const name of required) if (!object.members.has(name)) add(violations, child(pointer, name), "missing-field");
	for (const name of object.members.keys()) if (!allowed.includes(name)) add(violations, child(pointer, name), "unknown-field");
}

function stringAt(value: JsonValue | undefined, pointer: string, violations: Violation[], rule: ViolationRule, parse: (text: string) => unknown): void {
	if (value === undefined) return;
	if (typeof value !== "string") {
		add(violations, pointer, "invalid-type");
		return;
	}
	try {
		parse(value);
	} catch {
		add(violations, pointer, rule);
	}
}

function literalAt(value: JsonValue | undefined, pointer: string, expected: string, violations: Violation[]): void {
	if (value === undefined) return;
	if (typeof value !== "string") add(violations, pointer, "invalid-type");
	else if (value !== expected) add(violations, pointer, "invalid-value");
}

function validateReleaseId(value: JsonValue | undefined, pointer: string, violations: Violation[]): void {
	const object = objectAt(value, pointer, violations);
	if (object === undefined) return;
	fields(object, pointer, ["packagePath", "version"], ["packagePath", "version"], violations);
	stringAt(object.members.get("packagePath"), child(pointer, "packagePath"), violations, "invalid-name", PackagePath.parse);
	stringAt(object.members.get("version"), child(pointer, "version"), violations, "invalid-version", StableVersion.parse);
}

function validateVersionRange(value: JsonValue | undefined, pointer: string, violations: Violation[]): void {
	const object = objectAt(value, pointer, violations);
	if (object === undefined) return;
	fields(object, pointer, ["minimumInclusive", "maximumExclusive"], ["minimumInclusive", "maximumExclusive"], violations);
	stringAt(object.members.get("minimumInclusive"), child(pointer, "minimumInclusive"), violations, "invalid-version", StableVersion.parse);
	stringAt(object.members.get("maximumExclusive"), child(pointer, "maximumExclusive"), violations, "invalid-version", StableVersion.parse);
}

function validateRequirement(value: JsonValue, pointer: string, violations: Violation[]): void {
	const object = objectAt(value, pointer, violations);
	if (object === undefined) return;
	fields(object, pointer, ["irPackageName", "packagePath", "versionRange"], ["irPackageName", "packagePath", "versionRange"], violations);
	stringAt(object.members.get("irPackageName"), child(pointer, "irPackageName"), violations, "invalid-name", IRPackageName.parse);
	stringAt(object.members.get("packagePath"), child(pointer, "packagePath"), violations, "invalid-name", PackagePath.parse);
	validateVersionRange(object.members.get("versionRange"), child(pointer, "versionRange"), violations);
}

function validateReleaseRecord(value: JsonValue | undefined, pointer: string, violations: Violation[]): void {
	const object = objectAt(value, pointer, violations);
	if (object === undefined) return;
	const names = ["release", "irPackageName", "manifestDigest", "contentDigest", "dependencies"];
	fields(object, pointer, names, names, violations);
	validateReleaseId(object.members.get("release"), child(pointer, "release"), violations);
	stringAt(object.members.get("irPackageName"), child(pointer, "irPackageName"), violations, "invalid-name", IRPackageName.parse);
	stringAt(object.members.get("manifestDigest"), child(pointer, "manifestDigest"), violations, "invalid-digest", ManifestDigest.parse);
	stringAt(object.members.get("contentDigest"), child(pointer, "contentDigest"), violations, "invalid-digest", ContentDigest.parse);
	const dependencies = arrayAt(object.members.get("dependencies"), child(pointer, "dependencies"), violations);
	dependencies?.forEach((dependency, index) => {
		validateRequirement(dependency, child(child(pointer, "dependencies"), index), violations);
	});
}

function validateCatalog(value: JsonValue, pointer: string, violations: Violation[]): void {
	const object = objectAt(value, pointer, violations);
	if (object === undefined) return;
	fields(object, pointer, ["packagePath", "releases"], ["packagePath", "releases"], violations);
	stringAt(object.members.get("packagePath"), child(pointer, "packagePath"), violations, "invalid-name", PackagePath.parse);
	const releases = arrayAt(object.members.get("releases"), child(pointer, "releases"), violations);
	releases?.forEach((release, index) => {
		validateReleaseRecord(release, child(child(pointer, "releases"), index), violations);
	});
}

function validateTarget(value: JsonValue, pointer: string, violations: Violation[]): void {
	const object = objectAt(value, pointer, violations);
	if (object === undefined) return;
	const kind = object.members.get("kind");
	const recognized = kind === "eligible" || kind === "exact" ? kind : undefined;
	const allowed = recognized === "eligible" ? ["kind", "packagePath"] : ["kind", "packagePath", "version"];
	const required = recognized === "exact" ? ["kind", "packagePath", "version"] : ["kind", "packagePath"];
	fields(object, pointer, required, allowed, violations);
	if (kind !== undefined && typeof kind !== "string") add(violations, child(pointer, "kind"), "invalid-type");
	else if (typeof kind === "string" && recognized === undefined) add(violations, child(pointer, "kind"), "invalid-value");
	stringAt(object.members.get("packagePath"), child(pointer, "packagePath"), violations, "invalid-name", PackagePath.parse);
	if (recognized === "exact") stringAt(object.members.get("version"), child(pointer, "version"), violations, "invalid-version", StableVersion.parse);
}

function modeOf(root: JsonObject): Mode | undefined {
	const mode = root.members.get("mode");
	return mode === "initial" || mode === "update" || mode === "replay" ? mode : undefined;
}

export function validateOuterShape(document: JsonValue): { readonly root?: JsonObject; readonly mode?: Mode; readonly violations: readonly Violation[] } {
	const violations: Violation[] = [];
	const root = objectAt(document, "", violations);
	if (root === undefined) return { violations };
	const mode = modeOf(root);
	const common = ["formatVersion", "capability", "root", "mode"];
	const variants = ["catalogs", "lock", "targets", "releases"];
	const allowed =
		mode === "initial"
			? [...common, "catalogs"]
			: mode === "update"
				? [...common, "catalogs", "lock", "targets"]
				: mode === "replay"
					? [...common, "releases", "lock"]
					: [...common, ...variants];
	const required =
		mode === "initial"
			? [...common, "catalogs"]
			: mode === "update"
				? [...common, "catalogs", "targets"]
				: mode === "replay"
					? [...common, "releases"]
					: common;
	fields(root, "", required, allowed, violations);
	literalAt(root.members.get("formatVersion"), "/formatVersion", "0.1.0-draft.2", violations);
	literalAt(root.members.get("capability"), "/capability", "flat-library", violations);
	validateReleaseRecord(root.members.get("root"), "/root", violations);
	const rawMode = root.members.get("mode");
	if (rawMode !== undefined && typeof rawMode !== "string") add(violations, "/mode", "invalid-type");
	else if (typeof rawMode === "string" && mode === undefined) add(violations, "/mode", "invalid-value");
	if (mode === "initial" || mode === "update") {
		const catalogs = arrayAt(root.members.get("catalogs"), "/catalogs", violations);
		catalogs?.forEach((catalog, index) => {
			validateCatalog(catalog, `/catalogs/${index}`, violations);
		});
	}
	if (mode === "update") {
		const targets = arrayAt(root.members.get("targets"), "/targets", violations, true);
		targets?.forEach((target, index) => {
			validateTarget(target, `/targets/${index}`, violations);
		});
	}
	if (mode === "replay") {
		const releases = arrayAt(root.members.get("releases"), "/releases", violations);
		releases?.forEach((release, index) => {
			validateReleaseRecord(release, `/releases/${index}`, violations);
		});
	}
	return { root, mode, violations };
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

function releaseIdentity(value: JsonObject): string {
	return `${asString(value.members.get("packagePath"))}@${asString(value.members.get("version"))}`;
}

function validateRecordIdentities(record: JsonObject, pointer: string, releases: Set<string>, violations: Violation[], expectedPackagePath?: string): void {
	const release = asObject(record.members.get("release"));
	const identity = releaseIdentity(release);
	if (releases.has(identity)) {
		add(violations, child(pointer, "release"), "duplicate-identity");
		return;
	}
	releases.add(identity);
	if (expectedPackagePath !== undefined && asString(release.members.get("packagePath")) !== expectedPackagePath)
		add(violations, child(child(pointer, "release"), "packagePath"), "identity-mismatch");
	const requirementNames = new Set<string>();
	for (const [index, dependencyValue] of asArray(record.members.get("dependencies")).entries()) {
		const dependency = asObject(dependencyValue);
		const dependencyPointer = child(child(pointer, "dependencies"), index);
		const name = asString(dependency.members.get("irPackageName"));
		if (requirementNames.has(name)) {
			add(violations, child(dependencyPointer, "irPackageName"), "duplicate-identity");
			continue;
		}
		requirementNames.add(name);
		const range = asObject(dependency.members.get("versionRange"));
		const minimum = StableVersion.parse(asString(range.members.get("minimumInclusive")));
		const maximum = StableVersion.parse(asString(range.members.get("maximumExclusive")));
		if (minimum.compare(maximum) >= 0) add(violations, child(dependencyPointer, "versionRange"), "invalid-interval");
	}
}

export function validateOuterIdentities(root: JsonObject, mode: Mode): readonly Violation[] {
	const violations: Violation[] = [];
	const releases = new Set<string>();
	validateRecordIdentities(asObject(root.members.get("root")), "/root", releases, violations);
	if (mode === "initial" || mode === "update") {
		const catalogPaths = new Set<string>();
		for (const [catalogIndex, catalogValue] of asArray(root.members.get("catalogs")).entries()) {
			const catalog = asObject(catalogValue);
			const catalogPointer = `/catalogs/${catalogIndex}`;
			const packagePath = asString(catalog.members.get("packagePath"));
			if (catalogPaths.has(packagePath)) {
				add(violations, child(catalogPointer, "packagePath"), "duplicate-identity");
				continue;
			}
			catalogPaths.add(packagePath);
			for (const [releaseIndex, recordValue] of asArray(catalog.members.get("releases")).entries())
				validateRecordIdentities(asObject(recordValue), child(child(catalogPointer, "releases"), releaseIndex), releases, violations, packagePath);
		}
	}
	if (mode === "replay") {
		for (const [index, record] of asArray(root.members.get("releases")).entries())
			validateRecordIdentities(asObject(record), `/releases/${index}`, releases, violations);
	}
	if (mode === "update") {
		const targetPaths = new Set<string>();
		for (const [index, targetValue] of asArray(root.members.get("targets")).entries()) {
			const target = asObject(targetValue);
			const packagePath = asString(target.members.get("packagePath"));
			if (targetPaths.has(packagePath)) add(violations, `/targets/${index}/packagePath`, "duplicate-identity");
			else targetPaths.add(packagePath);
		}
	}
	return violations;
}

function validateBinding(value: JsonValue, pointer: string, violations: Violation[]): void {
	const object = objectAt(value, pointer, violations);
	if (object === undefined) return;
	fields(object, pointer, ["irPackageName", "target"], ["irPackageName", "target"], violations);
	stringAt(object.members.get("irPackageName"), child(pointer, "irPackageName"), violations, "invalid-name", IRPackageName.parse);
	validateReleaseId(object.members.get("target"), child(pointer, "target"), violations);
}

function validateLockedNode(value: JsonValue, pointer: string, violations: Violation[]): void {
	const object = objectAt(value, pointer, violations);
	if (object === undefined) return;
	const names = ["release", "irPackageName", "manifestDigest", "contentDigest", "bindings"];
	fields(object, pointer, names, names, violations);
	validateReleaseId(object.members.get("release"), child(pointer, "release"), violations);
	stringAt(object.members.get("irPackageName"), child(pointer, "irPackageName"), violations, "invalid-name", IRPackageName.parse);
	stringAt(object.members.get("manifestDigest"), child(pointer, "manifestDigest"), violations, "invalid-digest", ManifestDigest.parse);
	stringAt(object.members.get("contentDigest"), child(pointer, "contentDigest"), violations, "invalid-digest", ContentDigest.parse);
	const bindings = arrayAt(object.members.get("bindings"), child(pointer, "bindings"), violations);
	bindings?.forEach((binding, index) => {
		validateBinding(binding, child(child(pointer, "bindings"), index), violations);
	});
}

export function validateLockShape(root: JsonObject): { readonly lock?: JsonObject; readonly violations: readonly Violation[] } {
	const violations: Violation[] = [];
	if (!root.members.has("lock")) {
		add(violations, "/lock", "missing-field");
		return { violations };
	}
	const lock = objectAt(root.members.get("lock"), "/lock", violations);
	if (lock === undefined) return { violations };
	fields(lock, "/lock", ["root", "nodes"], ["root", "nodes"], violations);
	validateReleaseId(lock.members.get("root"), "/lock/root", violations);
	const nodes = arrayAt(lock.members.get("nodes"), "/lock/nodes", violations, true);
	nodes?.forEach((node, index) => {
		validateLockedNode(node, `/lock/nodes/${index}`, violations);
	});
	return { lock, violations };
}

export function validateLockIdentities(lock: JsonObject): readonly Violation[] {
	const violations: Violation[] = [];
	const exactReleases = new Set<string>();
	const packagePaths = new Set<string>();
	const irNames = new Set<string>();
	for (const [nodeIndex, nodeValue] of asArray(lock.members.get("nodes")).entries()) {
		const node = asObject(nodeValue);
		const pointer = `/lock/nodes/${nodeIndex}`;
		const release = asObject(node.members.get("release"));
		const identity = releaseIdentity(release);
		if (exactReleases.has(identity)) {
			add(violations, child(pointer, "release"), "duplicate-identity");
			continue;
		}
		exactReleases.add(identity);
		const packagePath = asString(release.members.get("packagePath"));
		if (packagePaths.has(packagePath)) {
			add(violations, child(child(pointer, "release"), "packagePath"), "duplicate-identity");
			continue;
		}
		packagePaths.add(packagePath);
		const irName = asString(node.members.get("irPackageName"));
		if (irNames.has(irName)) {
			add(violations, child(pointer, "irPackageName"), "unsupported-flat-binding");
			continue;
		}
		irNames.add(irName);
		const bindingNames = new Set<string>();
		for (const [bindingIndex, bindingValue] of asArray(node.members.get("bindings")).entries()) {
			const binding = asObject(bindingValue);
			const name = asString(binding.members.get("irPackageName"));
			if (bindingNames.has(name)) add(violations, `/lock/nodes/${nodeIndex}/bindings/${bindingIndex}/irPackageName`, "duplicate-identity");
			else bindingNames.add(name);
		}
	}
	return violations;
}
