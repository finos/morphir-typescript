// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.LocalTime: a point in time without a time zone. In the Elm
// runtime a `LocalTime` is a `Time.Posix`: a count of milliseconds from
// 1970-01-01T00:00:00, and not a time of day. Thus the arithmetic does not
// wrap at midnight, and `fromISO` reads a full ISO 8601 date and time
// ("2022-01-28T12:56:30"); a time alone ("12:56:30") gives `Nothing`. A value
// is a frozen plain record. No `Date` object and no local time zone takes
// part.
import type { Order } from "./internal/compare.ts";
import { daysInMonth, toRataDie, UNIX_EPOCH_RATA_DIE } from "./internal/time-rata-die.ts";
import { Just, type Maybe, Nothing } from "./maybe.ts";

export type LocalTime = {
	readonly kind: "LocalTime";
	// Milliseconds from 1970-01-01T00:00:00.
	readonly milliseconds: number;
};

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60000;
const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

// Constructors

export function fromMilliseconds(millis: number): LocalTime {
	return Object.freeze({ kind: "LocalTime", milliseconds: millis } as const);
}

// The grammar of Elm's rtfeldman/elm-iso8601-date-strings:
//   YYYY[-]MM[-]DD [ T hh[:]mm[[:]ss][.fraction] [ Z | (+|-)hh[[:]mm] ] ]
// The fraction has 1 to 9 digits and is rounded to the millisecond. A value
// without an offset is read as UTC.
const ISO_DATE_TIME = /^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2})(?::?(\d{2}))?(?:\.(\d{1,9}))?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)?)?$/;

export function fromISO(iso: string): Maybe<LocalTime> {
	const parts = ISO_DATE_TIME.exec(iso);
	if (parts === null) return Nothing;
	const num = (i: number): number => {
		const text = parts[i];
		return text === undefined ? 0 : Number(text);
	};
	const year = num(1);
	const month = num(2);
	const day = num(3);
	const hour = num(4);
	const minute = num(5);
	const second = num(6);
	const offsetHours = num(9);
	const offsetMinutes = num(10);
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return Nothing;
	if (hour > 23 || minute > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59) return Nothing;
	const fraction = parts[7] === undefined ? 0 : Math.round(Number(`0.${parts[7]}`) * MS_PER_SECOND);
	const offset = (parts[8] === "-" ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
	const days = toRataDie(year, month, day) - UNIX_EPOCH_RATA_DIE;
	return Just(fromMilliseconds(days * MS_PER_DAY + hour * MS_PER_HOUR + (minute - offset) * MS_PER_MINUTE + second * MS_PER_SECOND + fraction));
}

// Not in the SDK specification: the inverse of `fromMilliseconds`.
export function toMilliseconds(time: LocalTime): number {
	return time.milliseconds;
}

// Time math

export function addHours(hours: number, time: LocalTime): LocalTime {
	return fromMilliseconds(time.milliseconds + hours * MS_PER_HOUR);
}

export function addMinutes(minutes: number, time: LocalTime): LocalTime {
	return fromMilliseconds(time.milliseconds + minutes * MS_PER_MINUTE);
}

export function addSeconds(seconds: number, time: LocalTime): LocalTime {
	return fromMilliseconds(time.milliseconds + seconds * MS_PER_SECOND);
}

// The differences are `timeA - timeB` in whole units, truncated toward zero.

// Elm's `//`; the `+ 0` turns a negative zero into zero.
function quotient(a: number, b: number): number {
	return Math.trunc(a / b) + 0;
}

export function diffInHours(timeA: LocalTime, timeB: LocalTime): number {
	return quotient(timeA.milliseconds - timeB.milliseconds, MS_PER_HOUR);
}

export function diffInMinutes(timeA: LocalTime, timeB: LocalTime): number {
	return quotient(timeA.milliseconds - timeB.milliseconds, MS_PER_MINUTE);
}

export function diffInSeconds(timeA: LocalTime, timeB: LocalTime): number {
	return quotient(timeA.milliseconds - timeB.milliseconds, MS_PER_SECOND);
}

// Comparing

// Not in the SDK specification: the SDK's structural `compare` does not order
// records.
export function compare(a: LocalTime, b: LocalTime): Order {
	return a.milliseconds < b.milliseconds ? "LT" : a.milliseconds > b.milliseconds ? "GT" : "EQ";
}
