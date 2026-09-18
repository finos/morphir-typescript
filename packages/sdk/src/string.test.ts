// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { Just, Nothing } from "./maybe.ts";
import {
	all,
	any,
	append,
	concat,
	cons,
	contains,
	dropLeft,
	dropRight,
	endsWith,
	filter,
	foldl,
	foldr,
	fromChar,
	fromFloat,
	fromInt,
	fromList,
	indexes,
	indices,
	isEmpty,
	join,
	left,
	length,
	lines,
	map,
	pad,
	padLeft,
	padRight,
	repeat,
	replace,
	reverse,
	right,
	slice,
	split,
	startsWith,
	toFloat,
	toInt,
	toList,
	toLower,
	toUpper,
	trim,
	trimLeft,
	trimRight,
	uncons,
	words,
} from "./string.ts";

describe("String", () => {
	describe("basics", () => {
		test("isEmpty", () => {
			expect(isEmpty("")).toBe(true);
			expect(isEmpty("the world")).toBe(false);
		});
		test("length counts UTF-16 code units", () => {
			expect(length("innumerable")).toBe(11);
			expect(length("")).toBe(0);
			expect(length("😃")).toBe(2);
		});
		test("reverse", () => {
			expect(reverse("stressed")).toBe("desserts");
			expect(reverse("")).toBe("");
			expect(reverse("a😃b")).toBe("b😃a");
		});
		test("repeat", () => {
			expect(repeat(3, "ha")).toBe("hahaha");
			expect(repeat(0, "ha")).toBe("");
			expect(repeat(-2, "ha")).toBe("");
		});
		test("replace replaces every occurrence", () => {
			expect(replace(".", "-", "Json.Decode.succeed")).toBe("Json-Decode-succeed");
			expect(replace(",", "/", "a,b,c,d,e")).toBe("a/b/c/d/e");
			expect(replace("x", "y", "abc")).toBe("abc");
		});
	});

	describe("building and splitting", () => {
		test("append", () => {
			expect(append("butter", "fly")).toBe("butterfly");
			expect(append("", "")).toBe("");
		});
		test("concat", () => {
			expect(concat(["never", "the", "less"])).toBe("nevertheless");
			expect(concat([])).toBe("");
		});
		test("split", () => {
			expect(split(",", "cat,dog,cow")).toEqual(["cat", "dog", "cow"]);
			expect(split("/", "home/evan/Desktop/")).toEqual(["home", "evan", "Desktop", ""]);
			expect(split(",", "")).toEqual([""]);
		});
		test("join", () => {
			expect(join("a", ["H", "w", "ii", "n"])).toBe("Hawaiian");
			expect(join(" ", ["cat", "dog", "cow"])).toBe("cat dog cow");
			expect(join(",", [])).toBe("");
		});
		test("words splits on whitespace runs after trimming", () => {
			expect(words("How are \t you? \n Good?")).toEqual(["How", "are", "you?", "Good?"]);
			expect(words("  leading and trailing  ")).toEqual(["leading", "and", "trailing"]);
			expect(words("")).toEqual([""]);
			expect(words("   ")).toEqual([""]);
		});
		test("lines splits on newlines and treats \\r\\n as one break", () => {
			expect(lines("How are you?\nGood?")).toEqual(["How are you?", "Good?"]);
			expect(lines("a\r\nb\nc\rd")).toEqual(["a", "b", "c", "d"]);
			expect(lines("")).toEqual([""]);
			expect(lines("a\n")).toEqual(["a", ""]);
		});
	});

	describe("substrings", () => {
		test("slice with Elm negative-index semantics", () => {
			expect(slice(7, 9, "snakes on a plane!")).toBe("on");
			expect(slice(0, 6, "snakes on a plane!")).toBe("snakes");
			expect(slice(0, -7, "snakes on a plane!")).toBe("snakes on a");
			expect(slice(-6, -1, "snakes on a plane!")).toBe("plane");
			expect(slice(-3, -1, "abcde")).toBe("cd");
			expect(slice(0, 3, "abcde")).toBe("abc");
			expect(slice(3, 1, "abcde")).toBe("");
		});
		test("left", () => {
			expect(left(2, "Mulder")).toBe("Mu");
			expect(left(0, "Mulder")).toBe("");
			expect(left(-1, "Mulder")).toBe("");
			expect(left(10, "Mulder")).toBe("Mulder");
		});
		test("right", () => {
			expect(right(2, "Scully")).toBe("ly");
			expect(right(0, "Scully")).toBe("");
			expect(right(-1, "Scully")).toBe("");
			expect(right(10, "Scully")).toBe("Scully");
		});
		test("dropLeft", () => {
			expect(dropLeft(2, "The Lone Gunmen")).toBe("e Lone Gunmen");
			expect(dropLeft(0, "abc")).toBe("abc");
			expect(dropLeft(-1, "abc")).toBe("abc");
			expect(dropLeft(10, "abc")).toBe("");
		});
		test("dropRight", () => {
			expect(dropRight(2, "Cigarette Smoking Man")).toBe("Cigarette Smoking M");
			expect(dropRight(0, "abc")).toBe("abc");
			expect(dropRight(-1, "abc")).toBe("abc");
			expect(dropRight(10, "abc")).toBe("");
		});
	});

	describe("checks", () => {
		test("contains", () => {
			expect(contains("the", "theory")).toBe(true);
			expect(contains("hat", "theory")).toBe(false);
			expect(contains("THE", "theory")).toBe(false);
			expect(contains("", "theory")).toBe(true);
		});
		test("startsWith", () => {
			expect(startsWith("the", "theory")).toBe(true);
			expect(startsWith("ory", "theory")).toBe(false);
		});
		test("endsWith", () => {
			expect(endsWith("the", "theory")).toBe(false);
			expect(endsWith("ory", "theory")).toBe(true);
		});
		test("indexes yields every non-overlapping match start", () => {
			expect(indexes("i", "Mississippi")).toEqual([1, 4, 7, 10]);
			expect(indexes("ss", "Mississippi")).toEqual([2, 5]);
			expect(indexes("needle", "haystack")).toEqual([]);
			expect(indexes("", "abc")).toEqual([]);
			expect(indexes("aa", "aaaa")).toEqual([0, 2]);
		});
		test("indices is an alias of indexes", () => {
			expect(indices("i", "Mississippi")).toEqual([1, 4, 7, 10]);
			expect(indices).toBe(indexes);
		});
	});

	describe("int conversions", () => {
		test("toInt", () => {
			expect(toInt("123")).toEqual(Just(123));
			expect(toInt("-42")).toEqual(Just(-42));
			expect(toInt("+7")).toEqual(Just(7));
			expect(toInt("0")).toEqual(Just(0));
			expect(toInt("3.1")).toEqual(Nothing);
			expect(toInt("1.5")).toEqual(Nothing);
			expect(toInt("31a")).toEqual(Nothing);
			expect(toInt("")).toEqual(Nothing);
			expect(toInt(" 1")).toEqual(Nothing);
			expect(toInt("1 ")).toEqual(Nothing);
			expect(toInt("-")).toEqual(Nothing);
			expect(toInt("+")).toEqual(Nothing);
			expect(toInt("0x10")).toEqual(Nothing);
		});
		test("fromInt", () => {
			expect(fromInt(123)).toBe("123");
			expect(fromInt(-42)).toBe("-42");
			expect(fromInt(0)).toBe("0");
		});
	});

	describe("float conversions", () => {
		test("toFloat", () => {
			expect(toFloat("123")).toEqual(Just(123));
			expect(toFloat("-42")).toEqual(Just(-42));
			expect(toFloat("3.1")).toEqual(Just(3.1));
			expect(toFloat("+1.5")).toEqual(Just(1.5));
			expect(toFloat("1e3")).toEqual(Just(1000));
			expect(toFloat("1.5E-2")).toEqual(Just(0.015));
			expect(toFloat("31a")).toEqual(Nothing);
			expect(toFloat("")).toEqual(Nothing);
			expect(toFloat(" 1")).toEqual(Nothing);
			expect(toFloat("1 ")).toEqual(Nothing);
			expect(toFloat("0x10")).toEqual(Nothing);
			expect(toFloat("0b1")).toEqual(Nothing);
			expect(toFloat("0o7")).toEqual(Nothing);
			expect(toFloat("-")).toEqual(Nothing);
			expect(toFloat(".")).toEqual(Nothing);
			expect(toFloat("1e")).toEqual(Nothing);
			expect(toFloat("abc")).toEqual(Nothing);
		});
		test("toFloat accepts JS numeric forms like Elm", () => {
			expect(toFloat(".5")).toEqual(Just(0.5));
			expect(toFloat("1.")).toEqual(Just(1));
		});
		test("fromFloat", () => {
			expect(fromFloat(123)).toBe("123");
			expect(fromFloat(-42)).toBe("-42");
			expect(fromFloat(3.9)).toBe("3.9");
			expect(fromFloat(1.0)).toBe("1");
			expect(fromFloat(0.1 + 0.2)).toBe("0.30000000000000004");
		});
	});

	describe("char conversions", () => {
		test("fromChar", () => {
			expect(fromChar("a")).toBe("a");
		});
		test("cons", () => {
			expect(cons("T", "he truth is out there")).toBe("The truth is out there");
			expect(cons("a", "")).toBe("a");
		});
		test("uncons", () => {
			expect(uncons("abc")).toEqual(Just(["a", "bc"]));
			expect(uncons("a")).toEqual(Just(["a", ""]));
			expect(uncons("")).toEqual(Nothing);
			expect(uncons("😃x")).toEqual(Just(["😃", "x"]));
		});
		test("toList yields code points", () => {
			expect(toList("abc")).toEqual(["a", "b", "c"]);
			expect(toList("🙈🙉🙊")).toEqual(["🙈", "🙉", "🙊"]);
			expect(toList("")).toEqual([]);
		});
		test("fromList", () => {
			expect(fromList(["a", "b", "c"])).toBe("abc");
			expect(fromList(["🙈", "🙉", "🙊"])).toBe("🙈🙉🙊");
			expect(fromList([])).toBe("");
		});
	});

	describe("formatting", () => {
		test("toUpper and toLower", () => {
			expect(toUpper("skinner")).toBe("SKINNER");
			expect(toLower("X-FILES")).toBe("x-files");
		});
		test("pad puts the extra character on the left", () => {
			expect(pad(5, " ", "1")).toBe("  1  ");
			expect(pad(5, " ", "11")).toBe("  11 ");
			expect(pad(5, " ", "121")).toBe(" 121 ");
			expect(pad(5, ".", "1")).toBe("..1..");
			expect(pad(5, ".", "11")).toBe("..11.");
			expect(pad(2, ".", "12345")).toBe("12345");
		});
		test("padLeft", () => {
			expect(padLeft(5, ".", "1")).toBe("....1");
			expect(padLeft(5, ".", "11")).toBe("...11");
			expect(padLeft(5, ".", "121")).toBe("..121");
			expect(padLeft(2, ".", "12345")).toBe("12345");
		});
		test("padRight", () => {
			expect(padRight(5, ".", "1")).toBe("1....");
			expect(padRight(5, ".", "11")).toBe("11...");
			expect(padRight(5, ".", "121")).toBe("121..");
			expect(padRight(2, ".", "12345")).toBe("12345");
		});
		test("trim, trimLeft, trimRight", () => {
			expect(trim("  hats  \n")).toBe("hats");
			expect(trimLeft("  hats  \n")).toBe("hats  \n");
			expect(trimRight("  hats  \n")).toBe("  hats");
			expect(trim("")).toBe("");
		});
	});

	describe("higher-order helpers", () => {
		test("map", () => {
			expect(map((c) => (c === "/" ? "." : c), "a/b/c")).toBe("a.b.c");
			expect(map((c) => c.toUpperCase(), "")).toBe("");
			expect(map((c) => (c === "😃" ? "!" : c), "a😃b")).toBe("a!b");
		});
		test("filter", () => {
			const isDigit = (c: string) => c >= "0" && c <= "9";
			expect(filter(isDigit, "R2-D2")).toBe("22");
			expect(filter(isDigit, "")).toBe("");
		});
		test("foldl calls f(char, acc) from the left", () => {
			expect(foldl((c, acc) => c + acc, "", "time")).toBe("emit");
			expect(foldl((_c, acc) => acc + 1, 0, "time")).toBe(4);
			expect(foldl((c, acc) => [...acc, c], [] as string[], "a😃b")).toEqual(["a", "😃", "b"]);
		});
		test("foldr calls f(char, acc) from the right", () => {
			expect(foldr((c, acc) => c + acc, "", "time")).toBe("time");
			expect(foldr((c, acc) => [...acc, c], [] as string[], "abc")).toEqual(["c", "b", "a"]);
		});
		test("any", () => {
			const isDigit = (c: string) => c >= "0" && c <= "9";
			expect(any(isDigit, "90210")).toBe(true);
			expect(any(isDigit, "R2-D2")).toBe(true);
			expect(any(isDigit, "heart")).toBe(false);
			expect(any(isDigit, "")).toBe(false);
		});
		test("all", () => {
			const isDigit = (c: string) => c >= "0" && c <= "9";
			expect(all(isDigit, "90210")).toBe(true);
			expect(all(isDigit, "R2-D2")).toBe(false);
			expect(all(isDigit, "heart")).toBe(false);
			expect(all(isDigit, "")).toBe(true);
		});
	});
});
