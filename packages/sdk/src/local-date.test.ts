// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import * as LocalDate from "./local-date.ts";
import { Just, Nothing, withDefault } from "./maybe.ts";

const { fromCalendarDate } = LocalDate;
const fallback = fromCalendarDate(2019, "February", 1);

function iso(s: string): LocalDate.LocalDate {
	const parsed = LocalDate.fromISO(s);
	if (parsed.kind === "Nothing") throw new Error(`not an ISO date: ${s}`);
	return parsed.value;
}

describe("LocalDate", () => {
	describe("date maths", () => {
		test("add day", () => {
			expect(LocalDate.addDays(1, fromCalendarDate(2020, "January", 1))).toEqual(fromCalendarDate(2020, "January", 2));
		});
		test("subtract day", () => {
			expect(LocalDate.addDays(-1, fromCalendarDate(2020, "January", 2))).toEqual(fromCalendarDate(2020, "January", 1));
		});
		test("add week", () => {
			expect(LocalDate.addWeeks(1, fromCalendarDate(2020, "January", 7))).toEqual(fromCalendarDate(2020, "January", 14));
		});
		test("subtract week", () => {
			expect(LocalDate.addWeeks(-1, fromCalendarDate(2020, "January", 14))).toEqual(fromCalendarDate(2020, "January", 7));
		});
		test("add month", () => {
			expect(LocalDate.addMonths(1, fromCalendarDate(2020, "January", 1))).toEqual(fromCalendarDate(2020, "February", 1));
		});
		test("subtract month", () => {
			expect(LocalDate.addMonths(-1, fromCalendarDate(2020, "February", 1))).toEqual(fromCalendarDate(2020, "January", 1));
		});
		test("add year", () => {
			expect(LocalDate.addYears(1, fromCalendarDate(2020, "January", 1))).toEqual(fromCalendarDate(2021, "January", 1));
		});
		test("subtract year", () => {
			expect(LocalDate.addYears(-1, fromCalendarDate(2020, "February", 1))).toEqual(fromCalendarDate(2019, "February", 1));
		});
		test("fromISO string to localDate", () => {
			expect(withDefault(fallback, LocalDate.fromISO("2023-06-13"))).toEqual(fromCalendarDate(2023, "June", 13));
		});
		test("toISOString", () => {
			expect(LocalDate.toISOString(fromCalendarDate(2023, "June", 13))).toBe("2023-06-13");
		});
		test("fromParts", () => {
			expect(withDefault(fallback, LocalDate.fromParts(2023, 6, 9))).toEqual(fromCalendarDate(2023, "June", 9));
		});
		test("diffInDays", () => {
			expect(LocalDate.diffInDays(fromCalendarDate(2023, "June", 9), fromCalendarDate(2023, "June", 19))).toBe(10);
		});
		test("diffInWeeks", () => {
			expect(LocalDate.diffInWeeks(fromCalendarDate(2023, "June", 9), fromCalendarDate(2023, "June", 19))).toBe(1);
		});
		test("diffInMonths", () => {
			expect(LocalDate.diffInMonths(fromCalendarDate(2023, "June", 9), fromCalendarDate(2023, "June", 19))).toBe(0);
		});
		test("diffInYears", () => {
			expect(LocalDate.diffInYears(fromCalendarDate(2023, "June", 9), fromCalendarDate(2024, "June", 19))).toBe(1);
		});
	});

	describe("constructor tests", () => {
		test("valid fromISO", () => {
			expect(LocalDate.fromISO("2020-01-01")).toEqual(Just(fromCalendarDate(2020, "January", 1)));
		});
		test("invalid fromISO parsing", () => {
			expect(LocalDate.fromISO("2020-01 hello")).toBe(Nothing);
		});
		test("invalid fromISO numeric", () => {
			expect(LocalDate.fromISO("2020-01-55")).toBe(Nothing);
		});
		test("valid fromParts", () => {
			expect(LocalDate.fromParts(2020, 1, 1)).toEqual(Just(fromCalendarDate(2020, "January", 1)));
		});
		test("invalid month fromParts", () => {
			expect(LocalDate.fromParts(2020, 13, 1)).toBe(Nothing);
			expect(LocalDate.fromParts(2020, 0, 1)).toBe(Nothing);
		});
		test("invalid day fromParts", () => {
			expect(LocalDate.fromParts(2020, 2, 30)).toBe(Nothing);
			expect(LocalDate.fromParts(2020, 2, 0)).toBe(Nothing);
			expect(LocalDate.fromParts(2021, 2, 29)).toBe(Nothing);
		});
		test("valid fromCalendarDate", () => {
			expect(fromCalendarDate(2023, "December", 25)).toEqual({ kind: "LocalDate", year: 2023, month: 12, day: 25 });
		});
		test("invalid but pinned fromCalendarDate", () => {
			expect(fromCalendarDate(2023, "December", 39)).toEqual(fromCalendarDate(2023, "December", 31));
			expect(fromCalendarDate(2023, "February", 29)).toEqual(fromCalendarDate(2023, "February", 28));
			expect(fromCalendarDate(2023, "December", -4)).toEqual(fromCalendarDate(2023, "December", 1));
		});
		test("valid fromOrdinalDate", () => {
			expect(LocalDate.fromOrdinalDate(2023, 15)).toEqual(fromCalendarDate(2023, "January", 15));
			expect(LocalDate.fromOrdinalDate(2018, 269)).toEqual(fromCalendarDate(2018, "September", 26));
		});
		test("fromOrdinalDate clamps the day of the year", () => {
			expect(LocalDate.fromOrdinalDate(2023, 0)).toEqual(fromCalendarDate(2023, "January", 1));
			expect(LocalDate.fromOrdinalDate(2023, 400)).toEqual(fromCalendarDate(2023, "December", 31));
			expect(LocalDate.fromOrdinalDate(2024, 366)).toEqual(fromCalendarDate(2024, "December", 31));
		});
	});

	describe("fromISO formats", () => {
		test("year, and year and month", () => {
			expect(iso("2018")).toEqual(fromCalendarDate(2018, "January", 1));
			expect(iso("2018-09")).toEqual(fromCalendarDate(2018, "September", 1));
		});
		test("basic calendar dates", () => {
			expect(iso("20180926")).toEqual(fromCalendarDate(2018, "September", 26));
			expect(iso("201809")).toEqual(fromCalendarDate(2018, "September", 1));
		});
		test("ordinal dates", () => {
			expect(iso("2018-269")).toEqual(fromCalendarDate(2018, "September", 26));
			expect(iso("2018269")).toEqual(fromCalendarDate(2018, "September", 26));
			expect(iso("2020-366")).toEqual(fromCalendarDate(2020, "December", 31));
			expect(LocalDate.fromISO("2019-366")).toBe(Nothing);
			expect(LocalDate.fromISO("2019-000")).toBe(Nothing);
		});
		test("week dates", () => {
			expect(iso("2018-W39-3")).toEqual(fromCalendarDate(2018, "September", 26));
			expect(iso("2018W393")).toEqual(fromCalendarDate(2018, "September", 26));
			expect(iso("2018-W39")).toEqual(fromCalendarDate(2018, "September", 24));
			expect(iso("2018W39")).toEqual(fromCalendarDate(2018, "September", 24));
			expect(iso("2009-W01-1")).toEqual(fromCalendarDate(2008, "December", 29));
			expect(iso("2009-W53-7")).toEqual(fromCalendarDate(2010, "January", 3));
			expect(LocalDate.fromISO("2018-W53-1")).toBe(Nothing);
			expect(LocalDate.fromISO("2018-W00-1")).toBe(Nothing);
			expect(LocalDate.fromISO("2018-W39-8")).toBe(Nothing);
		});
		test("negative years", () => {
			expect(iso("-0001-01-01")).toEqual(fromCalendarDate(-1, "January", 1));
			expect(LocalDate.year(iso("-0000-01-01"))).toBe(0);
		});
		test("rejects all other text", () => {
			for (const s of [
				"",
				"2018-",
				"2018-9-26",
				"18-09-26",
				"2018-13-01",
				"2018-02-29",
				"2018-09-26T00:00:00",
				"2018-09-26 ",
				" 2018-09-26",
				"2018-09-261",
				"20181",
				"2018/09/26",
				"२०१८-०९-२६",
			]) {
				expect(LocalDate.fromISO(s)).toBe(Nothing);
			}
		});
		test("leap day", () => {
			expect(iso("2020-02-29")).toEqual(fromCalendarDate(2020, "February", 29));
			expect(iso("2000-02-29")).toEqual(fromCalendarDate(2000, "February", 29));
			expect(LocalDate.fromISO("1900-02-29")).toBe(Nothing);
		});
	});

	describe("toISOString", () => {
		test("pads the year, the month and the day", () => {
			expect(LocalDate.toISOString(fromCalendarDate(5, "March", 4))).toBe("0005-03-04");
			expect(LocalDate.toISOString(fromCalendarDate(-1, "March", 4))).toBe("-0001-03-04");
			expect(LocalDate.toISOString(fromCalendarDate(12345, "March", 4))).toBe("12345-03-04");
		});
		test("is the inverse of fromISO", () => {
			for (const s of ["2020-02-29", "1999-12-31", "0001-01-01", "1970-01-01", "-0400-02-29"]) {
				expect(LocalDate.toISOString(iso(s))).toBe(s);
			}
		});
	});

	describe("month and year arithmetic", () => {
		test("clamps to the end of the month", () => {
			expect(LocalDate.addMonths(1, iso("2000-01-31"))).toEqual(iso("2000-02-29"));
			expect(LocalDate.addMonths(1, iso("2001-01-31"))).toEqual(iso("2001-02-28"));
			expect(LocalDate.addMonths(-1, iso("2001-03-31"))).toEqual(iso("2001-02-28"));
			expect(LocalDate.addYears(1, iso("2020-02-29"))).toEqual(iso("2021-02-28"));
			expect(LocalDate.addYears(4, iso("2020-02-29"))).toEqual(iso("2024-02-29"));
		});
		test("crosses year boundaries", () => {
			expect(LocalDate.addMonths(2, iso("2020-11-15"))).toEqual(iso("2021-01-15"));
			expect(LocalDate.addMonths(-2, iso("2020-01-15"))).toEqual(iso("2019-11-15"));
			expect(LocalDate.addMonths(-25, iso("2020-01-15"))).toEqual(iso("2017-12-15"));
			expect(LocalDate.addMonths(12, iso("-0001-06-15"))).toEqual(iso("0000-06-15"));
		});
		test("addDays crosses month, year and leap day boundaries", () => {
			expect(LocalDate.addDays(1, iso("2020-02-28"))).toEqual(iso("2020-02-29"));
			expect(LocalDate.addDays(1, iso("2021-02-28"))).toEqual(iso("2021-03-01"));
			expect(LocalDate.addDays(1, iso("2020-12-31"))).toEqual(iso("2021-01-01"));
			expect(LocalDate.addDays(-366, iso("2021-01-01"))).toEqual(iso("2020-01-01"));
			expect(LocalDate.addDays(730485, iso("0001-01-01"))).toEqual(iso("2001-01-01"));
		});
		test("addDays is the inverse of diffInDays", () => {
			const start = iso("1999-12-25");
			for (let n = -800; n <= 800; n += 37) {
				expect(LocalDate.diffInDays(start, LocalDate.addDays(n, start))).toBe(n);
			}
		});
	});

	describe("diff", () => {
		test("counts whole units only", () => {
			expect(LocalDate.diffInMonths(iso("2020-01-02"), iso("2020-04-01"))).toBe(2);
			expect(LocalDate.diffInMonths(iso("2020-01-02"), iso("2020-04-02"))).toBe(3);
			expect(LocalDate.diffInYears(iso("2020-06-19"), iso("2023-06-18"))).toBe(2);
			expect(LocalDate.diffInYears(iso("2020-06-19"), iso("2023-06-19"))).toBe(3);
			expect(LocalDate.diffInWeeks(iso("2020-01-01"), iso("2020-01-14"))).toBe(1);
			expect(LocalDate.diffInWeeks(iso("2020-01-01"), iso("2020-01-15"))).toBe(2);
		});
		test("is negative when the second date is earlier, and truncates toward zero", () => {
			expect(LocalDate.diffInDays(iso("2023-06-19"), iso("2023-06-09"))).toBe(-10);
			expect(LocalDate.diffInWeeks(iso("2023-06-19"), iso("2023-06-09"))).toBe(-1);
			expect(LocalDate.diffInMonths(iso("2020-04-01"), iso("2020-01-02"))).toBe(-2);
			expect(LocalDate.diffInMonths(iso("2020-04-02"), iso("2020-01-02"))).toBe(-3);
			expect(LocalDate.diffInYears(iso("2023-06-18"), iso("2020-06-19"))).toBe(-2);
			expect(LocalDate.diffInYears(iso("2020-06-19"), iso("2020-06-19"))).toBe(0);
			expect(LocalDate.diffInYears(iso("2020-06-19"), iso("2020-01-19"))).toBe(0);
			expect(LocalDate.diffInWeeks(iso("2020-06-19"), iso("2020-06-18"))).toBe(0);
		});
		test("is exact for the same day of the month in all eras", () => {
			expect(LocalDate.diffInMonths(iso("0084-05-07"), iso("0086-05-07"))).toBe(24);
			expect(LocalDate.diffInMonths(iso("0001-01-13"), iso("0001-02-13"))).toBe(1);
		});
	});

	describe("query", () => {
		test("year, month, monthNumber and day", () => {
			const date = fromCalendarDate(2018, "September", 26);
			expect(LocalDate.year(date)).toBe(2018);
			expect(LocalDate.month(date)).toBe("September");
			expect(LocalDate.monthNumber(date)).toBe(9);
			expect(LocalDate.day(date)).toBe(26);
		});
		test("dayOfWeek", () => {
			expect(LocalDate.dayOfWeek(iso("2018-09-26"))).toBe("Wednesday");
			expect(LocalDate.dayOfWeek(iso("1970-01-01"))).toBe("Thursday");
			expect(LocalDate.dayOfWeek(iso("0001-01-01"))).toBe("Monday");
			expect(LocalDate.dayOfWeek(iso("0000-12-31"))).toBe("Sunday");
			const week = [0, 1, 2, 3, 4, 5, 6].map((n) => LocalDate.dayOfWeek(LocalDate.addDays(n, iso("2024-01-01"))));
			expect(week).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
		});
		test("isWeekend and isWeekday", () => {
			expect(LocalDate.isWeekend(iso("2024-01-06"))).toBe(true);
			expect(LocalDate.isWeekend(iso("2024-01-07"))).toBe(true);
			expect(LocalDate.isWeekend(iso("2024-01-08"))).toBe(false);
			expect(LocalDate.isWeekday(iso("2024-01-05"))).toBe(true);
			expect(LocalDate.isWeekday(iso("2024-01-06"))).toBe(false);
		});
	});

	describe("months", () => {
		const months: readonly LocalDate.Month[] = [
			"January",
			"February",
			"March",
			"April",
			"May",
			"June",
			"July",
			"August",
			"September",
			"October",
			"November",
			"December",
		];
		test("monthToInt", () => {
			expect(months.map(LocalDate.monthToInt)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		});
		test("intToMonth", () => {
			expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(LocalDate.intToMonth)).toEqual(months.map(Just));
			expect(LocalDate.intToMonth(0)).toBe(Nothing);
			expect(LocalDate.intToMonth(13)).toBe(Nothing);
		});
	});

	describe("compare", () => {
		test("orders by year, then month, then day", () => {
			expect(LocalDate.compare(iso("2020-01-01"), iso("2020-01-01"))).toBe("EQ");
			expect(LocalDate.compare(iso("2019-12-31"), iso("2020-01-01"))).toBe("LT");
			expect(LocalDate.compare(iso("2020-02-01"), iso("2020-01-31"))).toBe("GT");
			expect(LocalDate.compare(iso("2020-01-02"), iso("2020-01-01"))).toBe("GT");
			expect(LocalDate.compare(iso("-0001-01-01"), iso("0001-01-01"))).toBe("LT");
		});
	});

	test("values are immutable plain data without a time zone", () => {
		const date = fromCalendarDate(2020, "January", 1);
		expect(Object.isFrozen(date)).toBe(true);
		expect(LocalDate.fromISO("2020-01-01")).toEqual(Just(date));
	});
});
