// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeLibraryLock, decodeReleaseStatement } from "../../src/package/local-registry/decode.ts";
import type { LibraryEvidence } from "../../src/package/local-registry/domain.ts";
import { decodeTrustPolicy } from "../../src/package/local-registry/policy.ts";
import { preparePublisherEnvelope, verifyPublisherSignatures } from "../../src/package/local-registry/publisher.ts";
import { PackagePath, releaseIdToWire } from "../../src/package/resolution/model.ts";

const args = process.argv.slice(2);
assert(args.length === 2 && args[0] === "--source" && args[1] && !args[1].startsWith("--"), "Expected explicit --source <parent-root>");
const parent = args[1];
const corpus = join(parent, "spec/package/mck/fixtures/local-registry");
const fixture = join(corpus, "assets/signed");
// Fixed parent assets and expectations are independent of this verifier. No generation occurs.
const description = JSON.parse(readFileSync(join(fixture, "fixture-description.json"), "utf8")) as {
	publicKeys: { label: string; publicKey: string }[];
	inputDigests: Record<string, string>;
};
const expectedKeys = description.publicKeys
	.filter((key) => key.label === "publisher-a" || key.label === "publisher-b")
	.map((key) => key.publicKey)
	.sort();
assert.equal(expectedKeys.length, 2);
const lock = decodeLibraryLock(readFileSync(join(fixture, "morphir.lock")));
const policy = decodeTrustPolicy(readFileSync(join(fixture, "trust-policy.json")));
assert(lock.ok, JSON.stringify(lock));
assert(policy.ok, JSON.stringify(policy));
assert.equal(lock.value.acquisitions.length, 2);
lock.value.acquisitions.forEach((acquisition) => {
	const evidence: LibraryEvidence | undefined = lock.value.evidence.find((entry) => entry.id.toWire() === acquisition.statement.toWire());
	assert(evidence);
	const logical = evidence.path.toWire();
	const split = logical.lastIndexOf("/");
	const physical = join(fixture, "registry/targets", logical.slice(0, split), `${evidence.digest.toWire().slice(7)}.${logical.slice(split + 1)}`);
	const envelopeBytes = readFileSync(physical);
	assert.equal(`sha256:${createHash("sha256").update(envelopeBytes).digest("hex")}`, evidence.digest.toWire());
	const subject = { kind: "object" as const, registry: acquisition.registry, path: evidence.path };
	const prepared = preparePublisherEnvelope(envelopeBytes, subject);
	assert(prepared.ok, JSON.stringify(prepared));
	const verified = verifyPublisherSignatures(prepared.value, { release: acquisition.release, policy: policy.value });
	assert(verified.ok, JSON.stringify(verified));
	assert.deepEqual(
		verified.value.verifiedKeys.map((key) => key.toWire()),
		expectedKeys,
	);
	assert.equal(verified.value.publisherRule.threshold, 1);
	assert.deepEqual(verified.value.envelopeBytes(), new Uint8Array(envelopeBytes));
	const name = acquisition.release.packagePath.toWire().split("/").at(-1);
	const payloadPath = `spec/package/mck/fixtures/local-registry/unsigned/${name}-statement-payload.json`;
	const unsignedInput = readFileSync(join(parent, payloadPath));
	assert.equal(`sha256:${createHash("sha256").update(unsignedInput).digest("hex")}`, description.inputDigests[payloadPath]);
	// The unsigned source is pretty JSON; the fixed signed envelope contains the canonical bytes.
	const expectedPayload = Buffer.from(JSON.parse(envelopeBytes.toString("utf8")).payload, "base64");
	assert.deepEqual(JSON.parse(expectedPayload.toString("utf8")), JSON.parse(unsignedInput.toString("utf8")));
	assert.deepEqual(verified.value.payloadBytes(), new Uint8Array(expectedPayload));
	const statement = decodeReleaseStatement(verified.value.payloadBytes(), subject);
	assert(statement.ok, JSON.stringify(statement));
	assert.deepEqual(releaseIdToWire(statement.value.release), releaseIdToWire(acquisition.release));
	// A valid signed statement B checked for requested A only produces A-bound signature evidence.
	const requestedA = { ...acquisition.release, packagePath: PackagePath.parse("example.com/finance/requested-a") };
	const checkedForA = verifyPublisherSignatures(prepared.value, { release: requestedA, policy: policy.value });
	assert(checkedForA.ok, JSON.stringify(checkedForA));
	assert.deepEqual(releaseIdToWire(checkedForA.value.requestedRelease), releaseIdToWire(requestedA));
	assert.notDeepEqual(releaseIdToWire(checkedForA.value.requestedRelease), releaseIdToWire(statement.value.release));
	assert.deepEqual(checkedForA.value.payloadBytes(), new Uint8Array(expectedPayload));
	// Exact signature success precedes the independent canonical payload decoder.
	assert.equal(decodeReleaseStatement(Buffer.concat([expectedPayload, Buffer.from(" ")]), subject).ok, false);
});
console.log(
	"Publisher integration passed: two fixed statements, both authorized keys at threshold one, exact envelope/payload bytes, valid B payload with A-bound evidence. No repository authentication or restore claim.",
);
