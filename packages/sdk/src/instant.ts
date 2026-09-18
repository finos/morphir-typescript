// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Instant: a specific point on the timeline. The SDK specification
// gives the opaque type only, with no functions; the Elm runtime makes it an
// alias of `Time.Posix`. Here an `Instant` is a branded number: the whole
// milliseconds from 1970-01-01T00:00:00Z. Because it is a number at run time,
// the SDK's structural `equal` and `compare` apply to it.
//
// `fromMillisecondsSinceEpoch` and `toMillisecondsSinceEpoch` are additions to
// the specification. Without them a value of the opaque type could not be made
// or read.

declare const instantBrand: unique symbol;

export type Instant = number & { readonly [instantBrand]: "Instant" };

// Not in the SDK specification. Fractions of a millisecond are dropped, as
// Elm's `Time.millisToPosix` holds an `Int`. Throws a `RangeError` when the
// value is not finite.
export function fromMillisecondsSinceEpoch(millis: number): Instant {
	if (!Number.isFinite(millis)) throw new RangeError(`Instant.fromMillisecondsSinceEpoch: ${millis} is not a finite number`);
	return (Math.trunc(millis) + 0) as Instant;
}

// Not in the SDK specification.
export function toMillisecondsSinceEpoch(instant: Instant): number {
	return instant;
}
