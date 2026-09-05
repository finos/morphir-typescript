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
3. Run an individual task such as `mise run check:lint`, `mise run check:typecheck`, or `mise run test` to isolate a failure.
4. Validate workflow syntax with `mise exec actionlint@1.7.12 -- actionlint .github/workflows/ci.yml`.

Standalone CI temporarily sets `MORPHIR_FIXTURES_OPTIONAL=1` in the test task because the authoritative upstream fixtures and MCK corpus are not acquired yet. The handoff comment in `.config/mise/tasks/test.ts` defines the conditions for removing this opt-out.
