// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { equal } from "./internal/equal.ts";
import { Just, type Maybe, Nothing } from "./maybe.ts";
import { StatefulApp } from "./stateful-app.ts";

type Command = { readonly kind: "Deposit"; readonly amount: number } | { readonly kind: "Close" };
type Event = { readonly kind: "Deposited"; readonly balance: number } | { readonly kind: "Closed" };

function logic(state: Maybe<number>, command: Command): readonly [Maybe<number>, Event] {
	if (command.kind === "Close") return [Nothing, { kind: "Closed" }];
	const balance = (state.kind === "Just" ? state.value : 0) + command.amount;
	return [Just(balance), { kind: "Deposited", balance }];
}

describe("StatefulApp", () => {
	const app: StatefulApp<string, Command, number, Event> = StatefulApp(logic);

	test("the constructor builds the tagged value", () => {
		expect(app.kind).toBe("StatefulApp");
		expect(app.logic).toBe(logic);
	});
	test("the logic maps a state and a command to a new state and an event", () => {
		expect(app.logic(Nothing, { kind: "Deposit", amount: 5 })).toEqual([Just(5), { kind: "Deposited", balance: 5 }]);
		expect(app.logic(Just(5), { kind: "Deposit", amount: 2 })).toEqual([Just(7), { kind: "Deposited", balance: 7 }]);
		expect(app.logic(Just(7), { kind: "Close" })).toEqual([Nothing, { kind: "Closed" }]);
	});
	test("the value is immutable", () => {
		expect(Object.isFrozen(app)).toBe(true);
	});
	test("an app holds a function, so structural equality throws as in Elm", () => {
		expect(() =>
			equal(
				StatefulApp(logic),
				StatefulApp((s: Maybe<number>, c: Command) => logic(s, c)),
			),
		).toThrow(TypeError);
	});
});
