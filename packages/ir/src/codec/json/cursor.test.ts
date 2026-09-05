// packages/ir/src/codec/json/cursor.test.ts
//
// The reader context's warning channel: a read's warnings are collected on the
// root it started from, and `windowed` decides between a canonical member and
// the legacy spelling still inside decision 0006's one-release window.
// Run with: bun test packages/ir/src/codec/json/cursor.test.ts
import { describe, expect, test } from "bun:test";
import { type JsonObject, isObject, parseJson } from "./value.ts";
import { at, newRoot, warn, windowed } from "./cursor.ts";

describe("warnings", () => {
	test("children share the root's warning list", () => {
		const root = newRoot();
		warn(at(root, "a"), "old spelling");
		expect(root.warnings.map((w) => [w.code, w.cursor])).toEqual([["legacy_spelling", "/a"]]);
	});
	test("windowed prefers canonical, warns on legacy, refuses both, and reports missing", () => {
		const obj = (text: string): JsonObject => { const p = parseJson(text); if (!p.ok || !isObject(p.value)) throw new Error("not an object"); return p.value; };
		const both = obj('{ "then": 1, "thenBranch": 2 }');
		const legacy = obj('{ "thenBranch": 2 }');
		const none = obj('{}');
		const m = (v: JsonObject) => v.members;
		let ctx = newRoot();
		expect(windowed(ctx, m(both), "then", "thenBranch", both).ok).toBe(false);
		ctx = newRoot();
		const r = windowed(ctx, m(legacy), "then", "thenBranch", legacy);
		expect(r.ok).toBe(true);
		expect(ctx.warnings[0]?.code).toBe("legacy_spelling");
		expect(ctx.warnings[0]?.message).toContain('"then"');
		ctx = newRoot();
		const miss = windowed(ctx, m(none), "then", "thenBranch", none);
		expect(!miss.ok && miss.error.code).toBe("missing_member");
	});
});
