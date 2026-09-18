#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Build and verify installed IR on Node 20 and MCK on Node 24"
//MISE depends=["setup"]

import { exec } from "../_lib.ts";

await exec(["bun", "scripts/release/cli.ts", "artifact", ".dev/out/package-check"]);
