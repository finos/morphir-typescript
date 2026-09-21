[![FINOS - Graduated](https://cdn.jsdelivr.net/gh/finos/contrib-toolbox@master/images/badge-graduated.svg)](https://community.finos.org/docs/governance/lifecycle-stages/graduated)
[![CI](https://github.com/finos/morphir-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/finos/morphir-typescript/actions/workflows/ci.yml)

# morphir-typescript

`morphir-typescript` is the TypeScript reference binding for the [Morphir Intermediate Representation](https://morphir.finos.org/docs/spec/ir/morphir-ir-specification). It provides a version-agnostic semantic model, the Morphir IR v4 model and JSON codec, TypeScript adapters, and package implementation helpers for the Morphir Compatibility Kit.

Morphir captures business logic and domain models as language-independent data so tools can analyze, transform, serialize, and execute the same model across platforms. The authoritative specifications and compatibility corpus live in the [`finos/morphir`](https://github.com/finos/morphir) repository. This project implements those contracts for TypeScript. It is separate from the [Morphir TypeScript code-generation backend](https://morphir.finos.org/docs/reference/backends/other-platforms/typescript-api), which generates TypeScript APIs from Morphir models.

## Project status

`@finos/morphir-ir` and `@finos/morphir-mck` are published to public npm at suite version `0.3.0`. The root workspace stays private and is never published. Every workspace uses the same repository-wide suite version, including packages that are not part of a given release, and the manifests read the last released version until release preparation bumps them.

The native Morphir Compatibility Kit is vendored into `vendor/morphir-mck`, so `mise run check:conformance` runs the full kit with the pinned native CLI and explicit TypeScript adapter in a standalone clone. Two corpora are still not vendored: the naming and format-version conformance fixtures, which live only in `finos/morphir` at `docs/spec/ir/fixtures/`. `mise run test` therefore sets `MORPHIR_FIXTURES_OPTIONAL=1`, which makes those two corpora — and nothing else — optional when they are absent. That opt-out goes away once they are vendored too.

## Packages

| Package | Publication | Purpose |
| --- | --- | --- |
| `@finos/morphir-ir` | Published to public npm at `0.3.0` | Generic Morphir IR semantic types, pinned v4 types, JSON readers and canonical writers, diagnostics, and attribute mapping. |
| `@finos/morphir-mck` | Published to public npm at `0.3.0` | TypeScript IR and package adapters, implementation libraries and protocol helpers. Compatibility runs through the native Morphir CLI. |
| `@finos/morphir-sdk` | Not yet published | The Morphir SDK runtime: Elm-named functions over plain immutable data for every module of the `Morphir.SDK` specification, from Basics, List and Dict to LocalDate, UUID, Regex and Aggregate. |

## Morphir specifications

- [Morphir documentation](https://morphir.finos.org/docs/)
- [Core Morphir repository](https://github.com/finos/morphir)
- [Morphir IR specification](https://morphir.finos.org/docs/spec/ir/morphir-ir-specification)
- [IR v4 specifications](https://morphir.finos.org/docs/spec/draft/)
- [IR v4 schemas and serialization profiles](https://morphir.finos.org/docs/spec/ir/schemas/v4/)
- [Morphir Compatibility Kit](https://github.com/finos/morphir/tree/main/spec/ir/mck)

## Source setup

Install [mise](https://mise.jdx.dev/), then clone and set up the repository:

```sh
git clone https://github.com/finos/morphir-typescript.git
cd morphir-typescript
mise install
mise run setup
```

mise installs the pinned Bun, Node.js, and actionlint versions. The setup task installs workspace dependencies from `bun.lock` without changing the lockfile.

## Usage

### Read and write Morphir IR v4 JSON

From a TypeScript file at the repository root:

```ts
import { json } from "./packages/ir/src/index.ts";

const source = `{ "formatVersion": 4, "distribution": { "Library": { "packageName": "example", "dependencies": {}, "def": { "modules": {} } } } }`;
const result = json.read(source);

if (!result.ok) {
	throw new Error(`${result.error.code} at ${result.error.cursor}: ${result.error.message}`);
}

console.log(json.write(result.value));
```

The reader returns a typed result with structured diagnostics. The writer emits the canonical v4 JSON representation.

### Read and write Morphir IR v4 YAML

`@finos/morphir-ir/codec/yaml` reads and writes the same `JsonValue` tree as the JSON codec, over the `yaml` package:

```ts
import { parseYaml, writeYaml } from "./packages/ir/src/codec/yaml/index.ts";

const result = parseYaml("formatVersion: 4\n");
if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);

console.log(writeYaml(result.value));
```

The reader accepts strict, spec-legal YAML; no v4 reader learns about YAML itself, so the same decoders run over either codec. The writer is canonical and ours: it never calls the `yaml` package's stringifier.

### Read and write the document tree

`@finos/morphir-ir/layout` and `@finos/morphir-ir/layout/node` lay a distribution out as a tree of files — a manifest, module definitions, module specifications, and dependency copies — under logical paths that carry no extension until a profile picks one:

```ts
import { readTree, writeTree } from "./packages/ir/src/layout/index.ts";
import { readTreeFromDirectory, writeTreeToDirectory } from "./packages/ir/src/layout/node.ts";
```

`./layout` works against an in-memory `DocumentTree`; `./layout/node` is the one entry point in the package that touches the filesystem, reading and writing that tree at a real directory. A stem too long for the filesystem is truncated and replaced with the first eight hex digits of the SHA-256 hash of its untruncated, escaped form, after `__`.

### Check IR conformance

Install the [native Morphir CLI](https://github.com/finos/morphir/releases) and `@finos/morphir-mck` separately, then run:

```sh
morphir mck kit vendor --source embedded --dest ./mck-kit
morphir mck check ./mck-kit
morphir mck run --kit ./mck-kit --adapter mck-adapter-typescript --report ir-report.json
```

The npm package provides the adapter executable but no compatibility runner. Use `morphir mck package run` for package contracts. See the [consumer migration instructions](packages/mck/README.md#migrating-ir-consumers) for report validation, local Node adapters and removed library APIs.

## Development

TypeScript is the implementation language. Bun supplies the runtime, package manager, task runtime, and default `bun:test` testing framework. The npm artifact uses `Bun.build` to compile unminified ESM and TypeScript to emit declarations. Node.js 24 is the development runtime and runs the installed MCK compatibility check. The IR package retains Node.js 20 support and its artifact check explicitly runs pinned Node.js 20.20.2 through mise. Biome handles linting and formatting.

Effect is the preferred foundation for future service and integration work. It is not currently a dependency and must remain outside the core `@finos/morphir-ir` package; add it to a specific non-core package when that package begins using it.

Use mise tasks for repository automation:

| Command | Purpose |
| --- | --- |
| `mise run setup` | Install dependencies from the frozen Bun lockfile. |
| `mise run check:lint` | Check Biome lint rules, formatting, and imports. |
| `mise run check:typecheck` | Typecheck every workspace package. |
| `mise run check:package` | Build and verify the `@finos/morphir-ir` and `@finos/morphir-mck` tarballs in `.dev/out/package-check`. |
| `mise run check:workflows` | Validate GitHub Actions workflows with the pinned actionlint version. |
| `mise run check:kit` | Verify the native managed kit and run native authoring gates with the pinned CLI. |
| `mise run check:conformance` | Run the native kit against the explicit TypeScript adapter, check the native report and render HTML. |
| `mise run check:native-kit` | Alias entry point for the same native kit gates. |
| `mise run check:native-conformance` | Alias entry point for the same native conformance gates. |
| `mise run test` | Run the available Bun test suite. |
| `mise run ci` | Run the same checks as GitHub Actions. |
| `mise run release:prepare -- VERSION` | Update the suite version and finalize the Keep a Changelog release entry. |
| `mise run release:validate -- TAG` | Validate a `vVERSION` tag against the suite manifests and changelog. |
| `mise run release:artifact -- OUTPUT_DIRECTORY` | Build and verify both publishable tarballs in the requested directory. |
| `mise run release:binaries -- OUTPUT_DIRECTORY` | Compile `mck-adapter-typescript` to single-file binaries for every release target. Set `MCK_BINARY_TARGETS=host` to compile only this machine's target. |
| `mise run release:adapter-binaries -- OUTPUT_DIRECTORY` | Compile only `mck-adapter-typescript`, with the same target selection and asset names. No driver or embedded kit is needed by the adapter. |

The adapter-only build keeps both IR and experimental package protocol support.
Future suite releases produce five adapter executables and both npm packages.
Historical standalone driver assets remain unchanged; the npm package exposes only the adapter bin.
`@finos/morphir-ir` keeps its Node 20 installed-package gate; the MCK npm package
keeps its Node 24 requirement. Compiled adapters need neither runtime installed.

To exercise a compiled adapter against a native CLI, supply an absolute path:

```sh
MORPHIR_MCK_NATIVE_CLI=/absolute/path/to/morphir \
  mise exec -- bun test ./scripts/release/binaries.test.ts
```

This runs the CLI and adapter from a fresh directory with an empty `PATH`, vendors
the CLI's embedded kit, runs it and independently checks the resulting report.
It complements the always-on adapter build-boundary and IR/package protocol tests.
It does not disable operating-system network access or certify other platforms.

### Native IR conformance

`check:kit` and `check:conformance` use the native CLI. The installed Node 24
adapter gate also uses that CLI and the managed kit. The legacy TypeScript IR
and package runners and their parity gates have been retired.

The production pin is `.config/mck-cli.json`, containing an exact `version` and a
`sha256` object with archive digests for all six native release target triples.
The installer verifies the selected archive before extraction and checks its
cached receipt and executable digest on reuse. The managed kit lives at
`vendor/morphir-mck`, acquired from `finos/morphir` commit
`48977b55ec1c1ccf834837fe1912e01615071d46` with a CLI-generated `mck-kit.lock.json`.
Its exact bytes are preserved by `.gitattributes` and excluded from formatting.
Codec regressions retain frozen YAML fixtures separately from the managed kit.

To override the pinned CLI and kit for local development:

```sh
export MORPHIR_MCK_NATIVE_CLI=/absolute/path/to/morphir
"$MORPHIR_MCK_NATIVE_CLI" mck kit vendor --source embedded --dest .dev/native-kit
MORPHIR_MCK_KIT=.dev/native-kit mise run check:conformance
```

The run writes `.dev/out/conformance/native.json` and `native.html`. It removes
old evidence before starting. Native `report check` owns schema, inventory,
session and allowed-failure adjudication against `.config/mck-allowed-failing.json`.
HTML rendering does not turn a failed gate into a pass. The acquisition helper
contains no compatibility checker. CI uploads the fresh JSON and HTML together
as the `native-conformance` artifact, including after a failed gate.

To apply formatting and safe lint fixes, run:

```sh
mise exec -- bun run format
```

## Repository layout

```text
packages/ir/        @finos/morphir-ir
packages/mck/       @finos/morphir-mck
packages/sdk/       @finos/morphir-sdk
.config/mise/tasks/ local development and CI tasks
.github/workflows/  GitHub Actions orchestration
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request. Contributions must follow FINOS contribution requirements, including the repository's DCO sign-off policy and the [FINOS Code of Conduct](https://www.finos.org/code-of-conduct).

Use [GitHub issues](https://github.com/finos/morphir-typescript/issues) for bugs, feature requests, and support questions.

## License

Copyright 2026 FINOS

Distributed under the [Apache License, Version 2.0](LICENSE).

SPDX-License-Identifier: Apache-2.0
