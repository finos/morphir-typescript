<!--
Copyright 2026 FINOS

SPDX-License-Identifier: Apache-2.0
-->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-16

### Added

- `formatVersions` in the adapter protocol's capabilities reply and the run report; the `mck` driver refuses a non-canonical support table.

### Changed

- `@finos/morphir-ir` readers check an interval support table (`[4.0.0,4.1.0)`); `unsupported_format_version_minor` replaces `unsupported_format_version_revision`; kit synced to finos/morphir 13233135 (distributions-0001 rejects 4.1.0, distributions-0008 reads 4.0.1).

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

[Unreleased]: https://github.com/finos/morphir-typescript/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/finos/morphir-typescript/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/finos/morphir-typescript/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/finos/morphir-typescript/releases/tag/v0.0.1
