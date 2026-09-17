// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { isDeepStrictEqual } from "node:util";
import { array, object, string } from "../json.ts";

export const records = (value: unknown): Record<string, unknown>[] => array(value).map(object);
export function unique(values: readonly unknown[], label: string): void {
	if (new Set(values.map(canonical)).size !== values.length) throw new Error(`duplicate ${label}`);
}
export function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object")
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(object(value)[key])}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
export function equal(actual: unknown, expected: unknown, label: string): void {
	if (!isDeepStrictEqual(actual, expected)) throw new Error(`${label} mismatch`);
}
export function calendar(value: unknown, key = ""): void {
	if (typeof value === "string" && ["at", "boundary", "time", "observedAt"].includes(key) && value !== "before" && value !== "after") {
		const parsed = new Date(value);
		if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value.replace("Z", ".000Z")) throw new Error(`invalid calendar time ${value}`);
	} else if (value !== null && typeof value === "object")
		for (const [name, child] of Object.entries(value)) if (name !== "assertions" && name !== "equals") calendar(child, name);
}
export function tree(value: unknown): void {
	const entries = records(object(value).entries);
	unique(
		entries.map((entry) => entry.path),
		"tree entry path",
	);
	const paths = new Map(entries.map((entry) => [string(entry.path), entry]));
	for (const entry of entries) {
		const parts = string(entry.path).split("/");
		for (let index = 1; index < parts.length; index++)
			if (paths.get(parts.slice(0, index).join("/"))?.kind !== "directory") throw new Error(`missing tree parent ${parts.slice(0, index).join("/")}`);
		if (entry.kind === "hardlink" && paths.get(string(entry.target))?.kind !== "file")
			throw new Error(`hardlink target must be a fixed regular file ${String(entry.target)}`);
	}
}
export function sorted(
	values: readonly unknown[],
	label: string,
	compare: (a: string, b: string) => number = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)),
): void {
	unique(values, label);
	const keys = values.map((value) => (typeof value === "string" ? value : canonical(value)));
	if (keys.some((value, index) => index > 0 && compare(keys[index - 1] as string, value) >= 0)) throw new Error(`noncanonical ${label} ordering`);
}
