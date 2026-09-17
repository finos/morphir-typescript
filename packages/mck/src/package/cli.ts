// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatSummary } from "../report.ts";
import type { PackageContractVersion } from "./contract.ts";
import { loadPackageKit } from "./corpus.ts";
import { processPackageTestee, processResolutionTestee } from "./process.ts";
import { referencePackageTestee, referenceResolutionTestee } from "./reference.ts";
import { RESOLUTION_CONTRACT } from "./resolution/contract.ts";
import { loadResolutionKit } from "./resolution/corpus.ts";
import { packageExitCode, runPackageKit, runResolutionKit } from "./run.ts";

export interface PackageRunArgs {
	readonly contract: PackageContractVersion;
	readonly kit: string;
	readonly report: string | undefined;
	readonly adapter: string | undefined;
	readonly adapterArgs: readonly string[];
	readonly timeoutMs: number;
}

/** Parsing and help belong to the shared Effect CLI command tree. */
export async function runPackageCommand(args: PackageRunArgs): Promise<number> {
	const { contract, kit: directory, report: reportFile, adapter, adapterArgs, timeoutMs } = args;
	if (!adapter && adapterArgs.length) {
		console.error("--adapter-arg requires --adapter");
		return 2;
	}
	try {
		const report =
			contract === RESOLUTION_CONTRACT
				? await runResolutionKit(
						loadResolutionKit(path.resolve(directory)),
						adapter ? processResolutionTestee([adapter, ...adapterArgs], { timeoutMs }) : referenceResolutionTestee(),
					)
				: await runPackageKit(
						loadPackageKit(path.resolve(directory)),
						adapter ? processPackageTestee([adapter, ...adapterArgs], { timeoutMs }) : referencePackageTestee(),
					);
		if (reportFile) {
			mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true });
			writeFileSync(reportFile, `${JSON.stringify(report, null, "\t")}\n`);
		}
		console.log(`package: ${formatSummary(report)}`);
		for (const record of report.records) if (record.result !== "pass") console.log(`${record.result} ${record.caseId}: ${record.message}`);
		return packageExitCode(report);
	} catch (error) {
		console.error(String(error));
		return 1;
	}
}
