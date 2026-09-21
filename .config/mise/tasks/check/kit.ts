#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Verify a native managed MCK snapshot with the pinned Morphir CLI"
//MISE depends=["setup"]
import { checkNativeKit, nativeContext } from "../../../../scripts/conformance/native.ts";
import { ROOT_DIR } from "../_lib.ts";

await checkNativeKit(await nativeContext(ROOT_DIR));
