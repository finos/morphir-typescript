#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Setup the shared OpenSpec workflow"

import { exec } from "../_lib.ts";

await exec(["mise", "exec", "--", "moon", "run", "-q", "--target", "wasm", "scripts/openspec-ext.mbtx", "--", "setup"]);
