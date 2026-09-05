//
// Tests for the fence info-string grammar. Run with: bun test packages/mck/src/kit/info-string.test.ts
import { describe, expect, test } from "bun:test";
import { isInfoError, parseInfoString } from "./info-string.ts";

describe("parseInfoString", () => {
	test("language and role", () => {
		expect(parseInfoString("yaml canonical")).toEqual({ language: "yaml", role: "canonical", keys: {} });
	});
	test("rejected with diagnostic", () => {
		expect(parseInfoString("json rejected diagnostic=unknown_member")).toEqual({
			language: "json",
			role: "rejected",
			keys: { diagnostic: "unknown_member" },
		});
	});
	test("file with path and set", () => {
		expect(parseInfoString("yaml file path=manifest set=lib")).toEqual({
			language: "yaml",
			role: "file",
			keys: { path: "manifest", set: "lib" },
		});
	});
	test("a fence with no role is not a data fence", () => {
		const result = parseInfoString("ts");
		expect(isInfoError(result)).toBe(true);
		if (isInfoError(result)) expect(result.message).toMatch(/^not a data fence/);
	});
	test.each([
		["yaml canonical foo=1", /unknown key "foo"/],
		["yaml rejected", /rejected needs exactly one of diagnostic or expect/],
		["yaml rejected diagnostic=a expect=B", /rejected needs exactly one of diagnostic or expect/],
		["yaml file", /file needs path/],
		["toml canonical", /unknown language "toml"/],
		["yaml maybe", /unknown role "maybe"/],
		["yaml canonical diagnostic=x", /unknown key "diagnostic"/],
	])("%s is an error", (info, pattern) => {
		const result = parseInfoString(info);
		expect(isInfoError(result)).toBe(true);
		if (isInfoError(result)) expect(result.message).toMatch(pattern);
	});
});

describe("warning key", () => {
	test("accepted takes warning=<code>", () => {
		const r = parseInfoString("json accepted warning=legacy_spelling");
		expect(isInfoError(r)).toBe(false);
		if (!isInfoError(r)) expect(r.keys["warning"]).toBe("legacy_spelling");
	});
	test("canonical does not take warning", () => {
		const r = parseInfoString("json canonical warning=legacy_spelling");
		expect(isInfoError(r) && r.message).toBe('unknown key "warning" for role canonical');
	});
	test("rejected does not take warning", () => {
		const r = parseInfoString("json rejected diagnostic=x warning=y");
		expect(isInfoError(r) && r.message).toBe('unknown key "warning" for role rejected');
	});
});
