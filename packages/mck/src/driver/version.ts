// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// What a report says ran: the driver's own version and the kit's identity.
import { execFileSync } from "node:child_process";
import { EMBEDDED_KIT_COMMIT } from "../../kit/embedded.ts";
import pkg from "../../package.json" with { type: "json" };

export function driverVersion(): string {
	return pkg.version;
}

export function kitVersion(kitDirectory: string | null): string {
	if (kitDirectory === null) return EMBEDDED_KIT_COMMIT;
	try {
		return execFileSync("git", ["-C", kitDirectory, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "unknown";
	}
}
