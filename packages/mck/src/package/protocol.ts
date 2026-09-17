// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import type { PackageContractDescriptor } from "./contract.ts";
import {
	PACKAGE_CONTRACT,
	PACKAGE_OPERATIONS,
	type PackageCapabilities,
	type PackageOperation,
	type PackageRequest,
	type PackageResponse,
} from "./contract.ts";
import { array, digest, fields, hex, nonempty, object, string } from "./json.ts";

export function parsePackageCapabilities(value: unknown): PackageCapabilities {
	const entry = fields(value, ["suite", "contractVersion", "implementation", "implementationVersion", "operations"]);
	if (entry.suite !== "package" || entry.contractVersion !== PACKAGE_CONTRACT) throw new Error("unsupported package adapter contract");
	const operations = array(entry.operations).map((op) => {
		if (!PACKAGE_OPERATIONS.includes(op as PackageOperation)) throw new Error(`unknown package operation ${op}`);
		return op as PackageOperation;
	});
	if (new Set(operations).size !== operations.length) throw new Error("duplicate package capability");
	return {
		suite: "package",
		contractVersion: PACKAGE_CONTRACT,
		implementation: nonempty(entry.implementation),
		implementationVersion: nonempty(entry.implementationVersion),
		operations,
	};
}
export function parsePackageRequest(value: unknown): PackageRequest | { readonly op: "capabilities" } | { readonly op: "exit" } {
	const entry = object(value);
	switch (entry.op) {
		case "capabilities":
		case "exit":
			fields(entry, ["op"]);
			return { op: entry.op };
		case "normalize":
			fields(entry, ["op", "input"]);
			return { op: entry.op, input: string(entry.input) };
		case "hash-bytes":
			fields(entry, ["op", "hex"]);
			return { op: entry.op, hex: hex(entry.hex) };
		case "validate": {
			fields(entry, ["op", "artifact", "input", "schemas"]);
			if (entry.artifact !== "manifest" && entry.artifact !== "lock") throw new Error("unknown package artifact");
			const schemas = fields(entry.schemas, ["manifest", "lock"]);
			return {
				op: entry.op,
				artifact: entry.artifact,
				input: string(entry.input),
				schemas: { manifest: object(schemas.manifest), lock: object(schemas.lock) },
			};
		}
		case "verify-library-set": {
			fields(entry, ["op", "lock", "libraries", "schemas"]);
			const schemas = fields(entry.schemas, ["manifest", "lock"]);
			const libraries = array(entry.libraries).map((value) => {
				const library = fields(value, ["manifest", "files"]);
				return {
					manifest: string(library.manifest),
					files: array(library.files).map((value) => {
						const file = fields(value, ["path", "hex"]);
						return { path: nonempty(file.path), hex: hex(file.hex) };
					}),
				};
			});
			return { op: entry.op, lock: string(entry.lock), libraries, schemas: { manifest: object(schemas.manifest), lock: object(schemas.lock) } };
		}
		default:
			throw new Error("unknown package request");
	}
}
export function parsePackageResponse(value: unknown, op: PackageOperation): PackageResponse {
	const entry = object(value);
	if (entry.ok === false && op === "normalize") {
		fields(entry, ["ok", "error"]);
		if (entry.error !== "invalid-document") throw new Error("unknown package error");
		return { ok: false, error: "invalid-document" };
	}
	if (entry.ok !== true) throw new Error(`package adapter did not return a result for ${op}`);
	switch (op) {
		case "normalize":
			fields(entry, ["ok", "canonical", "manifestDigest", "packageContentDigest"]);
			return {
				ok: true,
				canonical: string(entry.canonical),
				manifestDigest: digest(entry.manifestDigest),
				packageContentDigest: digest(entry.packageContentDigest),
			};
		case "hash-bytes":
			fields(entry, ["ok", "digest"]);
			return { ok: true, digest: digest(entry.digest) };
		case "validate":
		case "verify-library-set": {
			fields(entry, ["ok", "valid"]);
			if (typeof entry.valid !== "boolean") throw new Error("expected boolean validation result");
			return { ok: true, valid: entry.valid };
		}
	}
}

export const packageContract: PackageContractDescriptor<
	typeof PACKAGE_CONTRACT,
	PackageOperation,
	PackageRequest,
	PackageResponse,
	PackageCapabilities,
	PackageResponse
> = {
	contractVersion: PACKAGE_CONTRACT,
	operation: (request) => request.op,
	supports: (capabilities, operation) => capabilities.operations.includes(operation),
	parseCapabilities: parsePackageCapabilities,
	parseRequest: parsePackageRequest,
	parseResponse: parsePackageResponse,
	projectResult: (value) => structuredClone(value),
};
