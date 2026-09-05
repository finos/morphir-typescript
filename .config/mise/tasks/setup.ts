#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Install dependencies from the frozen Bun lockfile"

import { exec } from "./_lib.ts";

await exec(["bun", "install", "--frozen-lockfile"]);
