#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Test the shared OpenSpec workflow"

import { exec } from "../_lib.ts";

await exec(["mise", "exec", "--", "moon", "test", "--deny-warn", "--target", "wasm", "scripts/openspec-ext.mbtx"]);
