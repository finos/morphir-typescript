// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { Dict, List, Maybe } from "./index.ts";

describe("index", () => {
	test("exposes every module namespace", async () => {
		const sdk = await import("./index.ts");
		expect(Object.keys(sdk).sort()).toEqual(["Basics", "Char", "Decimal", "Dict", "Int", "List", "Maybe", "Number", "Result", "Set", "String", "Tuple"]);
	});
	test("README example", () => {
		const prices = Dict.fromList([
			["apple", 3],
			["pear", 4],
		]);
		const total = List.sum(List.filterMap((name: string) => Dict.get(name, prices), ["apple", "plum", "pear"]));
		expect(total).toBe(7);
		expect(
			Maybe.withDefault(
				"none",
				Maybe.map((p: number) => `${p}`, Dict.get("pear", prices)),
			),
		).toBe("4");
		expect(
			Maybe.withDefault(
				"none",
				Maybe.map((p: number) => `${p}`, Dict.get("plum", prices)),
			),
		).toBe("none");
	});
});
