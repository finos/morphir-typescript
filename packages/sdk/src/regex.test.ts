// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { Just, Nothing } from "./maybe.ts";
import * as Regex from "./regex.ts";

function regex(pattern: string): Regex.Regex {
	const made = Regex.fromString(pattern);
	if (made.kind === "Nothing") throw new Error(`not a regex: ${pattern}`);
	return made.value;
}

function regexWith(options: Regex.Options, pattern: string): Regex.Regex {
	const made = Regex.fromStringWith(options, pattern);
	if (made.kind === "Nothing") throw new Error(`not a regex: ${pattern}`);
	return made.value;
}

const matchText = (m: Regex.Match): string => m.match;

describe("Regex", () => {
	describe("fromString", () => {
		test("Nothing on a pattern that is not valid", () => {
			expect(Regex.fromString("(")).toBe(Nothing);
			expect(Regex.fromString("[a-")).toBe(Nothing);
			expect(Regex.fromString("a{2,1}")).toBe(Nothing);
		});
		test("Just on a valid pattern", () => {
			expect(Regex.fromString("[0-9]+").kind).toBe("Just");
			expect(Regex.fromString("").kind).toBe("Just");
		});
		test("is case sensitive and not multiline", () => {
			expect(Regex.contains(regex("abc"), "ABC")).toBe(false);
			expect(Regex.contains(regex("^b"), "a\nb")).toBe(false);
		});
		test("values are immutable plain data", () => {
			const re = regex("a+");
			expect(Object.isFrozen(re)).toBe(true);
			expect(re).toEqual(regex("a+"));
		});
	});

	describe("fromStringWith", () => {
		test("caseInsensitive", () => {
			const re = regexWith({ caseInsensitive: true, multiline: false }, "abc");
			expect(Regex.contains(re, "xABCx")).toBe(true);
			expect(Regex.contains(re, "a\nbc")).toBe(false);
		});
		test("multiline", () => {
			const re = regexWith({ caseInsensitive: false, multiline: true }, "^b$");
			expect(Regex.contains(re, "a\nb\nc")).toBe(true);
			expect(Regex.contains(re, "a\nB\nc")).toBe(false);
		});
		test("the two options together", () => {
			expect(Regex.contains(regexWith({ caseInsensitive: true, multiline: true }, "^b$"), "a\nB\nc")).toBe(true);
		});
		test("Nothing on a pattern that is not valid", () => {
			expect(Regex.fromStringWith({ caseInsensitive: true, multiline: true }, "(")).toBe(Nothing);
		});
	});

	describe("never", () => {
		test("matches nothing", () => {
			expect(Regex.contains(Regex.never, "")).toBe(false);
			expect(Regex.contains(Regex.never, "abc")).toBe(false);
			expect(Regex.contains(Regex.never, ".^")).toBe(false);
			expect(Regex.find(Regex.never, "abc")).toEqual([]);
			expect(Regex.split(Regex.never, "abc")).toEqual(["abc"]);
			expect(Regex.replace(Regex.never, () => "x", "abc")).toBe("abc");
		});
	});

	describe("contains", () => {
		// The examples of the elm/regex documentation.
		test("elm/regex examples", () => {
			const digit = regex("[0-9]");
			expect(Regex.contains(digit, "abc123")).toBe(true);
			expect(Regex.contains(digit, "abcxyz")).toBe(false);
		});
		test("holds no state between calls", () => {
			const re = regex("a");
			for (let i = 0; i < 4; i++) expect(Regex.contains(re, "a")).toBe(true);
		});
	});

	describe("split", () => {
		test("elm/regex examples", () => {
			const comma = regex(" *, *");
			expect(Regex.split(comma, "tom,99,90,85")).toEqual(["tom", "99", "90", "85"]);
			expect(Regex.split(comma, "tom, 99, 90, 85")).toEqual(["tom", "99", "90", "85"]);
			expect(Regex.split(comma, "tom , 99, 90, 85")).toEqual(["tom", "99", "90", "85"]);
		});
		test("no match gives the full string", () => {
			expect(Regex.split(regex(","), "abc")).toEqual(["abc"]);
			expect(Regex.split(regex(","), "")).toEqual([""]);
		});
		test("matches at the two ends give empty strings", () => {
			expect(Regex.split(regex(","), ",a,,b,")).toEqual(["", "a", "", "b", ""]);
		});
		test("capture groups are not put in the result", () => {
			expect(Regex.split(regex("(,)"), "a,b")).toEqual(["a", "b"]);
		});
		test("a pattern that matches the empty string ends", () => {
			expect(Regex.split(regex(""), "abc")).toEqual(["a", "b", "c"]);
			expect(Regex.split(regex(",*"), "a,b")).toEqual(["a", "b"]);
			expect(Regex.split(regex(""), "")).toEqual([""]);
		});
	});

	describe("splitAtMost", () => {
		test("splits at the first n matches only", () => {
			const comma = regex(",");
			expect(Regex.splitAtMost(1, comma, "tom,99,90,85")).toEqual(["tom", "99,90,85"]);
			expect(Regex.splitAtMost(2, comma, "tom,99,90,85")).toEqual(["tom", "99", "90,85"]);
			expect(Regex.splitAtMost(10, comma, "tom,99,90,85")).toEqual(["tom", "99", "90", "85"]);
		});
		test("zero or a negative number makes no split", () => {
			expect(Regex.splitAtMost(0, regex(","), "a,b")).toEqual(["a,b"]);
			expect(Regex.splitAtMost(-1, regex(","), "a,b")).toEqual(["a,b"]);
		});
	});

	describe("find", () => {
		test("elm/regex example", () => {
			const location = regex("[oi]n a (\\w+)");
			expect(Regex.find(location, "I am on a boat in a lake.")).toEqual([
				{ match: "on a boat", index: 5, number: 1, submatches: [Just("boat")] },
				{ match: "in a lake", index: 15, number: 2, submatches: [Just("lake")] },
			]);
		});
		test("a group that takes no part in the match is Nothing", () => {
			expect(Regex.find(regex("(a)|(b)"), "ab")).toEqual([
				{ match: "a", index: 0, number: 1, submatches: [Just("a"), Nothing] },
				{ match: "b", index: 1, number: 2, submatches: [Nothing, Just("b")] },
			]);
		});
		test("a group that matches the empty string is Nothing, as in elm/regex", () => {
			expect(Regex.find(regex("a(x*)"), "a")).toEqual([{ match: "a", index: 0, number: 1, submatches: [Nothing] }]);
		});
		test("no groups gives no submatches", () => {
			expect(Regex.find(regex("\\d+"), "a1b22")).toEqual([
				{ match: "1", index: 1, number: 1, submatches: [] },
				{ match: "22", index: 3, number: 2, submatches: [] },
			]);
		});
		test("no match", () => {
			expect(Regex.find(regex("x"), "abc")).toEqual([]);
		});
		test("stops after the first empty match, as elm/regex does", () => {
			expect(Regex.find(regex("a*"), "baaa")).toEqual([{ match: "", index: 0, number: 1, submatches: [] }]);
			expect(Regex.find(regex("a*"), "aab").map(matchText)).toEqual(["aa"]);
		});
		test("holds no state between calls", () => {
			const re = regex("a");
			expect(Regex.find(re, "aa").length).toBe(2);
			expect(Regex.find(re, "aa").length).toBe(2);
		});
	});

	describe("findAtMost", () => {
		test("finds the first n matches only", () => {
			const re = regex("\\d");
			expect(Regex.findAtMost(2, re, "1 2 3").map(matchText)).toEqual(["1", "2"]);
			expect(Regex.findAtMost(5, re, "1 2 3").map(matchText)).toEqual(["1", "2", "3"]);
			expect(Regex.findAtMost(0, re, "1 2 3")).toEqual([]);
			expect(Regex.findAtMost(-1, re, "1 2 3")).toEqual([]);
		});
	});

	describe("replace", () => {
		test("elm/regex examples", () => {
			const userReplace = (pattern: string, replacer: (m: Regex.Match) => string, s: string): string => Regex.replace(regex(pattern), replacer, s);
			const devowel = (s: string): string => userReplace("[aeiou]", () => "", s);
			expect(devowel("The quick brown fox")).toBe("Th qck brwn fx");
			const reverseWords = (s: string): string => userReplace("\\w+", (m) => Array.from(m.match).reverse().join(""), s);
			expect(reverseWords("deliver mined parts")).toBe("reviled denim strap");
		});
		test("gives the index, the number and the submatches to the function", () => {
			const seen: Regex.Match[] = [];
			const result = Regex.replace(
				regex("(\\w)(\\d)?"),
				(m) => {
					seen.push(m);
					return `<${m.number}>`;
				},
				"a1 b",
			);
			expect(result).toBe("<1> <2>");
			expect(seen).toEqual([
				{ match: "a1", index: 0, number: 1, submatches: [Just("a"), Just("1")] },
				{ match: "b", index: 3, number: 2, submatches: [Just("b"), Nothing] },
			]);
		});
		test("the replacement text is literal", () => {
			expect(Regex.replace(regex("b"), () => "$&$1$$", "abc")).toBe("a$&$1$$c");
		});
		test("named groups are submatches also", () => {
			const seen: Regex.Match[] = [];
			Regex.replace(
				regex("(?<word>\\w+)"),
				(m) => {
					seen.push(m);
					return "";
				},
				"ab cd",
			);
			expect(seen).toEqual([
				{ match: "ab", index: 0, number: 1, submatches: [Just("ab")] },
				{ match: "cd", index: 3, number: 2, submatches: [Just("cd")] },
			]);
		});
		test("no match gives the string unchanged", () => {
			expect(Regex.replace(regex("x"), () => "y", "abc")).toBe("abc");
		});
	});

	describe("replaceAtMost", () => {
		test("replaces the first n matches only", () => {
			const re = regex("a");
			expect(Regex.replaceAtMost(2, re, () => "b", "aaaa")).toBe("bbaa");
			expect(Regex.replaceAtMost(9, re, () => "b", "aaaa")).toBe("bbbb");
			expect(Regex.replaceAtMost(0, re, () => "b", "aaaa")).toBe("aaaa");
			expect(Regex.replaceAtMost(-1, re, () => "b", "aaaa")).toBe("aaaa");
		});
		test("does not call the function for the matches after the first n", () => {
			let calls = 0;
			Regex.replaceAtMost(
				1,
				regex("a"),
				() => {
					calls++;
					return "b";
				},
				"aaaa",
			);
			expect(calls).toBe(1);
		});
	});
});
