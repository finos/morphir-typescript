// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { isNumber, isObject, type JsonObject, type JsonValue } from "../../../../ir/src/codec/json/value.ts";
import type { DecodeFault, Subject, ViolationRule } from "./diagnostics.ts";
import { subjectToWire } from "./diagnostics.ts";

export const pointerChild = (pointer: string, name: string | number) => `${pointer}/${String(name).replaceAll("~", "~0").replaceAll("/", "~1")}`;
/** Shared closed-object checks operate on lossless syntax nodes, never a JS-number conversion. */
export class Shape {
	readonly violations: { pointer: string; rule: ViolationRule }[] = [];
	readonly support: DecodeFault[] = [];
	constructor(readonly subject: Subject) {}
	add(pointer: string, rule: ViolationRule): void {
		this.violations.push({ pointer, rule });
	}
	object(value: JsonValue | undefined, pointer: string, names: readonly string[], allowed: readonly string[] = names): JsonObject | undefined {
		if (value === undefined) return undefined;
		if (!isObject(value)) {
			this.add(pointer, "invalid-type");
			return undefined;
		}
		for (const name of names) if (!value.members.has(name)) this.add(pointerChild(pointer, name), "missing-field");
		for (const name of value.members.keys()) if (!allowed.includes(name)) this.add(pointerChild(pointer, name), "unknown-field");
		return value;
	}
	array(value: JsonValue | undefined, pointer: string, nonempty = false): readonly JsonValue[] {
		if (value === undefined) return [];
		if (!Array.isArray(value)) {
			this.add(pointer, "invalid-type");
			return [];
		}
		if (nonempty && value.length === 0) this.add(pointer, "invalid-value");
		return value;
	}
	string(value: JsonValue | undefined, pointer: string, parse?: (text: string) => unknown, rule: ViolationRule = "invalid-value"): string | undefined {
		if (value === undefined) return undefined;
		if (typeof value !== "string") {
			this.add(pointer, "invalid-type");
			return undefined;
		}
		try {
			parse?.(value);
		} catch {
			this.add(pointer, rule);
		}
		return value;
	}
	literal(
		value: JsonValue | undefined,
		pointer: string,
		allowed: readonly string[],
		code: "unsupported-profile" | "unsupported-source" | "unsupported-capability" | "unsupported-payload-type" = "unsupported-profile",
	): boolean {
		const text = this.string(value, pointer);
		if (text === undefined) return false;
		if (allowed.includes(text)) return true;
		this.support.push({ phase: "support", code, witnesses: [{ kind: "unsupported", subject: subjectToWire(this.subject), pointer, value: text }] });
		return false;
	}
	positive(value: JsonValue | undefined, pointer: string): void {
		if (value === undefined) return;
		if (!isNumber(value)) {
			this.add(pointer, "invalid-type");
			return;
		}
		if (!/^[1-9][0-9]*$/.test(value.text) || BigInt(value.text) > 9007199254740991n) this.add(pointer, "invalid-value");
	}
}
export const member = (value: JsonValue | undefined, name: string): JsonValue | undefined =>
	value !== undefined && isObject(value) ? value.members.get(name) : undefined;
export function toPlain(value: JsonValue): unknown {
	if (Array.isArray(value)) return value.map(toPlain);
	if (isObject(value)) return Object.fromEntries([...value.members].map(([key, child]) => [key, toPlain(child)]));
	if (isNumber(value)) return Number(value.text); // Only invoked after number-free metadata or safe-integer policy validation.
	return value;
}
