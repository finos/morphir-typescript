// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Canonical writers for the document tree's four file kinds.
//
// There is one v4 spelling for each, so reading any accepted spelling and
// writing it back normalizes it: a module manifest's "module" comes out as
// "path", a doc given as a list of lines comes out as one string, and the
// reserved "$meta" never comes out at all. A member that only repeats a
// default — an empty "dependencies", a Public "access", entry points on a
// distribution that has none — is left off, so the shape of a file does not
// depend on how much is in it.
import { type JsonValue, jsonNumber, jsonObject } from "../../codec/json/value.ts";
import { Name, PackageName } from "../../model/names.ts";
import type { DistributionManifestFile, ModuleEntries, ModuleManifestFile, TypeDefinitionFile, ValueDefinitionFile } from "../../model/tree-files.ts";
import type { TA, VA } from "./attributes.ts";
import { canonicalFormatVersion } from "./format-version.ts";
import {
	writeAccessControlledTypeDefinition,
	writeAccessControlledValueDefinition,
	writeDocumentedTypeSpecification,
	writeDocumentedValueSpecification,
	writeNamedMap,
} from "./write-definitions.ts";
import { writeEntryPoints } from "./write-distribution.ts";
import { writeModuleName, writeName } from "./write-names.ts";

type Entry = readonly [string, JsonValue];

export function writeDistributionManifestFile(f: DistributionManifestFile): JsonValue {
	const entries: Entry[] = [
		["formatVersion", canonicalFormatVersion(f.formatVersion)],
		["distribution", f.distribution],
		["package", PackageName.canonical(f.packageName)],
		["pathBudget", jsonNumber(String(f.pathBudget))],
	];
	if (f.dependencies.length > 0) entries.push(["dependencies", f.dependencies.map((p) => PackageName.canonical(p))]);
	// Only an Application may carry entry points, and only then when it has any:
	// an empty member would only repeat the default, the way an empty
	// "dependencies" or "fileNames" would.
	if (f.distribution === "Application" && f.entryPoints.length > 0) entries.push(["entryPoints", writeEntryPoints(f.entryPoints)]);
	return jsonObject(entries);
}

// A names-style listing is an array of canonical names; the other two styles
// are the named map the module readers already write.
function writeModuleEntries<TDef, TSpec>(entries: ModuleEntries<TDef, TSpec>, writeDef: (t: TDef) => JsonValue, writeSpec: (t: TSpec) => JsonValue): JsonValue {
	switch (entries.style) {
		case "names":
			return entries.names.map(writeName);
		case "definitions":
			return writeNamedMap(entries.items, writeDef);
		case "specifications":
			return writeNamedMap(entries.items, writeSpec);
	}
}

export function writeModuleManifestFile(f: ModuleManifestFile<TA, VA>): JsonValue {
	const entries: Entry[] = [
		["formatVersion", canonicalFormatVersion(f.formatVersion)],
		["path", writeModuleName(f.path)],
	];
	if (f.access === "Private") entries.push(["access", "Private"]);
	if (f.doc !== null) entries.push(["doc", f.doc]);
	entries.push(
		["types", writeModuleEntries(f.types, writeAccessControlledTypeDefinition, writeDocumentedTypeSpecification)],
		["values", writeModuleEntries(f.values, writeAccessControlledValueDefinition, writeDocumentedValueSpecification)],
	);
	if (f.fileNames.length > 0) entries.push(["fileNames", jsonObject(f.fileNames.map(([name, stem]) => [Name.canonical(name), stem] as const))]);
	return jsonObject(entries);
}

export function writeTypeDefinitionFile(f: TypeDefinitionFile<TA, VA>): JsonValue {
	return jsonObject([
		["formatVersion", canonicalFormatVersion(f.formatVersion)],
		["name", writeName(f.name)],
		f.body.kind === "def" ? ["def", writeAccessControlledTypeDefinition(f.body.value)] : ["spec", writeDocumentedTypeSpecification(f.body.value)],
	]);
}

export function writeValueDefinitionFile(f: ValueDefinitionFile<TA, VA>): JsonValue {
	return jsonObject([
		["formatVersion", canonicalFormatVersion(f.formatVersion)],
		["name", writeName(f.name)],
		f.body.kind === "def" ? ["def", writeAccessControlledValueDefinition(f.body.value)] : ["spec", writeDocumentedValueSpecification(f.body.value)],
	]);
}
