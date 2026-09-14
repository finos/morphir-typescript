#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Run the Bun test suite"
//MISE depends=["setup"]

import { exec } from "./_lib.ts";

await exec(["bun", "run", "test"]);
