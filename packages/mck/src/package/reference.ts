// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { driverVersion } from "../driver/version.ts";
import { PACKAGE_CONTRACT, PACKAGE_OPERATIONS, type PackageTestee } from "./contract.ts";
import { strictJson } from "./json.ts";
import { verifyLibrarySet } from "./library.ts";
import { normalizedPackageDigests, packageFileDigest } from "./metadata.ts";
import { parsePackageRequest } from "./protocol.ts";
import { compilePackageSchemas } from "./schemas.ts";

export { canonicalizePackageDocument, packageFileDigest } from "./metadata.ts";
/** Reference behavior is deliberately separate from driver expectations. */
export function referencePackageTestee(): PackageTestee {
	return {
		capabilities: async () => ({
			suite: "package",
			contractVersion: PACKAGE_CONTRACT,
			implementation: "morphir-typescript",
			implementationVersion: driverVersion(),
			operations: PACKAGE_OPERATIONS,
		}),
		execute: async (request) => {
			parsePackageRequest(request);
			switch (request.op) {
				case "hash-bytes":
					return { ok: true, digest: packageFileDigest(Buffer.from(request.hex, "hex")) };
				case "normalize": {
					try {
						return { ok: true, ...normalizedPackageDigests(request.input) };
					} catch {
						return { ok: false, error: "invalid-document" };
					}
				}
				case "validate": {
					// Schema compilation failures are infrastructure errors, never expected rejection.
					const validate = compilePackageSchemas(request.schemas)[request.artifact];
					let value: unknown;
					try {
						value = strictJson(request.input);
					} catch {
						return { ok: true, valid: false };
					}
					return { ok: true, valid: validate(value) === true };
				}
				case "verify-library-set":
					return { ok: true, valid: verifyLibrarySet(request) };
			}
		},
		close: async () => {},
	};
}
