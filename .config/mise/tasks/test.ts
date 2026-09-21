#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Run the Bun test suite"
//MISE depends=["setup"]

import { exec } from "./_lib.ts";

// MORPHIR_FIXTURES_OPTIONAL scopes to exactly two corpora: the naming and
// format-version conformance fixtures at
// docs/spec/ir/fixtures/{naming,format-version}-conformance.json, which live
// only in the parent finos/morphir repository. names.test.ts and
// format-version.test.ts throw at load when they are absent, so a standalone
// checkout of this repository cannot run the suite without this opt-out. The
// native MCK kit is vendored under vendor/morphir-mck and needs no opt-out of any kind.
// Remove this only when those two corpora are vendored too; automation.test.ts
// pins both the variable and this comment.
await exec(["bun", "run", "test"], { MORPHIR_FIXTURES_OPTIONAL: "1" });
