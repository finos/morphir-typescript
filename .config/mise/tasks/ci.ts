#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Run the same checks as GitHub Actions"
//MISE depends=["check:lint", "check:typecheck", "check:kit", "check:conformance", "test", "check:package", "check:workflows"]

console.log("Local CI checks passed.");
