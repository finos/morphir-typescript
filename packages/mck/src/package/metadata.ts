// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { isObject, type JsonValue, parseJson } from "../../../ir/src/codec/json/value.ts";
import { PACKAGE_CONTRACT } from "./contract.ts";

function printable(value: string): string {
	if (!/^[\x20-\x7e]*$/.test(value)) throw new Error("strings and keys must be printable ASCII");
	return JSON.stringify(value);
}
function canonical(value: JsonValue, depth = 0): string {
	if (depth > 64) throw new Error("value depth exceeds 64 edges from root");
	if (typeof value === "string") return printable(value);
	if (Array.isArray(value)) return `[${value.map((child) => canonical(child, depth + 1)).join(",")}]`;
	if (isObject(value))
		return `{${[...value.members]
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, child]) => `${printable(key)}:${canonical(child, depth + 1)}`)
			.join(",")}}`;
	throw new Error("only objects, arrays and printable ASCII strings are allowed");
}
export function canonicalizePackageDocument(text: string): string {
	if (text.startsWith("\uFEFF")) throw new Error("leading BOM is not allowed");
	const result = parseJson(text);
	if (!result.ok) throw new Error(result.error.message);
	return canonical(result.value);
}
export function packageFileDigest(bytes: Uint8Array): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
export function normalizedPackageDigests(text: string): { readonly canonical: string; readonly manifestDigest: string; readonly packageContentDigest: string } {
	const normalized = canonicalizePackageDocument(text);
	return {
		canonical: normalized,
		manifestDigest: packageFileDigest(Buffer.from(normalized)),
		packageContentDigest: packageFileDigest(Buffer.from(`morphir-package-content:${PACKAGE_CONTRACT}\n${normalized}`)),
	};
}
