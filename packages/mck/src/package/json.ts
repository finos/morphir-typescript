// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { parseJson } from "../../../ir/src/codec/json/value.ts";

/** Reject duplicate members before converting the syntax tree to JS values. */
export function strictJson(text: string): unknown {
	if (text.startsWith("\uFEFF")) throw new Error("leading BOM is not allowed");
	const parsed = parseJson(text);
	if (!parsed.ok) throw new Error(parsed.error.message);
	return JSON.parse(text);
}
export function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("expected object");
	return value as Record<string, unknown>;
}
export function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
	const obj = object(value);
	if (required.some((key) => !Object.hasOwn(obj, key)) || Object.keys(obj).some((key) => !required.includes(key) && !optional.includes(key))) {
		throw new Error(`expected fields ${required.join(", ")}${optional.length ? `; optional ${optional.join(", ")}` : ""}`);
	}
	return obj;
}
export function string(value: unknown): string {
	if (typeof value !== "string") throw new Error("expected string");
	return value;
}
export function nonempty(value: unknown): string {
	const result = string(value);
	if (result.length === 0) throw new Error("expected nonempty string");
	return result;
}
export function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error("expected array");
	return value;
}
export function digest(value: unknown): string {
	const result = string(value);
	if (!/^sha256:[a-f0-9]{64}$/.test(result)) throw new Error("expected sha256 digest");
	return result;
}
export function hex(value: unknown): string {
	const result = string(value);
	if (!/^(?:[a-f0-9]{2})*$/.test(result)) throw new Error("expected lowercase byte hex");
	return result;
}
