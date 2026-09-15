#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Verify the vendored kit matches kit.lock.json"
//MISE depends=["setup"]

import { exec } from "../_lib.ts";

await exec(["bun", "packages/mck/src/cli.ts", "kit", "status"]);
