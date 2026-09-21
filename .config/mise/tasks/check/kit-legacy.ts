#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Retain the frozen TypeScript kit verification during native adoption"
//MISE depends=["setup"]

import { exec } from "../_lib.ts";

await exec(["bun", "packages/mck/src/cli.ts", "kit", "status"]);
