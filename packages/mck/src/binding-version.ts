// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import pkg from "../package.json" with { type: "json" };

/** The implementation's release version, independent of the kit and driver. */
export function bindingVersion(): string {
	return pkg.version;
}
