// packages/ir/src/versions/support-table.ts
//
// Support tables from docs/spec/ir/format-version.md, "Recognition and
// compatibility": a union of intervals over release strings in Maven-style
// interval notation, one canonical spelling, membership, and the Cargo, Elm
// and prose renderings. Input accepts the full grammar; only the canonical
// spelling is ever written.
import { err, ok, type Result } from "../model/result.ts";

export const RELEASE_COMPONENT_MAX = 4294967295;

export interface Release {
	readonly major: number;
	readonly minor: number;
	readonly patch: number;
}

export interface Interval {
	readonly lower?: Release;
	readonly lowerInclusive: boolean;
	readonly upper?: Release;
	readonly upperInclusive: boolean;
}

export type SupportTable = readonly Interval[];

export type Compatibility = "supported" | "unsupported_format_version_major" | "unsupported_format_version_minor";

const COMPONENT = /^(0|[1-9][0-9]*)$/;

/**
 * The smallest release the domain has. `parseRelease` refuses a bound below
 * major 3, so an absent lower bound admits from here and not from 0.0.0: a
 * table is a set of releases the contract can name, and it names none earlier.
 */
const DOMAIN_FLOOR: Release = { major: 3, minor: 0, patch: 0 };

export function compareRelease(a: Release, b: Release): number {
	if (a.major !== b.major) return a.major < b.major ? -1 : 1;
	if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
	if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
	return 0;
}

export function releaseString(r: Release): string {
	return `${r.major}.${r.minor}.${r.patch}`;
}

function parseRelease(text: string, where: string): Result<Release, string> {
	const parts = text.split(".");
	if (parts.length !== 3 || !parts.every((p) => COMPONENT.test(p))) return err(`${where}: "${text}" is not a release string`);
	const [major, minor, patch] = parts.map(Number) as [number, number, number];
	if (major > RELEASE_COMPONENT_MAX || minor > RELEASE_COMPONENT_MAX || patch > RELEASE_COMPONENT_MAX)
		return err(`${where}: "${text}" has a component above ${RELEASE_COMPONENT_MAX}`);
	if (major < 3) return err(`${where}: release strings are valid only for major 3 and later, got "${text}"`);
	return ok({ major, minor, patch });
}

/**
 * The next release for canonicalisation: the next patch, or undefined when the
 * patch component is at its maximum. Deliberately non-carrying, so an inclusive
 * bound at the patch maximum keeps its bracket rather than moving to a release
 * of another minor that the author did not write.
 */
function next(r: Release): Release | undefined {
	return r.patch === RELEASE_COMPONENT_MAX ? undefined : { major: r.major, minor: r.minor, patch: r.patch + 1 };
}

/**
 * The release immediately after `r` in release order: the next patch, carrying
 * into the next minor and then the next major, and undefined for the maximum
 * release, which has no successor. This is the ordering question — which
 * release an exclusive bound actually admits first — and not the canonical
 * spelling question `next` answers.
 */
function successor(r: Release): Release | undefined {
	if (r.patch !== RELEASE_COMPONENT_MAX) return { major: r.major, minor: r.minor, patch: r.patch + 1 };
	if (r.minor !== RELEASE_COMPONENT_MAX) return { major: r.major, minor: r.minor + 1, patch: 0 };
	if (r.major !== RELEASE_COMPONENT_MAX) return { major: r.major + 1, minor: 0, patch: 0 };
	return undefined;
}

/** The smallest release an interval's lower bound admits, or undefined when there is none. */
function smallestAdmitted(i: Interval): Release | undefined {
	if (i.lower === undefined) return DOMAIN_FLOOR;
	return i.lowerInclusive ? i.lower : successor(i.lower);
}

/** Does `r` satisfy the interval's upper bound? A missing upper bound admits everything. */
function belowUpper(i: Interval, r: Release): boolean {
	if (i.upper === undefined) return true;
	const c = compareRelease(r, i.upper);
	return c < 0 || (c === 0 && i.upperInclusive);
}

function normaliseInterval(i: Interval, where: string): Result<Interval, string> {
	let { lower, lowerInclusive, upper, upperInclusive } = i;
	if (lower !== undefined && !lowerInclusive) {
		const n = next(lower);
		if (n !== undefined) {
			lower = n;
			lowerInclusive = true;
		}
	}
	if (upper !== undefined && upperInclusive) {
		const n = next(upper);
		if (n !== undefined) {
			upper = n;
			upperInclusive = false;
		}
	}
	if (lower === undefined) lowerInclusive = false;
	if (upper === undefined) upperInclusive = false;
	const normalised: Interval = { lower, lowerInclusive, upper, upperInclusive };
	// Empty: the smallest release the lower bound admits either does not exist
	// at all, or does not satisfy the upper bound.
	const smallest = smallestAdmitted(normalised);
	if (smallest === undefined || !belowUpper(normalised, smallest)) return err(`${where}: the interval contains no release`);
	return ok(normalised);
}

const INTERVAL = /([[(])([^[\]()]*)([\])])/y;

export function parseSupportTable(text: string): Result<SupportTable, string> {
	const intervals: Interval[] = [];
	let pos = 0;
	let first = true;
	for (;;) {
		// skip whitespace, then expect a comma between intervals
		while (pos < text.length && /\s/.test(text[pos] as string)) pos += 1;
		if (pos >= text.length) break;
		if (!first) {
			if (text[pos] !== ",") return err(`expected "," at offset ${pos} in "${text}"`);
			pos += 1;
			while (pos < text.length && /\s/.test(text[pos] as string)) pos += 1;
		}
		INTERVAL.lastIndex = pos;
		const m = INTERVAL.exec(text);
		if (m === null) return err(`expected an interval at offset ${pos} in "${text}"`);
		const raw = m[0];
		const where = raw.replace(/\s+/g, "");
		const open = m[1] as string;
		const close = m[3] as string;
		const inner = (m[2] as string).split(",").map((s) => s.trim());
		let interval: Interval;
		if (inner.length === 1) {
			if (open !== "[" || close !== "]") return err(`${where}: an exact release uses square brackets`);
			const r = parseRelease(inner[0] as string, where);
			if (!r.ok) return r;
			interval = { lower: r.value, lowerInclusive: true, upper: r.value, upperInclusive: true };
		} else if (inner.length === 2) {
			const [lo, hi] = inner as [string, string];
			if (lo === "" && hi === "") return err(`${where}: at least one bound is required`);
			let lower: Release | undefined;
			let upper: Release | undefined;
			if (lo !== "") {
				const r = parseRelease(lo, where);
				if (!r.ok) return r;
				lower = r.value;
			}
			if (hi !== "") {
				const r = parseRelease(hi, where);
				if (!r.ok) return r;
				upper = r.value;
			}
			interval = { lower, lowerInclusive: open === "[", upper, upperInclusive: close === "]" };
		} else {
			return err(`${where}: an interval has at most two bounds`);
		}
		const n = normaliseInterval(interval, where);
		if (!n.ok) return n;
		intervals.push(n.value);
		pos = INTERVAL.lastIndex;
		first = false;
	}
	if (intervals.length === 0) return err("a support table needs at least one interval");
	const merged = merge(intervals);
	// Each interval is bounded on at least one side, but two of them can cover
	// each other's open side and merge into the interval with no bounds at all.
	// That has no spelling the grammar accepts, and a table that excludes no
	// release is not a support claim, so it is rejected here rather than written.
	if (merged.some((i) => i.lower === undefined && i.upper === undefined))
		return err(`"${text}": the table admits every release; a support table must exclude some release`);
	return ok(merged);
}

function lowerKey(i: Interval): Release {
	return i.lower ?? DOMAIN_FLOOR;
}

/**
 * Does `a`'s upper reach `b`'s lower (overlap or adjacency)? Both are normalised.
 *
 * Adjacency is a question about the release set, not about the numerals, so it
 * asks `successor` the way emptiness does: nothing lies between 4.0.4294967295
 * and 4.1.0, so `[4.0.0,4.0.4294967295]` and `[4.1.0,4.2.0)` are adjacent and
 * merge. Without that, one release set would have two canonical spellings.
 */
function touches(a: Interval, b: Interval): boolean {
	if (a.upper === undefined || b.lower === undefined) return true;
	const c = compareRelease(b.lower, a.upper);
	if (c < 0) return true;
	// equal: [x,y) then [y,..) is adjacent; [x,y] then [y,..) overlaps; (y,..) after ..,y] is adjacent
	if (c === 0) return a.upperInclusive || b.lowerInclusive;
	// Above a's upper: an exclusive upper already stops short of its own bound,
	// so only an inclusive one can still be adjacent, and only to its successor.
	if (!a.upperInclusive) return false;
	const s = successor(a.upper);
	return s !== undefined && compareRelease(b.lower, s) <= 0;
}

function upperMax(a: Interval, b: Interval): Pick<Interval, "upper" | "upperInclusive"> {
	if (a.upper === undefined || b.upper === undefined) return { upper: undefined, upperInclusive: false };
	const c = compareRelease(a.upper, b.upper);
	if (c !== 0) return c > 0 ? { upper: a.upper, upperInclusive: a.upperInclusive } : { upper: b.upper, upperInclusive: b.upperInclusive };
	return { upper: a.upper, upperInclusive: a.upperInclusive || b.upperInclusive };
}

function merge(intervals: readonly Interval[]): SupportTable {
	const sorted = [...intervals].sort((a, b) => {
		if (a.lower === undefined) return b.lower === undefined ? 0 : -1;
		if (b.lower === undefined) return 1;
		return compareRelease(lowerKey(a), lowerKey(b));
	});
	const out: Interval[] = [];
	for (const i of sorted) {
		const last = out[out.length - 1];
		if (last !== undefined && touches(last, i)) {
			out[out.length - 1] = { lower: last.lower, lowerInclusive: last.lowerInclusive, ...upperMax(last, i) };
		} else {
			out.push(i);
		}
	}
	return out;
}

export function canonicalSupportTable(table: SupportTable): string {
	return table
		.map((i) => {
			const open = i.lower === undefined ? "(" : i.lowerInclusive ? "[" : "(";
			const close = i.upper === undefined ? ")" : i.upperInclusive ? "]" : ")";
			return `${open}${i.lower ? releaseString(i.lower) : ""},${i.upper ? releaseString(i.upper) : ""}${close}`;
		})
		.join(",");
}

function contains(i: Interval, r: Release): boolean {
	// An absent lower bound reaches down to the domain floor and no further, so
	// the floor is checked here rather than only where a bound is written: a
	// table cannot contain a release the domain does not have.
	if (compareRelease(r, DOMAIN_FLOOR) < 0) return false;
	if (i.lower !== undefined) {
		const c = compareRelease(i.lower, r);
		if (c > 0 || (c === 0 && !i.lowerInclusive)) return false;
	}
	return belowUpper(i, r);
}

export function supports(table: SupportTable, release: Release): boolean {
	return table.some((i) => contains(i, release));
}

/**
 * Does the interval contain at least one release of major `major`? The question
 * is about containment, not about the majors the bounds happen to be spelled
 * with: `[3.0.0,4.0.0)` holds no release of major 4, while `[3.0.0,4.0.1)`
 * holds 4.0.0.
 */
function containsMajor(i: Interval, major: number): boolean {
	const familyStart: Release = { major, minor: 0, patch: 0 };
	const admitted = smallestAdmitted(i);
	if (admitted === undefined) return false;
	// The smallest release the interval admits at or above the family's first
	// release: the family's first release when the lower bound is below it,
	// otherwise the lower bound's own smallest admitted release.
	const candidate = compareRelease(admitted, familyStart) < 0 ? familyStart : admitted;
	return candidate.major === major && belowUpper(i, candidate);
}

export function compatibility(table: SupportTable, release: Release): Compatibility {
	if (supports(table, release)) return "supported";
	return table.some((i) => containsMajor(i, release.major)) ? "unsupported_format_version_minor" : "unsupported_format_version_major";
}

export function renderCargo(table: SupportTable): readonly string[] {
	return table.map((i) => {
		// Defensive: `parseSupportTable` rejects a bounds-free interval, so this
		// is unreachable from parsed input. An empty comparator set would read as
		// "any version" by accident, so say it on purpose or not at all.
		if (i.lower === undefined && i.upper === undefined) return "*";
		const parts: string[] = [];
		if (i.lower !== undefined) parts.push(`${i.lowerInclusive ? ">=" : ">"}${releaseString(i.lower)}`);
		if (i.upper !== undefined) parts.push(`${i.upperInclusive ? "<=" : "<"}${releaseString(i.upper)}`);
		return parts.join(", ");
	});
}

export function renderElm(table: SupportTable): Result<readonly string[], string> {
	const out: string[] = [];
	for (const i of table) {
		if (i.lower === undefined || i.upper === undefined) return err(`Elm constraints need both bounds; ${canonicalSupportTable([i])} has none on one side`);
		if (!i.lowerInclusive || i.upperInclusive) return err(`Elm constraints are a <= v < b; ${canonicalSupportTable([i])} cannot be advanced to that shape`);
		out.push(`${releaseString(i.lower)} <= v < ${releaseString(i.upper)}`);
	}
	return ok(out);
}

export function renderProse(table: SupportTable): string {
	return table
		.map((i) => {
			const lo = i.lower === undefined ? undefined : releaseString(i.lower);
			const hi = i.upper === undefined ? undefined : releaseString(i.upper);
			// Defensive, as in renderCargo: unreachable from parsed input, and
			// better said plainly than interpolated as "earlier than undefined".
			if (lo === undefined && hi === undefined) return "every release";
			if (lo === undefined) return i.upperInclusive ? `${hi} and earlier` : `earlier than ${hi}`;
			if (hi === undefined) return `${lo} and later`;
			const start = i.lowerInclusive ? lo : `after ${lo}`;
			return i.upperInclusive ? `${start} through ${hi}` : `${start} up to but not including ${hi}`;
		})
		.join(", or ");
}
