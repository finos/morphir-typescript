// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import path from "node:path";

export const ROOT_DIR = process.env.MISE_PROJECT_ROOT ?? path.resolve(import.meta.dir, "../../..");

export async function exec(command: string[], extraEnv: Record<string, string> = {}, allowedExitCodes: readonly number[] = [0]): Promise<void> {
	const child = Bun.spawn(command, {
		cwd: ROOT_DIR,
		env: { ...process.env, ...extraEnv },
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await child.exited;
	if (!allowedExitCodes.includes(exitCode)) process.exit(exitCode);
}
