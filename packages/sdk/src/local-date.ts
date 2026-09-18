// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.LocalDate: a date without a time zone, in the proleptic
// Gregorian calendar. A value is a frozen plain record of year, month (1-12)
// and day. All arithmetic runs on integer day numbers (Rata Die), so no `Date`
// object and no time zone takes part. The semantics are those of the Elm
// runtime, which delegates to justinmimbs/date: constructors clamp the day,
// `fromParts` and `fromISO` reject values that are out of range, and month and
// year arithmetic clamps to the end of the month.
//
// Build values through the constructors of this module only; the functions
// assume a valid calendar date.
import type { Order } from "./internal/compare.ts";
import { daysBeforeWeekYear, daysBeforeYear, daysInMonth, daysInYear, fromRataDie, is53WeekYear, toRataDie, weekdayNumber } from "./internal/time-rata-die.ts";
import { Just, type Maybe, Nothing } from "./maybe.ts";

export type LocalDate = {
	readonly kind: "LocalDate";
	readonly year: number;
	// 1 (January) to 12 (December).
	readonly month: number;
	readonly day: number;
};

export type DayOfWeek = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";

export type Month = "January" | "February" | "March" | "April" | "May" | "June" | "July" | "August" | "September" | "October" | "November" | "December";

const MONTHS: readonly Month[] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const DAYS_OF_WEEK: readonly DayOfWeek[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function make(year: number, monthNum: number, dayOfMonth: number): LocalDate {
	return Object.freeze({ kind: "LocalDate", year, month: monthNum, day: dayOfMonth } as const);
}

function ofRataDie(rd: number): LocalDate {
	const date = fromRataDie(rd);
	return make(date.year, date.month, date.day);
}

function rataDie(date: LocalDate): number {
	return toRataDie(date.year, date.month, date.day);
}

function clamp(low: number, high: number, n: number): number {
	return n < low ? low : n > high ? high : n;
}

// Elm's `//`; the `+ 0` turns a negative zero into zero.
function quotient(a: number, b: number): number {
	return Math.trunc(a / b) + 0;
}

// Date math

export function diffInDays(date1: LocalDate, date2: LocalDate): number {
	return rataDie(date2) - rataDie(date1);
}

export function diffInWeeks(date1: LocalDate, date2: LocalDate): number {
	return quotient(diffInDays(date1, date2), 7);
}

// The number of whole months from `date1` to `date2`. The Elm runtime finds
// this with a float (months plus day / 100); the integer form here gives the
// same result without the rounding error of that float.
export function diffInMonths(date1: LocalDate, date2: LocalDate): number {
	const months = 12 * (date2.year - date1.year) + (date2.month - date1.month);
	const days = date2.day - date1.day;
	if (months > 0 && days < 0) return months - 1;
	if (months < 0 && days > 0) return months + 1;
	return months;
}

export function diffInYears(date1: LocalDate, date2: LocalDate): number {
	return quotient(diffInMonths(date1, date2), 12);
}

export function addDays(offset: number, startDate: LocalDate): LocalDate {
	return ofRataDie(rataDie(startDate) + offset);
}

export function addWeeks(offset: number, startDate: LocalDate): LocalDate {
	return ofRataDie(rataDie(startDate) + 7 * offset);
}

// The day is clamped to the end of the month: one month after 2000-01-31 is
// 2000-02-29.
export function addMonths(offset: number, startDate: LocalDate): LocalDate {
	const wholeMonths = 12 * (startDate.year - 1) + (startDate.month - 1) + offset;
	const y = Math.floor(wholeMonths / 12) + 1;
	const m = wholeMonths - 12 * Math.floor(wholeMonths / 12) + 1;
	return make(y, m, Math.min(startDate.day, daysInMonth(y, m)));
}

export function addYears(offset: number, startDate: LocalDate): LocalDate {
	return addMonths(12 * offset, startDate);
}

// Constructors

// A day that is out of range is clamped into the month.
export function fromCalendarDate(y: number, m: Month, d: number): LocalDate {
	const monthNum = monthToInt(m);
	return make(y, monthNum, clamp(1, daysInMonth(y, monthNum), d));
}

// A day of the year that is out of range is clamped into the year.
export function fromOrdinalDate(y: number, dayOfYear: number): LocalDate {
	return ofRataDie(daysBeforeYear(y) + clamp(1, daysInYear(y), dayOfYear));
}

// `Nothing` when the month or the day is out of range; nothing is clamped.
export function fromParts(yearNumber: number, monthNum: number, dayOfMonth: number): Maybe<LocalDate> {
	if (!Number.isInteger(yearNumber) || !Number.isInteger(monthNum) || !Number.isInteger(dayOfMonth)) return Nothing;
	if (monthNum < 1 || monthNum > 12) return Nothing;
	if (dayOfMonth < 1 || dayOfMonth > daysInMonth(yearNumber, monthNum)) return Nothing;
	return Just(make(yearNumber, monthNum, dayOfMonth));
}

// The ISO 8601 date grammar of justinmimbs/date: a year of four digits with an
// optional minus sign, then one of
//   -DDD | -MM[-DD] | -Www[-D]   (extended format)
//   MM[DD] | DDD | Www[D]        (basic format)
// or nothing. A missing part is 1. Nothing can follow the date.
const ISO_DATE = /^(-?\d{4})(?:-(\d{3})|-(\d{2})(?:-(\d{2}))?|-W(\d{2})(?:-(\d))?|(\d{2})(\d{2})?|(\d{3})|W(\d{2})(\d)?)?$/;

export function fromISO(iso: string): Maybe<LocalDate> {
	const parts = ISO_DATE.exec(iso);
	if (parts === null) return Nothing;
	const num = (i: number, fallback: number): number => {
		const text = parts[i];
		return text === undefined ? fallback : Number(text);
	};
	// The `+ 0` turns the negative zero of "-0000" into zero.
	const y = num(1, 0) + 0;
	const ordinal = parts[2] ?? parts[9];
	const week = parts[5] ?? parts[10];
	if (ordinal !== undefined) {
		const od = Number(ordinal);
		return od >= 1 && od <= daysInYear(y) ? Just(ofRataDie(daysBeforeYear(y) + od)) : Nothing;
	}
	if (week !== undefined) {
		const wn = Number(week);
		const wdn = num(parts[5] !== undefined ? 6 : 11, 1);
		const validWeek = (wn >= 1 && wn <= 52) || (wn === 53 && is53WeekYear(y));
		return validWeek && wdn >= 1 && wdn <= 7 ? Just(ofRataDie(daysBeforeWeekYear(y) + (wn - 1) * 7 + wdn)) : Nothing;
	}
	return parts[3] !== undefined ? fromParts(y, num(3, 1), num(4, 1)) : fromParts(y, num(7, 1), num(8, 1));
}

// Convert

function pad(length: number, n: number): string {
	return `${n < 0 ? "-" : ""}${`${Math.abs(n)}`.padStart(length, "0")}`;
}

export function toISOString(date: LocalDate): string {
	return `${pad(4, date.year)}-${pad(2, date.month)}-${pad(2, date.day)}`;
}

export function monthToInt(m: Month): number {
	return MONTHS.indexOf(m) + 1;
}

export function intToMonth(i: number): Maybe<Month> {
	const m = MONTHS[i - 1];
	return m === undefined ? Nothing : Just(m);
}

// Query

export function year(localDate: LocalDate): number {
	return localDate.year;
}

export function month(localDate: LocalDate): Month {
	return MONTHS[localDate.month - 1] ?? "January";
}

export function monthNumber(localDate: LocalDate): number {
	return localDate.month;
}

export function day(localDate: LocalDate): number {
	return localDate.day;
}

export function dayOfWeek(localDate: LocalDate): DayOfWeek {
	return DAYS_OF_WEEK[weekdayNumber(rataDie(localDate)) - 1] ?? "Monday";
}

export function isWeekend(localDate: LocalDate): boolean {
	return weekdayNumber(rataDie(localDate)) >= 6;
}

export function isWeekday(localDate: LocalDate): boolean {
	return !isWeekend(localDate);
}

// Comparing

// Not in the SDK specification: Elm compares dates with `Date.compare`, and
// the SDK's structural `compare` does not order records.
export function compare(a: LocalDate, b: LocalDate): Order {
	const d = a.year - b.year || a.month - b.month || a.day - b.day;
	return d < 0 ? "LT" : d > 0 ? "GT" : "EQ";
}
