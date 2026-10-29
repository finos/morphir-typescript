#!/usr/bin/env bun
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//MISE description="Complete the pinned MoonBit SDK and initialize its package registry"

import { exec } from "../_lib.ts";

if (process.platform === "win32") {
	await exec([
		"powershell",
		"-NoProfile",
		"-Command",
		'$ErrorActionPreference = "Stop"; $env:MOON_HOME = mise where http:moonbit; $env:MOONBIT_INSTALL_VERSION = mise current http:moonbit; Invoke-RestMethod https://cli.moonbitlang.com/install/powershell.ps1 | Invoke-Expression; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
	]);
} else {
	await exec([
		"bash",
		"-c",
		'set -euo pipefail\ncurl -fsSL https://cli.moonbitlang.com/install/unix.sh | \\\n  MOON_HOME="$(mise where http:moonbit)" bash -s -- "$(mise current http:moonbit)"',
	]);
}
await exec(["mise", "exec", "--", "moon", "update"]);
