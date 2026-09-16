<!--
Copyright 2026 FINOS

SPDX-License-Identifier: Apache-2.0
-->

# GitHub Actions workflows

GitHub Actions performs runner orchestration, permissions, caching, event filtering, and concurrency control. Repository checks live in the mise tasks under `.config/mise/tasks/`.

## Local CI mirror

Every workflow change MUST preserve a local equivalent. The CI workflow runs:

```sh
mise run ci
```

Run that command before opening or updating a pull request. When adding or changing a CI check, implement it as a mise task first, include it in the `ci` task graph, then keep the workflow as a thin caller of the local mirror.

## Troubleshooting

1. Run `mise install` to install the pinned toolchain.
2. Run `mise run ci` to reproduce repository checks.
3. Run an individual task such as `mise run check:lint`, `mise run check:typecheck`, `mise run test`, `mise run check:package`, or `mise run check:workflows` to isolate a failure.
4. Confirm the workflow checker with `mise exec -- actionlint -version` when diagnosing tool installation.

## Publishing

Releases use one suite version and one signed `vVERSION` tag for every workspace. One tag publishes both packages: `@finos/morphir-ir` first, then `@finos/morphir-mck`, which depends on it. `0.0.1` published only `@finos/morphir-ir`; `0.1.0` was the first release to publish both. The release validator is the authority for accepted tags, manifest versions, package visibility, and changelog state. Signed tags are an operator requirement. The workflow validates exact tag syntax and `main` ancestry but does not cryptographically verify tag signatures.

A release also attaches compiled binaries. `mise run release:binaries` compiles `mck` and `mck-adapter-typescript` with `bun build --compile` for five targets — Linux x64 and arm64, macOS x64 and arm64, and Windows x64 — giving ten single-file executables named `mck-VERSION-OS-ARCH` and `mck-adapter-typescript-VERSION-OS-ARCH`, with `.exe` on Windows. Each binary embeds the vendored kit, so it runs `mck run` with no checkout, no `node_modules`, and no Node installation. A compiled binary has no `kit.lock.json`: `mck kit status` reports the embedded kit's commit instead, and `mck kit sync` refuses and directs you to a source checkout. Bun publishes no Windows arm64 build; Windows on ARM runs the x64 binary under emulation. GitHub Actions artifacts are zipped, which drops the Unix executable bit, so a downloaded binary needs `chmod +x` on Linux and macOS.

The publishing workflow contract separates artifact creation from publication:

1. A credential-free artifact job validates the tag, runs the local CI mirror, builds the two exact npm tarballs, and compiles the ten binaries. It checksums all twelve files into one `SHA256SUMS`.
2. A publish job downloads that artifact without checking out or rebuilding the repository. It verifies the twelve-file set against `SHA256SUMS` and publishes each exact tarball to npm with provenance, ir before mck. Republishing an identical, already-published version is a success, not a failure.
3. A GitHub Release job uses the changelog entry as its release notes and attaches the same twelve files plus `SHA256SUMS`.

The publish job receives the FINOS organization secret `ORG_MORPHIR_NPM_TOKEN`. The npm token must be authorized to publish public packages in the `@finos` scope, for both `@finos/morphir-ir` and `@finos/morphir-mck`. No other job receives it.

To cut a release, set the next suite version and run:

```sh
VERSION=X.Y.Z
mise run release:prepare -- "$VERSION"
mise run ci
```

Release preparation updates files in the working tree. It does not commit, tag, or push. Review those changes, commit them through the normal contribution process, and merge the reviewed commit to `main`. Then create and push the signed tag from that commit on `main`:

```sh
git tag -s "v$VERSION" -m "Release $VERSION"
git push origin "v$VERSION"
```

The suite manifests read the last released version until `release:prepare` bumps them, so the version in the working tree is not the version you are about to publish.

npm versions are immutable. If npm publication fails before npm accepts the package, rerun the failed publish job; it skips any package the registry already holds with the same integrity, so a rerun that publishes only `@finos/morphir-mck` is expected after an `@finos/morphir-ir` publication already succeeded. If npm accepted the packages but GitHub Release creation failed, confirm the published versions and rerun only the GitHub Release job. Never create a replacement tarball for an existing version.
