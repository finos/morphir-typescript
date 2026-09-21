<!--
Copyright 2026 FINOS

SPDX-License-Identifier: Apache-2.0
-->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- IR and package MCK execution, authoring checks, coverage and reports now use the released native Morphir CLI with an explicit TypeScript adapter. The npm `mck` executable and TypeScript runner, corpus, report-summary and subprocess-client APIs are removed. Direct implementation, resolver and protocol APIs remain.
- Future release assets contain five standalone adapters and two npm tarballs; standalone TypeScript drivers are no longer built. Historical releases are unchanged. The installed Node 24 adapter gate uses native MCK for IR and bounded draft.1/draft.2 package smoke cases, while IR retains its independent Node 20 artifact gate.
- Canonical YAML codec regressions now use frozen fixtures with source provenance, preserving 98 JSON/YAML pairs, 121 idempotence fences, the complete document example and nine rejected inputs.

### Added

- `@finos/morphir-sdk`, a new workspace package holding the TypeScript Morphir SDK runtime: the `Basics`, `Char`, `String`, `List`, `Dict`, `Set`, `Maybe`, `Result`, `Tuple`, `Decimal`, `Int` and `Number` modules of the `Morphir.SDK` specification as Elm-named functions in Elm argument order over plain immutable data. `Dict` and `Set` order keys with the SDK's structural `compare`, `Decimal` is a `decimal.js` value and `Number` is a rational over `bigint`. The package is registered with the suite version but is not published yet.

- The remaining modules of the `Morphir.SDK` package specification in `@finos/morphir-sdk`: `LocalDate`, `LocalTime`, `Instant`, `UUID`, `Regex`, `Aggregate`, `Rule`, `Key`, `StatefulApp` and `ResultList`, each as a namespace on the root entry and a kebab-case subpath export. `LocalDate` is a time-zone-free calendar date over integer day arithmetic; `LocalTime` is milliseconds from the epoch, as the Elm alias of `Time.Posix` is; `UUID.forName` is version 5 over a built-in synchronous SHA-1, so the package stays runtime-neutral and free of new dependencies. `Aggregate` omits the IR-inspection part of the Elm module, which the specification does not list.

## [0.3.0] - 2026-09-17

### Changed

- **Breaking:** `DecimalLiteral` in `@finos/morphir-ir` is a genuine decimal: `{ kind, lexeme, value }` where `value` is a `decimal.js` `Decimal` and `lexeme` is the text as written, which is what a writer emits. The v4 reader refuses a payload that is not a decimal lexeme (`[+-]?(digits(.digits?)?|.digits)([eE][+-]?digits)?`) with `invalid_literal`. `decimal.js` is a new dependency of `@finos/morphir-ir`.

- The embedded kit is synced to finos/morphir 2bab57ea: it gains the decimal lexeme grammar and arbitrary-precision integer cases (patterns-and-literals-0016 to 0020), closed attribute members (types-0012), annotations, partial bodies, hole reasons, bare input types, string documentation, empty `inputs`, native hints and access spellings (definitions-0020 to 0031), a single document's `$meta` and an application's definition dependencies (distributions-0009, 0010), an application's dependencies laid out as definitions under `deps/` (document-tree-0009), and three version-3 cases pinned against morphir-elm's codecs (versions-0006 to 0008). `mck run` over the embedded kit now reports 722 pass, 0 fail, 8 skipped.

### Added

- `parseDecimal`, `decimalLiteral`, `isDecimalLexeme`, `DECIMAL_LEXEME` and the types `DecimalLiteral` and `DecimalParseError` in `@finos/morphir-ir/model`. `parseDecimal` returns a `Result` whose error is a value naming the offending lexeme; `decimalLiteral` is the throwing convenience for a lexeme known to be good.

## [0.2.0] - 2026-09-16

### Added

- `formatVersions` in the adapter protocol's capabilities reply and the run report; the `mck` driver refuses a non-canonical support table.
- Support tables in `@finos/morphir-ir`'s root entry point: `parseSupportTable`, `canonicalSupportTable`, `supports`, `supportTableCompatibility`, the renderers `renderCargo`, `renderElm` and `renderProse`, the constants `DOMAIN_FLOOR` and `RELEASE_COMPONENT_MAX`, and the types `SupportTable`, `Interval`, `Release` and `SupportTableCompatibility`. A table is a set of release intervals in the canonical notation (`[3.0.0,3.1.0),[4.0.0,4.1.0)`), which is what a binding declares and what a reader checks a distribution's `formatVersion` against.
- `parseFormatVersions` in `@finos/morphir-mck`, which recovers the table from a `Capabilities` (which carries the string, not the table), and the `onHeader` option on `RunOptions`, which receives the run's header line — `runKit` no longer writes to stderr itself.

### Changed

- `@finos/morphir-ir` readers check an interval support table (`[4.0.0,4.1.0)`); `unsupported_format_version_minor` replaces `unsupported_format_version_revision`; kit synced to finos/morphir e66808b8 (distributions-0001 rejects 4.1.0, distributions-0008 reads 4.0.1, and the kit README's capabilities list names `formatVersions`).

## [0.1.0] - 2026-09-16

### Added

- The `mck` driver and its adapter protocol (contract version 1) for running the Morphir Compatibility Kit against a binding, in-process or over a child-process adapter.
- `@finos/morphir-mck`, published with the vendored kit, for checking a Morphir binding's conformance to the IR specification.
- Compiled `mck` and `mck-adapter-typescript` binaries for direct download, alongside the npm packages.
- A coverage rule and the `VOCABULARY` export from `@finos/morphir-ir/v4`, so a kit can be checked for a case covering every v4 vocabulary entry.
- A YAML profile for the v4 model: `parseYaml` and `writeYaml` under `@finos/morphir-ir/codec/yaml`, the `YAML_PROFILE` profile, and a `yaml` codec registered on `@finos/morphir-ir/v4`. The reader accepts strict, spec-legal YAML over the `yaml` package and produces the same `JsonValue` tree as `parseJson`; the canonical writer is ours.
- The document tree, under `@finos/morphir-ir/layout` and `@finos/morphir-ir/layout/node`: `readTree` and `writeTree` for the four tree-file node kinds, logical paths with no extension, and stem truncation by SHA-256 of the escaped stem for names past the filesystem limit.
- YAML and document-tree capabilities in the `mck` driver, and the `mode=read` fence key for kit cases whose fences only the read half of a codec needs to reproduce.

### Changed

- `@finos/morphir-ir` now depends on `yaml`.
- A document tree's `deps/<pkg path>/…` directories now carry an `@<version>` segment right after the package path, so a dependency's directory can never be a prefix of another's (decision 0015).
- The `mck` command line is built on `@effect/cli`: `--help` documents every command and flag, and usage errors are rendered by the library. Exit codes are unchanged (0 ok, 1 failure, 2 usage error). The command-line dependencies are bundled into the driver entry, so the published package's dependencies are unchanged.

## [0.0.1] - 2026-09-05

### Added

- A version-agnostic Morphir IR semantic model with attribute mapping and structured diagnostics.
- Morphir IR v4 types plus JSON readers and canonical writers.
- Public entry points for the current version, generic model, v4 model, and JSON value codec.
- Tag-driven npm publishing with separated artifact and publish jobs.

[Unreleased]: https://github.com/finos/morphir-typescript/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/finos/morphir-typescript/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/finos/morphir-typescript/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/finos/morphir-typescript/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/finos/morphir-typescript/releases/tag/v0.0.1
