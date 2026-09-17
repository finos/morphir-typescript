// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

/** Separate experimental package contract. IR protocol/report v1 is unchanged. */
export const PACKAGE_CONTRACT = "0.1.0-draft.1" as const;
export const PACKAGE_OPERATIONS = ["normalize", "hash-bytes", "validate", "verify-library-set"] as const;
export type PackageOperation = (typeof PACKAGE_OPERATIONS)[number];
export type PackageSchemas = Readonly<{ manifest: object; lock: object }>;
export interface PackageLibrary {
	readonly manifest: string;
	readonly files: readonly { readonly path: string; readonly hex: string }[];
}
export type PackageRequest =
	| { readonly op: "normalize"; readonly input: string }
	| { readonly op: "hash-bytes"; readonly hex: string }
	| { readonly op: "validate"; readonly artifact: "manifest" | "lock"; readonly input: string; readonly schemas: PackageSchemas }
	| { readonly op: "verify-library-set"; readonly lock: string; readonly libraries: readonly PackageLibrary[]; readonly schemas: PackageSchemas };
export type PackageResponse =
	| { readonly ok: true; readonly canonical: string; readonly manifestDigest: string; readonly packageContentDigest: string }
	| { readonly ok: true; readonly digest: string }
	| { readonly ok: true; readonly valid: boolean }
	| { readonly ok: false; readonly error: "invalid-document" };
export interface PackageCapabilities {
	readonly suite: "package";
	readonly contractVersion: typeof PACKAGE_CONTRACT;
	readonly implementation: string;
	readonly implementationVersion: string;
	readonly operations: readonly PackageOperation[];
}
export interface PackageTestee {
	capabilities(): Promise<PackageCapabilities>;
	execute(request: PackageRequest): Promise<PackageResponse>;
	close(): Promise<void>;
}

export type PackageContractVersion = typeof PACKAGE_CONTRACT | "0.1.0-draft.2";

/** Shared execution shape used by every package contract revision. */
export interface PackageContractTestee<Capabilities, Request, Response> {
	capabilities(): Promise<Capabilities>;
	execute(request: Request): Promise<Response>;
	close(): Promise<void>;
}

export interface PackageContractCase<Request, Expected> {
	readonly id: string;
	readonly request: Request;
	readonly expected: Expected;
}

export interface PackageContractKit<Version extends PackageContractVersion, Request, Expected> {
	readonly formatVersion: Version;
	readonly contentHash: string;
	readonly cases: readonly PackageContractCase<Request, Expected>[];
	readonly errors: readonly string[];
}

/**
 * Contract-specific parsing and projection around the one package runner.
 * Transport, lifecycle, comparison, and reporting stay contract-independent.
 */
export interface PackageContractDescriptor<
	Version extends PackageContractVersion,
	Operation extends string,
	Request extends { readonly op: Operation },
	Response,
	Capabilities extends {
		readonly suite: "package";
		readonly contractVersion: Version;
		readonly operations: readonly Operation[];
	},
	Projection,
> {
	readonly contractVersion: Version;
	operation(request: Request): Operation;
	supports(capabilities: Capabilities, operation: Operation): boolean;
	parseCapabilities(value: unknown): Capabilities;
	parseRequest(value: unknown): Request | { readonly op: "capabilities" } | { readonly op: "exit" };
	parseResponse(value: unknown, operation: Operation): Response;
	projectResult(value: Response): Projection;
}
