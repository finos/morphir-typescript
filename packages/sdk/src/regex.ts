// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Regex: regular expressions, with the API of elm/regex. Elm
// compiles to the JavaScript `RegExp`, so the pattern syntax and the match
// semantics here are the same as in Elm. A `Regex` is a frozen plain record of
// the pattern and the flags. Each operation makes a new `RegExp` from it, thus
// no `lastIndex` state can go from one call into the next.
import { Just, type Maybe, Nothing } from "./maybe.ts";

export type Regex = { readonly kind: "Regex"; readonly source: string; readonly flags: string };

export type Options = { readonly caseInsensitive: boolean; readonly multiline: boolean };

export type Match = {
	readonly match: string;
	// The position of the match in the string, in UTF-16 code units.
	readonly index: number;
	// 1 for the first match, 2 for the second, and so on.
	readonly number: number;
	// One entry for each capture group. `Nothing` when the group took no part
	// in the match or matched the empty string, as in elm/regex.
	readonly submatches: readonly Maybe<string>[];
};

function make(source: string, flags: string): Regex {
	return Object.freeze({ kind: "Regex", source, flags } as const);
}

function compile(regex: Regex): RegExp {
	return new RegExp(regex.source, regex.flags);
}

function submatch(group: unknown): Maybe<string> {
	return typeof group === "string" && group !== "" ? Just(group) : Nothing;
}

// Create

export function fromString(string: string): Maybe<Regex> {
	return fromStringWith({ caseInsensitive: false, multiline: false }, string);
}

// `Nothing` when the pattern is not a valid regular expression.
export function fromStringWith(options: Options, string: string): Maybe<Regex> {
	const flags = `g${options.multiline ? "m" : ""}${options.caseInsensitive ? "i" : ""}`;
	try {
		new RegExp(string, flags);
	} catch {
		return Nothing;
	}
	return Just(make(string, flags));
}

// A regular expression that matches nothing.
export const never: Regex = make(".^", "g");

// Use

export function contains(regex: Regex, string: string): boolean {
	return compile(regex).test(string);
}

export function split(regex: Regex, string: string): readonly string[] {
	return splitAtMost(Number.POSITIVE_INFINITY, regex, string);
}

export function find(regex: Regex, string: string): readonly Match[] {
	return findAtMost(Number.POSITIVE_INFINITY, regex, string);
}

export function replace(regex: Regex, replacer: (match: Match) => string, string: string): string {
	return replaceAtMost(Number.POSITIVE_INFINITY, regex, replacer, string);
}

// Splits at the first `number` matches. elm/regex does not end when a match
// is empty (`split` with the pattern ""). Here an empty match at the start of
// a piece or at the end of the string is ignored, as `String.prototype.split`
// does: the pattern "" splits "abc" into "a", "b" and "c".
export function splitAtMost(number: number, regex: Regex, string: string): readonly string[] {
	const re = compile(regex);
	const out: string[] = [];
	let start = 0;
	let remaining = number;
	while (remaining > 0) {
		const result = re.exec(string);
		if (result === null) break;
		if (result[0] === "") {
			re.lastIndex = result.index + 1;
			if (result.index === start || result.index >= string.length) continue;
		}
		out.push(string.slice(start, result.index));
		start = result.index + result[0].length;
		remaining--;
	}
	out.push(string.slice(start));
	return out;
}

// Finds the first `number` matches. The search stops at an empty match that
// does not move forward, as in elm/regex.
export function findAtMost(number: number, regex: Regex, string: string): readonly Match[] {
	const re = compile(regex);
	const out: Match[] = [];
	let prevLastIndex = -1;
	while (out.length < number) {
		const result = re.exec(string);
		if (result === null || prevLastIndex === re.lastIndex) break;
		out.push({ match: result[0], index: result.index, number: out.length + 1, submatches: result.slice(1).map(submatch) });
		prevLastIndex = re.lastIndex;
	}
	return out;
}

// Replaces the first `number` matches with the result of `replacer`. The
// result is put in literally; "$1" and "$&" have no special function.
export function replaceAtMost(number: number, regex: Regex, replacer: (match: Match) => string, string: string): string {
	let count = 0;
	// The arguments are: the match, one for each group, the index, the full
	// string and, when the pattern has named groups, the groups object.
	return string.replace(compile(regex), (match: string, ...rest: unknown[]) => {
		if (count >= number) return match;
		count++;
		const indexAt = rest.findIndex((arg) => typeof arg === "number");
		const index = rest[indexAt];
		return replacer({ match, index: typeof index === "number" ? index : 0, number: count, submatches: rest.slice(0, indexAt).map(submatch) });
	});
}
