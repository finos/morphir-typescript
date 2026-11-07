#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Verify the shared OpenSpec workflow"

import { exec } from "../_lib.ts";

await exec(["mise", "run", "openspec:check"]);
await exec(["mise", "run", "openspec:validate"]);
