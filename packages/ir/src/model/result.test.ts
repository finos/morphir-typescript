// packages/ir/src/model/result.test.ts
// Tests for the Result helpers. Run with: bun test packages/ir/src/model/result.test.ts
import { describe, expect, test } from "bun:test";
import { all, err, isOk, map, ok } from "./result.ts";

describe("Result", () => {
	test("ok and err discriminate", () => {
		expect(isOk(ok(1))).toBe(true);
		expect(isOk(err("no"))).toBe(false);
	});
	test("map applies only to ok", () => {
		expect(map(ok(2), (n) => n * 2)).toEqual({ ok: true, value: 4 });
		expect(map(err("no") as ReturnType<typeof err<string>>, (n: number) => n * 2)).toEqual({ ok: false, error: "no" });
	});
	test("all collects values or returns the first error", () => {
		expect(all([ok(1), ok(2)])).toEqual({ ok: true, value: [1, 2] });
		expect(all([ok(1), err("a"), err("b")])).toEqual({ ok: false, error: "a" });
	});
});
