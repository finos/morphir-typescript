<!--
Copyright 2026 FINOS

SPDX-License-Identifier: Apache-2.0
-->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The `mck` driver and its adapter protocol (contract version 1) for running the Morphir Compatibility Kit against a binding, in-process or over a child-process adapter.
- `@finos/morphir-mck`, published with the vendored kit, for checking a Morphir binding's conformance to the IR specification.
- Compiled `mck` and `mck-adapter-typescript` binaries for direct download, alongside the npm packages.
- A coverage rule and the `VOCABULARY` export from `@finos/morphir-ir/v4`, so a kit can be checked for a case covering every v4 vocabulary entry.

## [0.0.1] - 2026-09-05

### Added

- A version-agnostic Morphir IR semantic model with attribute mapping and structured diagnostics.
- Morphir IR v4 types plus JSON readers and canonical writers.
- Public entry points for the current version, generic model, v4 model, and JSON value codec.
- Tag-driven npm publishing with separated artifact and publish jobs.

[Unreleased]: https://github.com/finos/morphir-typescript/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/finos/morphir-typescript/releases/tag/v0.0.1
