// packages/ir/src/versions/v4/write-distribution.ts
//
// Canonical writers for packages, distributions and the root of an IR file.
//
// A distribution always writes "dependencies" and its package member, empty or
// not, so the shape of a document does not depend on how much is in it (kit
// distributions-0002); an Application writes "entryPoints" last. The root is
// { "formatVersion": 4, "distribution": .. } in that order, with the version in
// its canonical spelling — the integer for a x.0.0 release.
import { type JsonValue, jsonObject } from "../../codec/json/value.ts";
import type {
	Distribution,
	EntryPoint,
	IRFile,
	NamedPackage,
	PackageDefinition,
	PackageSpecification,
} from "../../model/distribution.ts";
import type { NamedModule } from "../../model/modules.ts";
import { ModuleName, PackageName } from "../../model/names.ts";
import type { TA, VA } from "./attributes.ts";
import { canonicalFormatVersion } from "./format-version.ts";
import { writeAccessControlled, writeModuleDefinition, writeModuleSpecification } from "./write-definitions.ts";
import { writeFQName } from "./write-names.ts";

type Entry = readonly [string, JsonValue];

// --------------------------------------------------------------- packages

function writeModuleMap<T>(modules: readonly NamedModule<T>[], write: (t: T) => JsonValue): JsonValue {
	return jsonObject(modules.map((x) => [ModuleName.canonical(x.name), write(x.value)] as const));
}

function writePackageMap<T>(packages: readonly NamedPackage<T>[], write: (t: T) => JsonValue): JsonValue {
	return jsonObject(packages.map((x) => [PackageName.canonical(x.name), write(x.value)] as const));
}

export function writePackageDefinition(p: PackageDefinition<TA, VA>): JsonValue {
	return jsonObject([["modules", writeModuleMap(p.modules, (m) => writeAccessControlled(m, writeModuleDefinition))]]);
}

export function writePackageSpecification(p: PackageSpecification<TA, VA>): JsonValue {
	return jsonObject([["modules", writeModuleMap(p.modules, writeModuleSpecification)]]);
}

// ----------------------------------------------------------- entry points

function writeEntryPoints(entryPoints: readonly EntryPoint[]): JsonValue {
	return jsonObject(entryPoints.map((e) => {
		const entries: Entry[] = [["target", writeFQName(e.target)], ["kind", e.kind]];
		if (e.doc !== null) entries.push(["doc", e.doc]);
		return [e.name, jsonObject(entries)] as const;
	}));
}

// ---------------------------------------------------------- distributions

export function writeDistribution(d: Distribution<TA, VA>): JsonValue {
	const packageName = PackageName.canonical(d.packageName);
	switch (d.kind) {
		case "Library":
			return jsonObject([["Library", jsonObject([
				["packageName", packageName],
				["dependencies", writePackageMap(d.dependencies, writePackageSpecification)],
				["def", writePackageDefinition(d.def)],
			])]]);
		case "Specs":
			return jsonObject([["Specs", jsonObject([
				["packageName", packageName],
				["dependencies", writePackageMap(d.dependencies, writePackageSpecification)],
				["spec", writePackageSpecification(d.spec)],
			])]]);
		case "Application":
			return jsonObject([["Application", jsonObject([
				["packageName", packageName],
				["dependencies", writePackageMap(d.dependencies, writePackageDefinition)],
				["def", writePackageDefinition(d.def)],
				["entryPoints", writeEntryPoints(d.entryPoints)],
			])]]);
	}
}

// -------------------------------------------------------------- the root

export function writeIRFile(f: IRFile<TA, VA>): JsonValue {
	return jsonObject([
		["formatVersion", canonicalFormatVersion(f.formatVersion)],
		["distribution", writeDistribution(f.distribution)],
	]);
}
