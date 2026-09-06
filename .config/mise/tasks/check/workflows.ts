#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Validate GitHub Actions workflows with actionlint"

import { exec } from "../_lib.ts";

await exec(["actionlint"]);
