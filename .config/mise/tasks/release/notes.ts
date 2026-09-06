#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Write release notes from the changelog"
//MISE depends=["setup"]

import { exec } from "../_lib.ts";

await exec(["bun", "scripts/release/cli.ts", "notes", ...process.argv.slice(2)]);
