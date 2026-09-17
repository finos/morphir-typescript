// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

// Test-only deterministic signing support. Seeds are public and must never secure real artifacts.

import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { canonicalize } from "@tufjs/canonical-json";

const encoder = new TextEncoder();

export const FIXTURE_DSSE_PAYLOAD_TYPE = "application/vnd.morphir.library-release.v0.1.0-draft.3+json";

export interface FixtureKey {
	readonly label: string;
	readonly publicKey: string;
	readonly seed: string;
}

export interface DsseEnvelope {
	readonly payloadType: string;
	readonly payload: string;
	readonly signatures: readonly { readonly keyid: string; readonly sig: string }[];
}

export interface TufPublicKey {
	readonly keytype: "ed25519";
	readonly scheme: "ed25519";
	readonly keyval: { readonly public: string };
}

export interface TufSignedEnvelope {
	readonly signed: object;
	readonly signatures: readonly { readonly keyid: string; readonly sig: string }[];
}

export function fixtureKey(label: string): FixtureKey {
	const seed = createHash("sha256").update(`morphir-mck-fixture:${label}`).digest();
	const privateKey = privateKeyFromSeed(seed);
	const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
	if (!publicDer.subarray(0, ED25519_SPKI_PREFIX.byteLength).equals(ED25519_SPKI_PREFIX)) {
		throw new Error("fixture Ed25519 public key has an unexpected SPKI prefix");
	}
	const publicKey = publicDer.subarray(ED25519_SPKI_PREFIX.byteLength);
	if (publicKey.byteLength !== 32) throw new Error("fixture Ed25519 public key is not 32 bytes");
	return { label, publicKey: publicKey.toString("hex"), seed: seed.toString("hex") };
}

export function signFixtureDsse(payload: Uint8Array, keys: readonly FixtureKey[]): DsseEnvelope {
	const pae = dssePae(FIXTURE_DSSE_PAYLOAD_TYPE, payload);
	return {
		payloadType: FIXTURE_DSSE_PAYLOAD_TYPE,
		payload: Buffer.from(payload).toString("base64"),
		signatures: keys.map((key) => ({
			keyid: key.publicKey,
			sig: sign(null, pae, privateKeyFromFixtureKey(key)).toString("base64"),
		})),
	};
}

export function tufPublicKey(key: FixtureKey): TufPublicKey {
	return {
		keytype: "ed25519",
		scheme: "ed25519",
		keyval: { public: key.publicKey },
	};
}

export function tufKeyId(key: FixtureKey): string {
	return createHash("sha256")
		.update(canonicalize(tufPublicKey(key)))
		.digest("hex");
}

export function signFixtureTuf(signed: object, key: FixtureKey): TufSignedEnvelope {
	const canonical = encoder.encode(canonicalize(signed));
	return {
		signed,
		signatures: [{ keyid: tufKeyId(key), sig: sign(null, canonical, privateKeyFromFixtureKey(key)).toString("hex") }],
	};
}

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function privateKeyFromSeed(seed: Uint8Array) {
	if (seed.byteLength !== 32) throw new Error("fixture Ed25519 seed is not 32 bytes");
	return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
}

function privateKeyFromFixtureKey(key: FixtureKey) {
	return privateKeyFromSeed(Buffer.from(key.seed, "hex"));
}

export function dssePae(payloadType: string, payload: Uint8Array): Uint8Array {
	const type = encoder.encode(payloadType);
	const prefix = encoder.encode(`DSSEv1 ${type.byteLength} `);
	const separator = encoder.encode(` ${payload.byteLength} `);
	const result = new Uint8Array(prefix.byteLength + type.byteLength + separator.byteLength + payload.byteLength);
	result.set(prefix);
	result.set(type, prefix.byteLength);
	result.set(separator, prefix.byteLength + type.byteLength);
	result.set(payload, prefix.byteLength + type.byteLength + separator.byteLength);
	return result;
}
