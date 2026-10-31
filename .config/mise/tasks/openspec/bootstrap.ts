#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Initialize the package registry of the pinned MoonBit SDK"

// The http:moonbit postinstall in mise.toml completes the SDK (core and moonx).
import { exec } from "../_lib.ts";

await exec(["mise", "exec", "--", "moon", "update"]);
