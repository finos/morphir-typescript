// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The package entry point: one namespace per Morphir.SDK module, named as the
// Elm modules are. Each module is also a subpath export
// ("@finos/morphir-sdk/list", "@finos/morphir-sdk/local-date") for callers that
// want tree-shaking by module.
export * as Aggregate from "./aggregate.ts";
export * as Basics from "./basics.ts";
export * as Char from "./char.ts";
export * as Decimal from "./decimal.ts";
export * as Dict from "./dict.ts";
export * as Instant from "./instant.ts";
export * as Int from "./int.ts";
export * as Key from "./key.ts";
export * as List from "./list.ts";
export * as LocalDate from "./local-date.ts";
export * as LocalTime from "./local-time.ts";
export * as Maybe from "./maybe.ts";
export * as Number from "./number.ts";
export * as Regex from "./regex.ts";
export * as Result from "./result.ts";
export * as ResultList from "./result-list.ts";
export * as Rule from "./rule.ts";
export * as Set from "./set.ts";
export * as StatefulApp from "./stateful-app.ts";
export * as String from "./string.ts";
export * as Tuple from "./tuple.ts";
export * as UUID from "./uuid.ts";
