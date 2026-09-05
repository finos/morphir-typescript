// packages/ir/src/versions/v4/write-names.ts
//
// Canonical writers for the name vocabulary. v4 has exactly one spelling for
// every name: the canonical string. The legacy word arrays are read but never
// written, so a round trip through this binding normalizes them away.
import type { JsonValue } from "../../codec/json/value.ts";
import { FQName, ModuleName, Name, PackageName, Path } from "../../model/names.ts";

export function writeName(n: Name): JsonValue {
	return Name.canonical(n);
}
export function writePath(p: Path): JsonValue {
	return Path.canonical(p);
}
export function writePackageName(p: PackageName): JsonValue {
	return PackageName.canonical(p);
}
export function writeModuleName(m: ModuleName): JsonValue {
	return ModuleName.canonical(m);
}
export function writeFQName(fq: FQName): JsonValue {
	return FQName.canonical(fq);
}

// Names double as JSON member names (record fields, constructors, constructor
// arguments), where a JsonValue will not do.
export function nameKey(n: Name): string {
	return Name.canonical(n);
}
