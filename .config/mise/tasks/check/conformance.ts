#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Run the vendored kit in-process and through the adapter, compare, and check coverage"
//MISE depends=["setup"]

import { exec } from "../_lib.ts";

const out = ".dev/out/conformance";
// `mck run` exits 1 while any record fails, and the vendored kit still carries
// fences the parent has not corrected yet (see ALLOWED_FAILING_CASES in
// scripts/release/package-mck.ts). What this task checks is that the two
// transports agree and that the kit covers the model, so the runs are allowed
// to report failures and the comparison and coverage steps below decide.
const RUN_EXITS = [0, 1];
const cli = "packages/mck/src/cli.ts";
await exec(["bun", cli, "run", "--report", `${out}/in-process.json`], {}, RUN_EXITS);
await exec(["bun", cli, "run", "--adapter", "bun", "--adapter-arg", "packages/mck/src/adapter.ts", "--report", `${out}/adapter.json`], {}, RUN_EXITS);
await exec(["bun", "scripts/conformance/compare-reports.ts", `${out}/in-process.json`, `${out}/adapter.json`]);
await exec(["bun", "packages/mck/src/cli.ts", "coverage"]);
