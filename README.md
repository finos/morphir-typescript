[![FINOS - Graduated](https://cdn.jsdelivr.net/gh/finos/contrib-toolbox@master/images/badge-graduated.svg)](https://community.finos.org/docs/governance/lifecycle-stages/graduated)
[![CI](https://github.com/finos/morphir-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/finos/morphir-typescript/actions/workflows/ci.yml)

# morphir-typescript

`morphir-typescript` is the TypeScript reference binding for the [Morphir Intermediate Representation](https://morphir.finos.org/docs/spec/ir/morphir-ir-specification). It provides a version-agnostic semantic model, the Morphir IR v4 model and JSON codec, and the parser, structural checker, and binding-side conformance runner for the Morphir Compatibility Kit.

Morphir captures business logic and domain models as language-independent data so tools can analyze, transform, serialize, and execute the same model across platforms. The authoritative specifications and compatibility corpus live in the [`finos/morphir`](https://github.com/finos/morphir) repository. This project implements those contracts for TypeScript. It is separate from the [Morphir TypeScript code-generation backend](https://morphir.finos.org/docs/reference/backends/other-platforms/typescript-api), which generates TypeScript APIs from Morphir models.

## Project status

Publishing is prepared for the initial `@finos/morphir-ir` `0.0.1` npm release. `@finos/morphir-mck` remains private and will not be published. Every workspace uses the same repository-wide suite version, including packages that are not part of a given release. Initial release preparation moves the whole suite from `0.0.0` to `0.0.1`.

Standalone CI temporarily skips conformance tests that require the upstream Morphir fixture and MCK directories. Unit tests still run. The upstream integration work will remove this opt-out once a compatible pinned corpus is available to standalone clones.

## Packages

| Package | Publication | Purpose |
| --- | --- | --- |
| `@finos/morphir-ir` | Prepared for public npm release at `0.0.1` | Generic Morphir IR semantic types, pinned v4 types, JSON readers and canonical writers, diagnostics, and attribute mapping. |
| `@finos/morphir-mck` | Private workspace package | MCK Markdown case parser, kit loader, structural checker CLI, and report model. |

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

### Check an MCK directory

The current MCK CLI validates the structure of a kit directory:

```sh
mise exec -- bun run packages/mck/src/cli.ts check /path/to/morphir/spec/ir/mck
```

Add `--json` for machine-readable output.

## Development

TypeScript is the implementation language. Bun supplies the runtime, package manager, task runtime, and default `bun:test` testing framework. The npm artifact uses `Bun.build` to compile unminified ESM and TypeScript to emit declarations. Node.js 20 only runs an installed-package compatibility check. Biome handles linting and formatting.

Effect is the preferred foundation for future service and integration work. It is not currently a dependency and must remain outside the core `@finos/morphir-ir` package; add it to a specific non-core package when that package begins using it.

Use mise tasks for repository automation:

| Command | Purpose |
| --- | --- |
| `mise run setup` | Install dependencies from the frozen Bun lockfile. |
| `mise run check:lint` | Check Biome lint rules, formatting, and imports. |
| `mise run check:typecheck` | Typecheck every workspace package. |
| `mise run check:package` | Build and verify the `@finos/morphir-ir` tarball in `.dev/out/package-check`. |
| `mise run check:workflows` | Validate GitHub Actions workflows with the pinned actionlint version. |
| `mise run test` | Run the available Bun test suite. |
| `mise run ci` | Run the same checks as GitHub Actions. |
| `mise run release:prepare -- VERSION` | Update the suite version and finalize the Keep a Changelog release entry. |
| `mise run release:validate -- TAG` | Validate a `vVERSION` tag against the suite manifests and changelog. |
| `mise run release:artifact -- OUTPUT_DIRECTORY` | Build and verify the publishable tarball in the requested directory. |

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
