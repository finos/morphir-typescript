// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The kit as shipped inside the package: the generated map, exposed through
// the same KitFiles interface a checkout is.
import { EMBEDDED_KIT, EMBEDDED_KIT_COMMIT } from "../../kit/embedded.ts";
import { type KitFiles, kitFilesFromMap } from "./source.ts";

export function embeddedKitFiles(): KitFiles {
	return kitFilesFromMap(`embedded kit at finos/morphir ${EMBEDDED_KIT_COMMIT.slice(0, 8)}`, EMBEDDED_KIT);
}
export const embeddedKitCommit = (): string => EMBEDDED_KIT_COMMIT;
