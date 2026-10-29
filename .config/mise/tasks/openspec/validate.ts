#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Validate the shared OpenSpec workflow"

import { exec } from "../_lib.ts";

await exec(["mise", "exec", "--", "openspec", "schema", "validate", "html-design"]);
await exec(["mise", "exec", "--", "openspec", "validate", "--all", "--strict"]);
