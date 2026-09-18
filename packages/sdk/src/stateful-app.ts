// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.StatefulApp: the type of a stateful application. The module has
// one type and no functions. The type parameters are:
//   K - the key that partitions commands, events and state
//   C - the commands that the application accepts
//   S - the state that the application manages
//   E - the events that the application publishes
// The Elm type is `StatefulApp (Maybe s -> c -> ( Maybe s, e ))`: the logic
// gets the current state (`Nothing` before the first command) and a command,
// and gives the new state (`Nothing` deletes it) and an event. `K` does not
// occur in the logic, as in Elm; it only marks the partition key in the type.
// The constructor has the name of the type, as `Just` and `Ok` do.
import type { Maybe } from "./maybe.ts";

export interface StatefulApp<_K, C, S, E> {
	readonly kind: "StatefulApp";
	readonly logic: (state: Maybe<S>, command: C) => readonly [Maybe<S>, E];
}

export function StatefulApp<K, C, S, E>(logic: (state: Maybe<S>, command: C) => readonly [Maybe<S>, E]): StatefulApp<K, C, S, E> {
	return Object.freeze({ kind: "StatefulApp", logic } as const);
}
