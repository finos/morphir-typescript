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
		const canonical = obj('{ "then": 1 }');
		const legacy = obj('{ "thenBranch": 2 }');
		const none = obj('{}');
		const m = (v: JsonObject) => v.members;
		let ctx = newRoot();
		const dup = windowed(ctx, m(both), "then", "thenBranch", both);
		expect(dup.ok).toBe(false);
		// The error names the spelling the document should drop, not the one it
		// should keep, so the cursor points at the legacy key.
		expect(!dup.ok && dup.error.code).toBe("unknown_member");
		expect(!dup.ok && dup.error.cursor).toBe("/thenBranch");
		ctx = newRoot();
		const good = windowed(ctx, m(canonical), "then", "thenBranch", canonical);
		// The answer names the key that won, so a caller reads the payload under
		// the cursor the document actually spelled.
		expect(good.ok && good.value.key).toBe("then");
		expect(good.ok && good.value.value).toBe(m(canonical).get("then") ?? null);
		expect(ctx.warnings).toEqual([]);
		ctx = newRoot();
		const r = windowed(ctx, m(legacy), "then", "thenBranch", legacy);
		expect(r.ok).toBe(true);
		expect(r.ok && r.value.key).toBe("thenBranch");
		expect(r.ok && r.value.value).toBe(m(legacy).get("thenBranch") ?? null);
		expect(ctx.warnings[0]?.code).toBe("legacy_spelling");
		expect(ctx.warnings[0]?.cursor).toBe("/thenBranch");
		expect(ctx.warnings[0]?.message).toContain('"then"');
		ctx = newRoot();
		const miss = windowed(ctx, m(none), "then", "thenBranch", none);
		expect(!miss.ok && miss.error.code).toBe("missing_member");
	});
});
