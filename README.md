[![FINOS - Graduated](https://cdn.jsdelivr.net/gh/finos/contrib-toolbox@master/images/badge-graduated.svg)](https://community.finos.org/docs/governance/lifecycle-stages/graduated)
[![CI](https://github.com/finos/morphir-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/finos/morphir-typescript/actions/workflows/ci.yml)

# morphir-typescript

`morphir-typescript` is the TypeScript reference binding for the [Morphir Intermediate Representation](https://morphir.finos.org/docs/spec/ir/morphir-ir-specification). It provides a version-agnostic semantic model, the Morphir IR v4 model and JSON codec, and the parser, structural checker, and binding-side conformance runner for the Morphir Compatibility Kit.

Morphir captures business logic and domain models as language-independent data so tools can analyze, transform, serialize, and execute the same model across platforms. The authoritative specifications and compatibility corpus live in the [`finos/morphir`](https://github.com/finos/morphir) repository. This project implements those contracts for TypeScript. It is separate from the [Morphir TypeScript code-generation backend](https://morphir.finos.org/docs/reference/backends/other-platforms/typescript-api), which generates TypeScript APIs from Morphir models.

## Project status

`@finos/morphir-ir` and `@finos/morphir-mck` are published to public npm at suite version `0.1.0`. The root workspace stays private and is never published. Every workspace uses the same repository-wide suite version, including packages that are not part of a given release, and the manifests read the last released version until release preparation bumps them.

The Morphir Compatibility Kit is vendored into `packages/mck/kit`, so `mise run check:conformance` runs the full kit in a standalone clone with no upstream checkout. Two corpora are still not vendored: the naming and format-version conformance fixtures, which live only in `finos/morphir` at `docs/spec/ir/fixtures/`. `mise run test` therefore sets `MORPHIR_FIXTURES_OPTIONAL=1`, which makes those two corpora — and nothing else — optional when they are absent. That opt-out goes away once they are vendored too.

## Packages

| Package | Publication | Purpose |
| --- | --- | --- |
| `@finos/morphir-ir` | Published to public npm at `0.1.0` | Generic Morphir IR semantic types, pinned v4 types, JSON readers and canonical writers, diagnostics, and attribute mapping. |
| `@finos/morphir-mck` | Published to public npm at `0.1.0` | MCK Markdown case parser, kit loader, structural checker, the `mck` driver and its reference adapter, and the report model. Ships the vendored kit. |

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

### Check an MCK directory

The current MCK CLI validates the structure of a kit directory:

```sh
mise exec -- bun run packages/mck/src/cli.ts check /path/to/morphir/spec/ir/mck
```

Add `--json` for machine-readable output.

### Check a binding's conformance with `mck`

`mck` is the driver for the Morphir Compatibility Kit: it runs a binding's decoder and structural checker against every kit case and reports pass, fail, or skip per fence, including JSON, YAML, and document-tree fences. Install it as the `mck` binary from `@finos/morphir-mck` (`npm install -g @finos/morphir-mck`, or `npx -p @finos/morphir-mck mck` since the package ships two binaries), or download the standalone `mck` binary from a [release](https://github.com/finos/morphir-typescript/releases). `mck run` checks the in-process TypeScript binding against the kit vendored in the package; `mck run --adapter <exe> [--adapter-arg <arg>]...` runs the same kit against any binding that speaks the adapter's JSON-lines protocol (see `mck-adapter-typescript` for the reference implementation) as a child process; `mck coverage` reports every IR v4 vocabulary entry the kit does not yet exercise. Over the embedded kit, `mck run` reports `620 pass, 0 fail, 0 kit-error, 2 skipped` — the two skips are the kit's version-3 fences, which this binding's capabilities do not name.

## Development

TypeScript is the implementation language. Bun supplies the runtime, package manager, task runtime, and default `bun:test` testing framework. The npm artifact uses `Bun.build` to compile unminified ESM and TypeScript to emit declarations. Node.js 20 only runs an installed-package compatibility check. Biome handles linting and formatting.

Effect is the preferred foundation for future service and integration work. It is not currently a dependency and must remain outside the core `@finos/morphir-ir` package; add it to a specific non-core package when that package begins using it.

Use mise tasks for repository automation:

| Command | Purpose |
| --- | --- |
| `mise run setup` | Install dependencies from the frozen Bun lockfile. |
| `mise run check:lint` | Check Biome lint rules, formatting, and imports. |
| `mise run check:typecheck` | Typecheck every workspace package. |
| `mise run check:package` | Build and verify the `@finos/morphir-ir` and `@finos/morphir-mck` tarballs in `.dev/out/package-check`. |
| `mise run check:workflows` | Validate GitHub Actions workflows with the pinned actionlint version. |
| `mise run check:kit` | Verify the vendored kit matches `kit.lock.json`. |
| `mise run check:conformance` | Run the vendored kit in-process and through the adapter, compare the two reports, and check coverage. |
| `mise run test` | Run the available Bun test suite. |
| `mise run ci` | Run the same checks as GitHub Actions. |
| `mise run release:prepare -- VERSION` | Update the suite version and finalize the Keep a Changelog release entry. |
| `mise run release:validate -- TAG` | Validate a `vVERSION` tag against the suite manifests and changelog. |
| `mise run release:artifact -- OUTPUT_DIRECTORY` | Build and verify both publishable tarballs in the requested directory. |
| `mise run release:binaries -- OUTPUT_DIRECTORY` | Compile `mck` and `mck-adapter-typescript` to single-file binaries for every release target. Set `MCK_BINARY_TARGETS=host` to compile only this machine's target. |

To apply formatting and safe lint fixes, run:

```sh
mise exec -- bun run format
```

## Repository layout

```text
packages/ir/        @finos/morphir-ir
packages/mck/       @finos/morphir-mck
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
