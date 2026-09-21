#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Compile the TypeScript adapter to single-file binaries for every release target"
//MISE depends=["setup"]

import { exec } from "../_lib.ts";

await exec(["bun", "scripts/release/cli.ts", "binaries", ...process.argv.slice(2)]);
