// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import * as LocalTime from "./local-time.ts";
import { Just, Nothing, withDefault } from "./maybe.ts";

const { addHours, addMinutes, addSeconds, diffInHours, diffInMinutes, diffInSeconds, fromISO, fromMilliseconds, toMilliseconds } = LocalTime;

function time(iso: string): LocalTime.LocalTime {
	return withDefault(fromMilliseconds(0), fromISO(iso));
}

// Elm's `Time.toHour utc`, `Time.toMinute utc` and `Time.toSecond utc`.
const toHour = (t: LocalTime.LocalTime): number => new Date(toMilliseconds(t)).getUTCHours();
const toMinute = (t: LocalTime.LocalTime): number => new Date(toMilliseconds(t)).getUTCMinutes();
const toSecond = (t: LocalTime.LocalTime): number => new Date(toMilliseconds(t)).getUTCSeconds();

describe("LocalTime", () => {
	describe("time maths", () => {
		test("add hours", () => {
			expect(toHour(addHours(1, time("2022-01-28T12:56:30")))).toBe(13);
		});
		test("substract hours", () => {
			expect(toHour(addHours(-1, time("2022-01-28T12:56:30")))).toBe(11);
		});
		test("add minutes", () => {
			expect(toMinute(addMinutes(1, time("2022-01-28T12:56:30")))).toBe(57);
		});
		test("substract minutes", () => {
			expect(toMinute(addMinutes(-1, time("2022-01-28T12:56:30")))).toBe(55);
		});
		test("add seconds", () => {
			expect(toSecond(addSeconds(1, time("2022-01-28T12:56:30")))).toBe(31);
		});
		test("substract seconds", () => {
			expect(toSecond(addSeconds(-1, time("2022-01-28T12:56:30")))).toBe(29);
		});
		test("diffInMinutes", () => {
			expect(diffInMinutes(time("2022-01-28T13:49:30"), time("2022-01-28T12:56:30"))).toBe(53);
		});
		test("diffInHours less than an hour elapsed", () => {
			expect(diffInHours(time("2022-01-28T13:49:30"), time("2022-01-28T12:56:30"))).toBe(0);
		});
		test("diffInHours more than an hour elapsed", () => {
			expect(diffInHours(time("2022-01-28T15:49:30"), time("2022-01-28T12:56:30"))).toBe(2);
		});
		test("diffInSeconds", () => {
			expect(diffInSeconds(time("2022-01-28T12:58:30"), time("2022-01-28T12:56:30"))).toBe(120);
		});
		test("diffs are negative when the first time is earlier, and truncate toward zero", () => {
			expect(diffInHours(time("2022-01-28T12:56:30"), time("2022-01-28T15:49:30"))).toBe(-2);
			expect(diffInMinutes(time("2022-01-28T12:56:30"), time("2022-01-28T12:58:29"))).toBe(-1);
			expect(diffInSeconds(fromMilliseconds(0), fromMilliseconds(1999))).toBe(-1);
			expect(diffInSeconds(fromMilliseconds(0), fromMilliseconds(999))).toBe(0);
		});
		test("addition goes across days", () => {
			expect(addHours(12, time("2022-01-28T12:56:30"))).toEqual(time("2022-01-29T00:56:30"));
			expect(addSeconds(-1, time("2022-01-01T00:00:00"))).toEqual(time("2021-12-31T23:59:59"));
		});
	});

	describe("constructor tests", () => {
		test("valid fromIso", () => {
			expect(fromISO("2022-01-28T12:56:30")).toEqual(Just(fromMilliseconds(1643374590000)));
		});
		test("invalid fromISO parsing", () => {
			expect(fromISO("2022-01-28TTTTT")).toBe(Nothing);
		});
		test("invalid fromISO numeric", () => {
			expect(fromISO("12:56:30")).toBe(Nothing);
		});
		test("fromMilliseconds", () => {
			expect(fromMilliseconds(0)).toEqual({ kind: "LocalTime", milliseconds: 0 });
			expect(toMilliseconds(fromMilliseconds(1643374590000))).toBe(1643374590000);
			expect(Object.isFrozen(fromMilliseconds(0))).toBe(true);
		});
	});

	describe("fromISO formats", () => {
		test("date only", () => {
			expect(fromISO("1970-01-01")).toEqual(Just(fromMilliseconds(0)));
			expect(fromISO("19700102")).toEqual(Just(fromMilliseconds(86400000)));
			expect(fromISO("2022-01-28")).toEqual(Just(fromMilliseconds(1643328000000)));
		});
		test("fractions of a second", () => {
			expect(fromISO("1970-01-01T00:00:00.5")).toEqual(Just(fromMilliseconds(500)));
			expect(fromISO("1970-01-01T00:00:00.123")).toEqual(Just(fromMilliseconds(123)));
			expect(fromISO("1970-01-01T00:00:00.123456789")).toEqual(Just(fromMilliseconds(123)));
			expect(fromISO("1970-01-01T00:00:00.1234567890")).toBe(Nothing);
		});
		test("basic format, and no seconds", () => {
			expect(fromISO("20220128T125630")).toEqual(fromISO("2022-01-28T12:56:30"));
			expect(fromISO("2022-01-28T12:56")).toEqual(fromISO("2022-01-28T12:56:00"));
			expect(fromISO("2022-01-28T12")).toBe(Nothing);
		});
		test("UTC offsets", () => {
			expect(fromISO("2022-01-28T12:56:30Z")).toEqual(Just(fromMilliseconds(1643374590000)));
			expect(fromISO("2022-01-28T12:56:30.000Z")).toEqual(Just(fromMilliseconds(1643374590000)));
			expect(fromISO("2022-01-28T13:56:30+01:00")).toEqual(Just(fromMilliseconds(1643374590000)));
			expect(fromISO("2022-01-28T13:56:30+0100")).toEqual(Just(fromMilliseconds(1643374590000)));
			expect(fromISO("2022-01-28T13:56:30+01")).toEqual(Just(fromMilliseconds(1643374590000)));
			expect(fromISO("2022-01-28T07:26:30-05:30")).toEqual(Just(fromMilliseconds(1643374590000)));
		});
		test("before the epoch, and years before 100", () => {
			expect(fromISO("1969-12-31T23:59:59")).toEqual(Just(fromMilliseconds(-1000)));
			expect(fromISO("0001-01-01")).toEqual(Just(fromMilliseconds(-62135596800000)));
		});
		test("leap days", () => {
			expect(fromISO("2020-02-29T00:00:00")).toEqual(Just(fromMilliseconds(1582934400000)));
			expect(fromISO("2021-02-29T00:00:00")).toBe(Nothing);
		});
		test("values out of range", () => {
			for (const s of [
				"2022-13-01",
				"2022-00-01",
				"2022-01-32",
				"2022-01-00",
				"2022-04-31",
				"2022-01-28T24:00:00",
				"2022-01-28T12:60:00",
				"2022-01-28T12:00:60",
				"2022-01-28T12:00:00+24:00",
				"2022-01-28T12:00:00+01:60",
			]) {
				expect(fromISO(s)).toBe(Nothing);
			}
		});
		test("rejects all other text", () => {
			for (const s of [
				"",
				"2022",
				"2022-01",
				"22-01-28",
				" 2022-01-28",
				"2022-01-28 ",
				"2022-01-28 12:56:30",
				"2022-01-28t12:56:30",
				"2022-01-28T12:56:30z",
				"2022-01-28T12:56:30.",
				"2022-01-28T12:56:30X",
				"-2022-01-28",
			]) {
				expect(fromISO(s)).toBe(Nothing);
			}
		});
	});

	describe("compare", () => {
		test("orders by the point in time", () => {
			expect(LocalTime.compare(fromMilliseconds(1), fromMilliseconds(2))).toBe("LT");
			expect(LocalTime.compare(fromMilliseconds(2), fromMilliseconds(2))).toBe("EQ");
			expect(LocalTime.compare(fromMilliseconds(3), fromMilliseconds(2))).toBe("GT");
		});
	});
});
