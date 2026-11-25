# OpenSpec workflow

This repository uses the `html-design` bundle that
[mission-control-tools](https://github.com/moonrockz/mission-control/tree/tools-v0.1.3/apps/tools)
installs.
New changes produce a proposal, capability specs, a standalone `design.html`
with inline CSS and SVG, and implementation tasks. Existing changes retain their
recorded schema. Follow this repository's contribution and approval rules.

## Bootstrap

Install [mise](https://mise.jdx.dev/), then run `mise install`. OpenSpec is pinned
to 2.2.0. The `github:moonrockz/mission-control` entry in `mise.toml` pins
`mission-control-tools` 0.1.3, a released binary that installs and checks the
shared bundle. mise checks each download against its GitHub asset digest and
its artifact attestation. The repository does not need a MoonBit toolchain.
Existing project runtime pins remain in place.

Then verify the checked-in bundle:

```sh
mise run openspec:verify
```

This runs `mission-control-tools openspec check --bundle` and the schema and
change validation. The bundle check compares each managed file with its digest
in the lock and with the file in the pinned binary, so a version bump without
`install` fails. An empty spec/change tree reports no items to validate. CI runs
the same checks.

## Propose and implement a change

```sh
mise exec -- openspec new change <change-name>
mise exec -- openspec instructions design --change <change-name>
```

No schema override is needed. The design instructions target `design.html`.
Use the generated core skills to propose, explore, apply, update, sync specs and
archive changes. The `openspec` skill answers questions about OpenSpec and
sends a request to the skill that does the work. The skills are checked in once,
in `.agents/skills/`, which Codex, Copilot, Cursor, Gemini and OpenCode read.
`.claude/skills/` and `.grok/skills/` hold links to them. On Windows, run
`git config --global core.symlinks true` before you clone, or each link checks
out as a small text file. `mise run openspec:setup` regenerates the skills in
this repository using an isolated core profile without changing personal
OpenSpec settings.

Keep project-specific context and rules in `openspec/config.yaml` and AGENTS.md.
Existing skills outside the generated OpenSpec set are preserved.

## Update the shared bundle

`openspec/extensions.lock.json` (format 2) records `mission-control-tools` 0.1.3
and SHA-256 hashes for seven managed files: the schema, the templates, `LICENSE`
and `NOTICE`. Keep them identical to the bundle in the pinned binary. Do not patch
them locally. `.gitattributes` keeps LF line endings for them, because the check
compares bytes.

To update, change the `version` of the `github:moonrockz/mission-control` entry
in `mise.toml`, then run:

```sh
mise install
mise exec -- mission-control-tools openspec install
mise run openspec:verify
```

Review the diff before you commit. The installer refuses edits to owned files
before it writes anything. It writes the lock last.

The schema's Apache-2.0 license and upstream OpenSpec MIT notice are retained in
`openspec/schemas/html-design/LICENSE` and `NOTICE`.
