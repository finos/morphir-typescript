// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import protocolSchema from "../../package-restore-assurance-protocol.schema.json";
import reportSchema from "../../package-restore-assurance-report.schema.json";
import { array, fields, nonempty, strictJson } from "../../src/package/json.ts";
import { RESTORE_ASSURANCE_PROFILE, RESTORE_ASSURANCE_PROFILE_VERSION, withRestoreAssurance } from "../../src/package/local-registry/assurance.ts";
import { parseRestoreAssuranceReceipt, parseRestoreAssuranceRequest } from "../../src/package/local-registry/assurance-protocol.ts";

const args = process.argv.slice(2);
assert(args.length === 2 && args[0] === "--source" && args[1] && !args[1].startsWith("--"), "Expected explicit --source <parent-root>");
const source = join(args[1], "spec/package/mck/restore-assurance-preflight-vectors.json");
const vectors = fields(strictJson(readFileSync(source, "utf8")), ["profile", "profileVersion", "cases"]);
assert.equal(vectors.profile, RESTORE_ASSURANCE_PROFILE);
assert.equal(vectors.profileVersion, RESTORE_ASSURANCE_PROFILE_VERSION);
const cases = array(vectors.cases);
assert(cases.length > 0, "Expected parent preflight vectors");
const requestSchema = new Ajv2020().compile(protocolSchema);
const receiptSchema = new Ajv2020().compile(reportSchema);
const ids = new Set<string>();

// Parent-owned, fixed synthetic expectations. This exercises the shared preflight
// directly; it is not a restore runner or filesystem provider qualification.
for (const value of cases) {
	const entry = fields(value, ["id", "selection", "provider", "expected"]);
	const id = nonempty(entry.id);
	assert(!ids.has(id), `Duplicate vector ${id}`);
	ids.add(id);
	const input = { selection: entry.selection, provider: entry.provider };
	assert(requestSchema(input), `${id}: ${JSON.stringify(requestSchema.errors)}`);
	const request = parseRestoreAssuranceRequest(input);
	const expected = fields(entry.expected, ["receipt", "accesses"]);
	assert(expected.accesses === 0 || expected.accesses === 1, `${id}: expected zero or one callback access`);
	assert(receiptSchema(expected.receipt), `${id}: ${JSON.stringify(receiptSchema.errors)}`);
	assert.deepEqual(parseRestoreAssuranceReceipt(expected.receipt), expected.receipt, id);
	let accesses = 0;
	const result = await withRestoreAssurance(request.selection, request.provider, () => {
		accesses++;
	});
	assert(receiptSchema(result.receipt), `${id}: ${JSON.stringify(receiptSchema.errors)}`);
	assert.deepEqual(result.receipt, expected.receipt, id);
	assert.equal(accesses, expected.accesses, id);
}
console.log(
	`Restore assurance preflight integration passed: ${cases.length} fixed parent vectors. Synthetic metadata only; no filesystem, authentication, restore, compatibility, or durability claim.`,
);
