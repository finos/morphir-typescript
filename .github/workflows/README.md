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

Standalone CI temporarily sets `MORPHIR_FIXTURES_OPTIONAL=1` in the test task because the authoritative upstream fixtures and MCK corpus are not acquired yet. The handoff comment in `.config/mise/tasks/test.ts` defines the conditions for removing this opt-out.

## Publishing

Releases use one suite version and one signed `vVERSION` tag for every workspace. The initial `0.0.1` release publishes only `@finos/morphir-ir`; `@finos/morphir-mck` stays private. The release validator is the authority for accepted tags, manifest versions, package visibility, and changelog state. Signed tags are an operator requirement. The workflow validates exact tag syntax and `main` ancestry but does not cryptographically verify tag signatures.

The publishing workflow contract separates artifact creation from publication:

1. A credential-free artifact job validates the tag, runs the local CI mirror, and builds the exact npm tarball.
2. A publish job downloads that artifact without checking out or rebuilding the repository. It publishes the exact tarball to npm with provenance.
3. A GitHub Release job uses the changelog entry as its release notes and attaches the same tarball.

The publish job receives the FINOS organization secret `ORG_MORPHIR_NPM_TOKEN`. The npm token must be authorized to publish public packages in the `@finos` scope. No other job receives it.

The initial `0.0.1` release is already prepared in this change. Do not run release preparation for `0.0.1` again. For a future release, set the next suite version and run:

```sh
VERSION=0.0.2
mise run release:prepare -- "$VERSION"
mise run ci
```

Release preparation updates files in the working tree. It does not commit, tag, or push. Review those changes, commit them through the normal contribution process, and merge the reviewed commit to `main`. For the initial release, create and push the signed tag from the prepared commit on `main`:

```sh
git tag -s v0.0.1 -m "Release 0.0.1"
git push origin v0.0.1
```

npm versions are immutable. If npm publication fails before npm accepts the package, rerun the failed publish job. If npm accepted the package but GitHub Release creation failed, confirm the published version and rerun only the GitHub Release job. Never create a replacement tarball for an existing version.
