// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeLibraryLock, decodeRegistryRecord, decodeReleaseStatement } from "../../src/package/local-registry/decode.ts";
import { LocalId, RegistryPath } from "../../src/package/local-registry/domain.ts";
import { decodeTrustPolicy } from "../../src/package/local-registry/policy.ts";

const args = process.argv.slice(2);
assert(args.length === 2 && args[0] === "--source" && args[1] && !args[1].startsWith("--"), "Expected explicit --source <parent-root>");
const corpus = join(args[1], "spec/package/mck/fixtures/local-registry");
const fixture = join(corpus, "assets/signed");

// These are trusted repository fixtures, not the runtime registry filesystem provider.
// Read fixed expectations from the parent; never derive them from decoder output.
const wire = JSON.parse(readFileSync(join(corpus, "cases/wire.json"), "utf8"));
let probes = 0;
for (const entry of wire.cases) {
	if (entry.kind !== "parse") continue;
	assert.equal(entry.target, "lock");
	assert.equal(entry.input.kind, "hex");
	assert.equal(entry.expected.kind, "inline");
	assert.deepEqual(decodeLibraryLock(Buffer.from(entry.input.value, "hex")), entry.expected.result, entry.id);
	probes++;
}
assert.equal(probes, 4);
const lockBytes = readFileSync(join(fixture, "morphir.lock"));
const lockResult = decodeLibraryLock(lockBytes);
assert(lockResult.ok, JSON.stringify(lockResult));
const policyResult = decodeTrustPolicy(readFileSync(join(fixture, "trust-policy.json")));
assert(policyResult.ok, JSON.stringify(policyResult));

const lock = JSON.parse(lockBytes.toString("utf8"));
assert.equal(lock.acquisitions.length, 2);
// Reproduce only the exact single mutations specified in these case descriptions.
// Their scenario assets remain pending; this is a decoder check, not case execution.
const mutations = ["duplicate-acquisition", "missing-acquisition", "unsupported-source", "absolute-path", "unknown-capability", "missing-evidence-reference"];
for (const mutation of mutations) {
	const input = structuredClone(lock);
	switch (mutation) {
		case "duplicate-acquisition":
			input.acquisitions.push(structuredClone(input.acquisitions[0]));
			break;
		case "missing-acquisition":
			input.acquisitions.splice(0, 1);
			break;
		case "unsupported-source":
			input.acquisitions[0].source.kind = "archive";
			break;
		case "absolute-path":
			input.acquisitions[0].source.path = "/tmp/eligibility";
			break;
		case "unknown-capability":
			input.resolution.requiredCapabilities.push("future-signatures");
			break;
		case "missing-evidence-reference":
			input.acquisitions[0].statement = "absent-statement";
			break;
	}
	const entry = wire.cases.find((candidate: { id: string }) => candidate.id === `local-registry.wire.${mutation}`);
	assert(entry, mutation);
	assert.equal(entry.operations.length, 1);
	assert.equal(entry.operations[0].expected.kind, "inline");
	assert.deepEqual(decodeLibraryLock(Buffer.from(JSON.stringify(input))), entry.operations[0].expected.result, mutation);
}
for (const acquisition of lock.acquisitions) {
	const physicalTarget = (path: string, digest: string): string => {
		const split = path.lastIndexOf("/");
		return join(fixture, "registry/targets", path.slice(0, split), `${digest.slice(7)}.${path.slice(split + 1)}`);
	};
	const registry = LocalId.parse(acquisition.registry);
	const record = decodeRegistryRecord(readFileSync(physicalTarget(acquisition.record.path, acquisition.record.digest)), {
		kind: "object",
		registry,
		path: RegistryPath.parse(acquisition.record.path),
	});
	assert(record.ok, JSON.stringify(record));
	const evidence = lock.evidence.find((entry: { id: string }) => entry.id === acquisition.statement);
	assert(evidence);
	const envelope = JSON.parse(readFileSync(physicalTarget(evidence.path, evidence.digest), "utf8"));
	const statement = decodeReleaseStatement(Buffer.from(envelope.payload, "base64"), {
		kind: "object",
		registry,
		path: RegistryPath.parse(evidence.path),
	});
	assert(statement.ok, JSON.stringify(statement));
}
console.log(
	"Decode integration passed: four raw probes, six specified wire mutations, signed-fixture lock and policy, two records and two payloads. No authentication or restore claim.",
);
