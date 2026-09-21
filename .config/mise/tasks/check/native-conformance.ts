#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Run the native MCK against the explicit TypeScript adapter and check its report"
//MISE depends=["setup"]
import { checkNativeConformance } from "../../../../scripts/conformance/native.ts";
import { ROOT_DIR } from "../_lib.ts";

await checkNativeConformance(ROOT_DIR);
