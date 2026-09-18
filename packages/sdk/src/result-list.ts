// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.ResultList: a list that holds a mix of failed and successful
// records, `List (Result e a)`. It models a processing pipeline where an error
// can occur at any step and must not stop the other records: each step keeps
// the items that failed before, in their positions, and works on the
// successes only.
import type { List } from "./list.ts";
import { Err, Ok, type Result } from "./result.ts";

export type ResultList<E, A> = List<Result<E, A>>;

export function fromList<A>(list: List<A>): ResultList<never, A> {
	return list.map(Ok);
}

export function errors<E, A>(resultList: ResultList<E, A>): List<E> {
	return partition(resultList)[0];
}

export function successes<E, A>(resultList: ResultList<E, A>): List<A> {
	return partition(resultList)[1];
}

export function partition<E, A>(resultList: ResultList<E, A>): readonly [List<E>, List<A>] {
	const errs: E[] = [];
	const oks: A[] = [];
	for (const result of resultList) {
		if (result.kind === "Ok") oks.push(result.value);
		else errs.push(result.error);
	}
	return [errs, oks];
}

export function filter<E, A>(f: (a: A) => boolean, resultList: ResultList<E, A>): ResultList<E, A> {
	return resultList.filter((result) => result.kind === "Err" || f(result.value));
}

// An item whose predicate fails stays in the list as that error.
export function filterOrFail<E, A>(f: (a: A) => Result<E, boolean>, resultList: ResultList<E, A>): ResultList<E, A> {
	const out: Result<E, A>[] = [];
	for (const result of resultList) {
		if (result.kind === "Err") {
			out.push(result);
			continue;
		}
		const keep = f(result.value);
		if (keep.kind === "Err") out.push(keep);
		else if (keep.value) out.push(result);
	}
	return out;
}

export function map<E, A, B>(f: (a: A) => B, resultList: ResultList<E, A>): ResultList<E, B> {
	return resultList.map((result) => (result.kind === "Ok" ? Ok(f(result.value)) : result));
}

export function mapOrFail<E, A, B>(f: (a: A) => Result<E, B>, resultList: ResultList<E, A>): ResultList<E, B> {
	return resultList.map((result) => (result.kind === "Ok" ? f(result.value) : result));
}

// `Ok` with every value when there is no error; else `Err` with every error.
export function keepAllErrors<E, A>(results: ResultList<E, A>): Result<List<E>, List<A>> {
	const [errs, oks] = partition(results);
	return errs.length === 0 ? Ok(oks) : Err(errs);
}

export function keepFirstError<E, A>(results: ResultList<E, A>): Result<E, List<A>> {
	const oks: A[] = [];
	for (const result of results) {
		if (result.kind === "Err") return result;
		oks.push(result.value);
	}
	return Ok(oks);
}
