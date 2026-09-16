// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { isDeepStrictEqual } from "node:util";
import { driverVersion } from "../driver/version.ts";
import type { ReportResult } from "../report.ts";
import { PACKAGE_CONTRACT, type PackageCapabilities, type PackageOperation, type PackageTestee } from "./contract.ts";
import type { PackageKit } from "./corpus.ts";
import { parsePackageCapabilities, parsePackageResponse } from "./protocol.ts";

export interface PackageRecord {
	readonly caseId: string;
	readonly operation?: PackageOperation;
	readonly result: ReportResult;
	readonly message?: string;
}
export interface PackageReport {
	readonly suite: "package";
	readonly contractVersion: typeof PACKAGE_CONTRACT;
	readonly driverVersion: string;
	readonly kit: { readonly formatVersion: string; readonly contentHash: string };
	readonly testee?: PackageCapabilities;
	readonly startedAt: string;
	readonly records: readonly PackageRecord[];
}
async function executePackageKit(kit: PackageKit, testee: PackageTestee): Promise<PackageReport> {
	const header = {
		suite: "package" as const,
		contractVersion: PACKAGE_CONTRACT,
		driverVersion: driverVersion(),
		kit: { formatVersion: kit.formatVersion, contentHash: kit.contentHash },
		startedAt: new Date().toISOString(),
	};
	if (kit.errors.length || kit.cases.length === 0)
		return { ...header, records: [{ caseId: "package-kit", result: "kit-error", message: kit.errors.join("; ") || "empty kit" }] };
	let capabilities: PackageCapabilities;
	try {
		capabilities = parsePackageCapabilities(await testee.capabilities());
	} catch (error) {
		return { ...header, records: [{ caseId: "package-adapter", result: "kit-error", message: String(error) }] };
	}
	const records: PackageRecord[] = [];
	for (const entry of kit.cases) {
		const base = { caseId: entry.id, operation: entry.request.op };
		if (!capabilities.operations.includes(entry.request.op)) {
			records.push({ ...base, result: "skipped", message: "required operation unsupported" });
			continue;
		}
		try {
			const response = parsePackageResponse(await testee.execute(structuredClone(entry.request)), entry.request.op);
			const passed = isDeepStrictEqual(response, entry.expected);
			records.push({
				...base,
				result: passed ? "pass" : "fail",
				...(passed ? {} : { message: `expected ${JSON.stringify(entry.expected)}, got ${JSON.stringify(response)}` }),
			});
		} catch (error) {
			records.push({ ...base, result: "kit-error", message: String(error) });
			break;
		}
	}
	return { ...header, testee: capabilities, records };
}

/** Consumes a testee session; shutdown is part of the result, including for kit errors. */
export async function runPackageKit(kit: PackageKit, testee: PackageTestee): Promise<PackageReport> {
	let report: PackageReport;
	try {
		report = await executePackageKit(kit, testee);
	} catch (error) {
		try {
			await testee.close();
		} catch {
			/* Preserve the original unexpected driver error. */
		}
		throw error;
	}
	try {
		await testee.close();
	} catch (error) {
		return { ...report, records: [...report.records, { caseId: "package-adapter-close", result: "kit-error", message: String(error) }] };
	}
	return report;
}
/** All cases are required in this bounded draft suite. No skip can pass. */
export function packageExitCode(report: PackageReport): number {
	return report.records.length > 0 && report.records.every((record) => record.result === "pass") ? 0 : 1;
}
