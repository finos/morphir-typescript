#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Run the vendored kit in-process and through the adapter, compare, and check coverage"
//MISE depends=["setup"]

import { exec } from "../_lib.ts";

const out = ".dev/out/conformance";
const cli = "packages/mck/src/cli.ts";
await exec(["bun", cli, "run", "--report", `${out}/in-process.json`]);
await exec(["bun", cli, "run", "--adapter", "bun", "--adapter-arg", "packages/mck/src/adapter.ts", "--report", `${out}/adapter.json`]);
await exec(["bun", "scripts/conformance/compare-reports.ts", `${out}/in-process.json`, `${out}/adapter.json`]);
await exec(["bun", cli, "coverage"]);
