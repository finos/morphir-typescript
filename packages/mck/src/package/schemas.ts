// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { PackageSchemas } from "./contract.ts";

/** Schemas are kit inputs. Invalid schemas or unresolved refs are kit errors. */
export function compilePackageSchemas(schemas: PackageSchemas): Readonly<{ manifest: ValidateFunction; lock: ValidateFunction }> {
	const ajv = new Ajv2020({ strict: false });
	ajv.addSchema(schemas.manifest);
	return { manifest: ajv.compile(schemas.manifest), lock: ajv.compile(schemas.lock) };
}
