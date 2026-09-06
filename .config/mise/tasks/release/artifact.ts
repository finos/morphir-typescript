#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Build and verify the publishable @finos/morphir-ir artifact"
//MISE depends=["setup"]

import { exec } from "../_lib.ts";

await exec(["bun", "scripts/release/cli.ts", "artifact", ...process.argv.slice(2)]);
