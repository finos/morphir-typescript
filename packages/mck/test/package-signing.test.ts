// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { canonicalize } from "@tufjs/canonical-json";
import { dssePae, FIXTURE_DSSE_PAYLOAD_TYPE, fixtureKey, signFixtureDsse, signFixtureTuf, tufKeyId, tufPublicKey } from "./support/package-signing.ts";
import { verifyFixtureDsse } from "./support/package-signing-verifier.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

describe("package signing fixture support", () => {
	test("frames DSSE PAE with byte lengths", () => {
		expect(decoder.decode(dssePae("t", new TextEncoder().encode("{}")))).toBe("DSSEv1 1 t 2 {}");
		expect(decoder.decode(dssePae("é", new TextEncoder().encode("é")))).toBe("DSSEv1 2 é 2 é");
	});

	test("derives deterministic public fixture keys from labeled public seeds", () => {
		const first = fixtureKey("publisher-a");
		const second = fixtureKey("publisher-a");

		expect(first).toEqual(second);
		expect(first.label).toBe("publisher-a");
		expect(first.seed).toBe(createHash("sha256").update("morphir-mck-fixture:publisher-a").digest("hex"));
		expect(first.publicKey).toMatch(/^[0-9a-f]{64}$/);
		expect(ed25519.getPublicKey(Buffer.from(first.seed, "hex"))).toEqual(Buffer.from(first.publicKey, "hex"));
	});

	test("signs the exact draft.3 DSSE PAE with padded standard base64", () => {
		const payload = encoder.encode('{"release":"1.2.0"}');
		const key = fixtureKey("publisher-a");
		const envelope = signFixtureDsse(payload, [key]);

		expect(envelope.payloadType).toBe(FIXTURE_DSSE_PAYLOAD_TYPE);
		expect(envelope.payload).toBe(Buffer.from(payload).toString("base64"));
		expect(envelope.signatures).toHaveLength(1);
		expect(envelope.signatures[0]?.keyid).toBe(key.publicKey);
		expect(envelope.signatures[0]?.sig.endsWith("=")).toBe(true);
		expect(
			ed25519.verify(Buffer.from(envelope.signatures[0]?.sig ?? "", "base64"), dssePae(FIXTURE_DSSE_PAYLOAD_TYPE, payload), Buffer.from(key.publicKey, "hex"), {
				zip215: false,
			}),
		).toBe(true);
	});

	test("verifies thresholds by distinct authorized raw public keys", () => {
		const payload = encoder.encode("{}");
		const first = fixtureKey("publisher-a");
		const second = fixtureKey("publisher-b");
		const oneSignature = signFixtureDsse(payload, [first]);
		const twoSignatures = signFixtureDsse(payload, [first, second]);

		expect(verifyFixtureDsse(oneSignature, [first.publicKey], 1)).toBe(true);
		expect(verifyFixtureDsse(twoSignatures, [first.publicKey, second.publicKey], 2)).toBe(true);
		expect(verifyFixtureDsse(oneSignature, [first.publicKey, first.publicKey], 2)).toBe(false);
		expect(verifyFixtureDsse({ ...oneSignature, signatures: [...oneSignature.signatures, ...oneSignature.signatures] }, [first.publicKey], 2)).toBe(false);
	});

	test("rejects tampering and wrong payload types but ignores an invalid extra signature", () => {
		const key = fixtureKey("publisher-a");
		const valid = signFixtureDsse(encoder.encode("{}"), [key]);
		const bad = { keyid: "misleading", sig: Buffer.alloc(64).toString("base64") };

		expect(verifyFixtureDsse({ ...valid, payload: Buffer.from("[]").toString("base64") }, [key.publicKey], 1)).toBe(false);
		expect(verifyFixtureDsse({ ...valid, payloadType: "application/json" }, [key.publicKey], 1)).toBe(false);
		expect(verifyFixtureDsse({ ...valid, signatures: [bad, ...valid.signatures] }, [key.publicKey], 1)).toBe(true);
		expect(verifyFixtureDsse({ ...valid, signatures: valid.signatures.map((signature) => ({ ...signature, keyid: "wrong-hint" })) }, [key.publicKey], 1)).toBe(
			true,
		);
	});

	test("signs TUF canonical JSON and derives the key ID from its canonical key object", () => {
		const key = fixtureKey("repository-root");
		const signed = { z: "é", a: { n: 2, b: true } };
		const canonicalSigned = '{"a":{"b":true,"n":2},"z":"é"}';
		const publicKey = tufPublicKey(key);
		const envelope = signFixtureTuf(signed, key);

		expect(canonicalize(signed)).toBe(canonicalSigned);
		expect(publicKey.keyval.public).toBe(key.publicKey);
		expect(tufKeyId(key)).toBe(createHash("sha256").update(canonicalize(publicKey)).digest("hex"));
		expect(envelope.signatures[0]?.keyid).toBe(tufKeyId(key));
		expect(envelope.signatures[0]?.sig).toMatch(/^[0-9a-f]{128}$/);
		expect(
			ed25519.verify(Buffer.from(envelope.signatures[0]?.sig ?? "", "hex"), encoder.encode(canonicalSigned), Buffer.from(key.publicKey, "hex"), {
				zip215: false,
			}),
		).toBe(true);
		expect(signFixtureTuf(signed, key)).toEqual(envelope);
	});
});
