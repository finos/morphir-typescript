#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Build and verify the publishable @finos/morphir-ir and @finos/morphir-mck artifacts"
//MISE depends=["setup"]

import { exec } from "../_lib.ts";

await exec(["bun", "scripts/release/cli.ts", "artifact", ".dev/out/package-check"]);
