<!--
Copyright 2026 FINOS

SPDX-License-Identifier: Apache-2.0
-->

# GitHub Actions guidance

- Every CI change MUST maintain a runnable local mirror under `.config/mise/tasks/`.
- Implement checks as mise tasks and include them in `mise run ci`. Do not duplicate repository check commands in workflow YAML.
- Keep workflows focused on GitHub runner concerns: events, concurrency, permissions, caching, and invoking the local mirror.
- Run `mise run ci` and actionlint before completing any workflow change.
- GitHub Actions secrets for this repository are supplied at the FINOS organization level. Do not assume repository-level secrets exist.
- If a workflow needs a new secret, document its exact name and purpose and coordinate the organization-level configuration before depending on it.
- Use least-privilege token permissions and immutable commit SHAs for third-party actions.
