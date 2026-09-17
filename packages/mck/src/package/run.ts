// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { isDeepStrictEqual } from "node:util";
import { driverVersion } from "../driver/version.ts";
import type { ReportResult } from "../report.ts";
import type {
	PACKAGE_CONTRACT,
	PackageCapabilities,
	PackageContractDescriptor,
	PackageContractKit,
	PackageContractTestee,
	PackageContractVersion,
	PackageOperation,
	PackageTestee,
} from "./contract.ts";
import type { PackageKit } from "./corpus.ts";
import { packageContract } from "./protocol.ts";
import type { ResolutionCapabilities, ResolutionKit, ResolutionOperation, ResolutionTestee } from "./resolution/contract.ts";
import { resolutionContract } from "./resolution/protocol.ts";

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
export interface PackageContractRecord<Operation extends string = string> {
	readonly caseId: string;
	readonly operation?: Operation;
	readonly result: ReportResult;
	readonly message?: string;
}
export interface PackageContractReport<Version extends PackageContractVersion, Operation extends string, Capabilities> {
	readonly suite: "package";
	readonly contractVersion: Version;
	readonly driverVersion: string;
	readonly kit: { readonly formatVersion: Version; readonly contentHash: string };
	readonly testee?: Capabilities;
	readonly startedAt: string;
	readonly records: readonly PackageContractRecord<Operation>[];
}

async function executeContractKit<
	Version extends PackageContractVersion,
	Operation extends string,
	Request extends { readonly op: Operation },
	Response,
	Capabilities extends { readonly suite: "package"; readonly contractVersion: Version; readonly operations: readonly Operation[] },
	Projection,
>(
	kit: PackageContractKit<Version, Request, Response>,
	testee: PackageContractTestee<Capabilities, Request, Response>,
	descriptor: PackageContractDescriptor<Version, Operation, Request, Response, Capabilities, Projection>,
): Promise<PackageContractReport<Version, Operation, Capabilities>> {
	const header = {
		suite: "package" as const,
		contractVersion: descriptor.contractVersion,
		driverVersion: driverVersion(),
		kit: { formatVersion: kit.formatVersion, contentHash: kit.contentHash },
		startedAt: new Date().toISOString(),
	};
	if (kit.errors.length || kit.cases.length === 0)
		return { ...header, records: [{ caseId: "package-kit", result: "kit-error", message: kit.errors.join("; ") || "empty kit" }] };
	let capabilities: Capabilities;
	try {
		capabilities = descriptor.parseCapabilities(await testee.capabilities());
	} catch (error) {
		return { ...header, records: [{ caseId: "package-adapter", result: "kit-error", message: String(error) }] };
	}
	const records: PackageContractRecord<Operation>[] = [];
	for (const entry of kit.cases) {
		const operation = descriptor.operation(entry.request);
		const base = { caseId: entry.id, operation };
		if (!descriptor.supports(capabilities, operation)) {
			records.push({ ...base, result: "skipped", message: "required operation unsupported" });
			continue;
		}
		try {
			const response = descriptor.parseResponse(await testee.execute(structuredClone(entry.request)), operation);
			const actual = descriptor.projectResult(response);
			const expected = descriptor.projectResult(entry.expected);
			const passed = isDeepStrictEqual(actual, expected);
			records.push({
				...base,
				result: passed ? "pass" : "fail",
				...(passed ? {} : { message: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` }),
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
	return runContractKit(kit, testee, packageContract) as Promise<PackageReport>;
}

async function runContractKit<
	Version extends PackageContractVersion,
	Operation extends string,
	Request extends { readonly op: Operation },
	Response,
	Capabilities extends { readonly suite: "package"; readonly contractVersion: Version; readonly operations: readonly Operation[] },
	Projection,
>(
	kit: PackageContractKit<Version, Request, Response>,
	testee: PackageContractTestee<Capabilities, Request, Response>,
	descriptor: PackageContractDescriptor<Version, Operation, Request, Response, Capabilities, Projection>,
): Promise<PackageContractReport<Version, Operation, Capabilities>> {
	let report: PackageContractReport<Version, Operation, Capabilities>;
	try {
		report = await executeContractKit(kit, testee, descriptor);
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

export function runResolutionKit(
	kit: ResolutionKit,
	testee: ResolutionTestee,
): Promise<PackageContractReport<"0.1.0-draft.2", ResolutionOperation, ResolutionCapabilities>> {
	return runContractKit(kit, testee, resolutionContract);
}
/** All cases are required in this bounded draft suite. No skip can pass. */
export function packageExitCode(report: { readonly records: readonly { readonly result: ReportResult }[] }): number {
	return report.records.length > 0 && report.records.every((record) => record.result === "pass") ? 0 : 1;
}
