// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Elm's structural `==`. Primitives compare with `===` (so NaN /= NaN, as in
// Elm); arrays element-wise; plain objects and tagged unions key by key. A
// decimal.js Decimal compares by numeric value, so 1.50 == 1.5. Dict and Set
// values are plain objects whose `entries` are sorted, so the generic object
// walk already compares them correctly. Functions throw, as Elm's runtime does.
import { Decimal } from "decimal.js";

export function equal<A>(a: A, b: A): boolean {
	return eq(a, b);
}

function eq(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a === "function" || typeof b === "function") {
		throw new TypeError("equal: cannot compare functions");
	}
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
		return true;
	}
	if (a instanceof Decimal || b instanceof Decimal) {
		return a instanceof Decimal && b instanceof Decimal && a.eq(b);
	}
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	const ra = a as Record<string, unknown>;
	const rb = b as Record<string, unknown>;
	for (const k of ka) {
		if (!Object.hasOwn(rb, k) || !eq(ra[k], rb[k])) return false;
	}
	return true;
}
