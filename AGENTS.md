<!--
Copyright 2026 FINOS

SPDX-License-Identifier: Apache-2.0
-->

# Agent guidance

This is the primary guidance for agents working in this repository. Follow the closest nested `AGENTS.md` for files under a directory with more specific instructions.

## Working preferences

- Prefer compilers, linters, formatters, static analyzers, and focused tests for issues those tools can determine. Use manual review for semantic, architectural, performance, concurrency, and requirements concerns.
- Keep `docs/superpowers/` design and implementation-plan artifacts local. Never stage or commit them. Exclude the directory through `.git/info/exclude`, not the tracked `.gitignore`.

## Development workflow

- Use mise to install the pinned tools: `mise install`.
- Use `mise run setup` to install dependencies.
- Run `mise run ci` before completing a change. It is the local mirror of GitHub Actions CI.
- Any CI behavior change must update the mise tasks and GitHub workflow together so `mise run ci` remains the executable source of truth.

## Technology choices

- Use `bun:test` as the default testing framework. Introduce another test framework only for a concrete requirement that Bun's test runner cannot meet.
- Keep `@finos/morphir-ir` focused on the Morphir semantic model and codecs without an Effect dependency.
- Prefer Effect as the base library for future service and integration code. Add it to the specific non-core package when that package first uses it; do not rely on root workspace hoisting.

## Local development artifacts

- Use `.dev/` as the gitignored staging area for scratch scripts, spikes, task notes, and generated helper artifacts.
- Put one-off design and implementation-plan documents under `.dev/.sdlc/<descriptive-slug>/`.
- Put outputs from agent tools or helper scripts in an `out/` directory at the appropriate place under `.dev/`.
- Use descriptive slugs so local work remains organized and searchable.
- Never stage or commit anything under `.dev/`.
