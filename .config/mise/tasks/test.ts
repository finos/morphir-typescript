#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Run the Bun test suite"
//MISE depends=["setup"]

import { exec } from "./_lib.ts";

// MCK conformance follow-up:
// The standalone repository does not yet acquire the authoritative finos/morphir
// docs/spec/ir/fixtures files or spec/ir/mck corpus. Upstream work must make a
// compatible pinned revision available at stable paths, set MORPHIR_MCK_DIR when
// needed, remove MORPHIR_FIXTURES_OPTIONAL, and prove this task runs the full
// corpus both locally and in GitHub Actions.
await exec(["bun", "run", "test"], { MORPHIR_FIXTURES_OPTIONAL: "1" });
