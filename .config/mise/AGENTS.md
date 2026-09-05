<!--
Copyright 2026 FINOS

SPDX-License-Identifier: Apache-2.0
-->

# mise task guidance

- Store repository file tasks under `.config/mise/tasks/`.
- Write tasks in TypeScript first, JavaScript with the `.mjs` extension second, or shell script third.
- Do not use Python or another scripting language for mise tasks. This repository must not gain a language runtime solely for task automation.
- Use Bun to execute TypeScript tasks and shared helpers.
- Keep tasks executable and place `//MISE` or `#MISE` metadata immediately after the shebang and license header.
- Put CI behavior in these tasks. GitHub Actions should invoke `mise run ci` instead of duplicating commands in workflow YAML.
- Preserve the dependency graph: install once, then run independent checks in parallel.
