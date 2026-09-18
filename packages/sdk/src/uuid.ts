// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.UUID: universally unique identifiers (RFC 9562, variant 1). A
// `UUID` is a branded string that holds the canonical lower-case text
// ("6ba7b810-9dad-11d1-80b4-00c04fd430c8"), so the SDK's structural `equal`
// applies to it. Make values with `parse`, `fromString` or `forName` only. The
// semantics are those of the Elm runtime, which delegates to
// TSFoster/elm-uuid.
import type { Order } from "./internal/compare.ts";
import { sha1 } from "./internal/sha1.ts";
import { Just, type Maybe, Nothing } from "./maybe.ts";
import { Err, Ok, type Result } from "./result.ts";

declare const uuidBrand: unique symbol;

export type UUID = string & { readonly [uuidBrand]: "UUID" };

// Elm's `UUID.Error`. The type is exported as `Error` also; it is declared
// under another name so that it does not shadow the global.
type UUIDError = "WrongFormat" | "WrongLength" | "UnsupportedVariant" | "IsNil" | "NoVersion";

export type { UUIDError, UUIDError as Error };

const HEX_32 = /^[0-9a-f]{32}$/;

function canonical(hex: string): UUID {
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as UUID;
}

// Convert from a known UUID string

// Accepts the canonical, URN ("urn:uuid:...") , GUID ("{...}") and compact
// formats, in upper or lower case. Spaces, tabs, line feeds and hyphens are
// ignored at all positions. The checks occur in this sequence: length, hex
// digits, nil, version (1 to 8), variant (1).
export function parse(s: string): Result<UUIDError, UUID> {
	const stripped = s.replace(/[\n\t -]/g, "").toLowerCase();
	const normalized = stripped.startsWith("urn:uuid:")
		? stripped.slice(9)
		: stripped.startsWith("{") && stripped.endsWith("}")
			? stripped.slice(1, -1)
			: stripped;
	if (normalized.length !== 32) return Err("WrongLength");
	if (!HEX_32.test(normalized)) return Err("WrongFormat");
	if (normalized === "00000000000000000000000000000000") return Err("IsNil");
	if (Number.parseInt(normalized.charAt(12), 16) > 8) return Err("NoVersion");
	if (Number.parseInt(normalized.charAt(16), 16) >> 2 !== 2) return Err("UnsupportedVariant");
	return Ok(canonical(normalized));
}

export function fromString(s: string): Maybe<UUID> {
	const parsed = parse(s);
	return parsed.kind === "Ok" ? Just(parsed.value) : Nothing;
}

// Create

// A version 5 UUID: the SHA-1 hash of the bytes of the namespace and then the
// UTF-8 bytes of the name. The same name and namespace always give the same
// UUID.
export function forName(name: string, namespace: UUID): UUID {
	const nameBytes = new TextEncoder().encode(name);
	const input = new Uint8Array(16 + nameBytes.length);
	const namespaceHex = namespace.replace(/-/g, "");
	for (let i = 0; i < 16; i++) input[i] = Number.parseInt(namespaceHex.slice(i * 2, i * 2 + 2), 16);
	input.set(nameBytes, 16);
	const hash = sha1(input).slice(0, 16);
	hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
	hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
	return canonical(Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join(""));
}

// Convert to

// The canonical text. Exported under Elm's name `toString`; declared under
// another name so that it does not shadow the global.
function uuidToString(uuid: UUID): string {
	return uuid;
}

export { uuidToString as toString };

// Comparing

// Orders as the 128-bit numbers do; for canonical lower-case text that is the
// order of the strings.
export function compare(uuid1: UUID, uuid2: UUID): Order {
	return uuid1 < uuid2 ? "LT" : uuid1 > uuid2 ? "GT" : "EQ";
}

// Nil

export const nilString: string = "00000000-0000-0000-0000-000000000000";

// True when the string is the nil UUID in any format that `parse` reads.
export function isNilString(s: string): boolean {
	const parsed = parse(s);
	return parsed.kind === "Err" && parsed.error === "IsNil";
}

// Namespaces (RFC 9562, section 6.6)

export const dnsNamespace: UUID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8" as UUID;
export const urlNamespace: UUID = "6ba7b811-9dad-11d1-80b4-00c04fd430c8" as UUID;
export const oidNamespace: UUID = "6ba7b812-9dad-11d1-80b4-00c04fd430c8" as UUID;
export const x500Namespace: UUID = "6ba7b814-9dad-11d1-80b4-00c04fd430c8" as UUID;

// Other

// The version number, 1 to 8.
export function version(uuid: UUID): number {
	return Number.parseInt(uuid.charAt(14), 16);
}
