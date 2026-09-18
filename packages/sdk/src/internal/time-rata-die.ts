// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Proleptic Gregorian calendar arithmetic over Rata Die day numbers (day 1 is
// 0001-01-01, a Monday), as in Elm's justinmimbs/date. All of it is integer
// arithmetic: no `Date` object and no time zone is involved.

export type CalendarDate = { readonly year: number; readonly month: number; readonly day: number };

// The Rata Die number of 1970-01-01.
export const UNIX_EPOCH_RATA_DIE = 719163;

function floorDiv(a: number, b: number): number {
	return Math.floor(a / b);
}

function floorMod(a: number, b: number): number {
	return a - b * Math.floor(a / b);
}

export function isLeapYear(year: number): boolean {
	return (floorMod(year, 4) === 0 && floorMod(year, 100) !== 0) || floorMod(year, 400) === 0;
}

export function daysInYear(year: number): number {
	return isLeapYear(year) ? 366 : 365;
}

// `month` is 1-12.
export function daysInMonth(year: number, month: number): number {
	if (month === 2) return isLeapYear(year) ? 29 : 28;
	return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function daysBeforeYear(year: number): number {
	const y = year - 1;
	return 365 * y + floorDiv(y, 4) - floorDiv(y, 100) + floorDiv(y, 400);
}

// `month` is 1-12.
export function daysBeforeMonth(year: number, month: number): number {
	let days = 0;
	for (let m = 1; m < month; m++) days += daysInMonth(year, m);
	return days;
}

// The date must be valid; no clamping happens here.
export function toRataDie(year: number, month: number, day: number): number {
	return daysBeforeYear(year) + daysBeforeMonth(year, month) + day;
}

export function yearOfRataDie(rd: number): number {
	const n400 = floorDiv(rd, 146097);
	const r400 = floorMod(rd, 146097);
	const n100 = floorDiv(r400, 36524);
	const r100 = floorMod(r400, 36524);
	const n4 = floorDiv(r100, 1461);
	const r4 = floorMod(r100, 1461);
	const n1 = floorDiv(r4, 365);
	const r1 = floorMod(r4, 365);
	return n400 * 400 + n100 * 100 + n4 * 4 + n1 + (r1 === 0 ? 0 : 1);
}

export function fromRataDie(rd: number): CalendarDate {
	const year = yearOfRataDie(rd);
	let day = rd - daysBeforeYear(year);
	let month = 1;
	for (let n = daysInMonth(year, month); day > n; n = daysInMonth(year, month)) {
		day -= n;
		month++;
	}
	return { year, month, day };
}

// 1 is Monday, 7 is Sunday.
export function weekdayNumber(rd: number): number {
	const n = floorMod(rd, 7);
	return n === 0 ? 7 : n;
}

// The day number before the first day (a Monday) of week 1 of the ISO week
// year.
export function daysBeforeWeekYear(year: number): number {
	const jan4 = daysBeforeYear(year) + 4;
	return jan4 - weekdayNumber(jan4);
}

// A year that starts on a Thursday, or a leap year that starts on a Wednesday.
export function is53WeekYear(year: number): boolean {
	const jan1 = weekdayNumber(daysBeforeYear(year) + 1);
	return jan1 === 4 || (jan1 === 3 && isLeapYear(year));
}
