#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Validate a suite release tag"
//MISE depends=["setup"]

import { exec } from "../_lib.ts";

await exec(["bun", "scripts/release/cli.ts", "validate", ...process.argv.slice(2)]);
