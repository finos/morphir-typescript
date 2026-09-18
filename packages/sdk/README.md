# @finos/morphir-sdk

The Morphir SDK runtime for TypeScript: the standard library that Morphir models compile against. Every module mirrors the matching `Morphir.SDK` module in the Morphir IR SDK specification, with Elm's function names, Elm's argument order (the data last) and plain immutable data. The package is ESM-only and depends only on `decimal.js`.

```sh
npm install @finos/morphir-sdk
```

Modules: `Basics`, `Char`, `String`, `List`, `Dict`, `Set`, `Maybe`, `Result`, `Tuple`, `Decimal`, `Int` and `Number`. Each is a subpath export (`@finos/morphir-sdk/list`) and a namespace on the root entry.

```ts
import { Dict, List, Maybe } from "@finos/morphir-sdk";

const prices = Dict.fromList([
	["apple", 3],
	["pear", 4],
]);
const total = List.sum(List.filterMap((name: string) => Dict.get(name, prices), ["apple", "plum", "pear"]));
const label = Maybe.withDefault("none", Maybe.map((p: number) => `${p}`, Dict.get("pear", prices)));
```

| Elm | TypeScript |
| --- | --- |
| `Int`, `Float` | `number` |
| `Char` | `string` holding one code point |
| `List a` | `readonly a[]` |
| `( a, b )` | `readonly [a, b]` |
| `Maybe a` | `{ kind: "Just", value } \| { kind: "Nothing" }` |
| `Result e a` | `{ kind: "Ok", value } \| { kind: "Err", error }` |
| `Order` | `"LT" \| "EQ" \| "GT"` |
| `Dict k v`, `Set a` | Sorted entry arrays ordered by the SDK's structural `compare` |
| `Decimal` | `decimal.js` `Decimal` |
| `Number` | A rational over `bigint` |

`Basics.equal` is structural, as Elm's `==` is, and `Basics.compare` orders numbers, strings, and tuples or lists of them. Where Elm's runtime raises (`modBy 0`, comparing functions), these functions throw.

Copyright 2026 FINOS. Licensed under Apache-2.0.
