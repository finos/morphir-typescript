// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Rule: business logic as a sequence of rules. A rule is a partial
// function: it gives `Just` a result when it applies to the input and `Nothing`
// when it does not. `chain` evaluates rules in order, and `any`, `is`, `anyOf`
// and `noneOf` are the cell predicates of a decision table. Equality is the
// SDK's structural `equal`, as Elm's `==` is.
import { equal } from "./internal/equal.ts";
import type { List } from "./list.ts";
import { type Maybe, Nothing } from "./maybe.ts";

export type Rule<A, B> = (a: A) => Maybe<B>;

// The first rule that matches is applied; the rules after it are not evaluated.
export function chain<A, B>(rules: List<Rule<A, B>>): Rule<A, B> {
	return (input) => {
		for (const rule of rules) {
			const result = rule(input);
			if (result.kind === "Just") return result;
		}
		return Nothing;
	};
}

export function any<A>(_value: A): boolean {
	return true;
}

export function is<A>(ref: A, value: A): boolean {
	return equal(ref, value);
}

export function anyOf<A>(ref: List<A>, value: A): boolean {
	return ref.some((item) => equal(item, value));
}

export function noneOf<A>(ref: List<A>, value: A): boolean {
	return !anyOf(ref, value);
}
