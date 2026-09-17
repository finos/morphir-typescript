// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { ed25519 } from "@noble/curves/ed25519.js";
import type { DsseEnvelope } from "./package-signing.ts";
import { dssePae, FIXTURE_DSSE_PAYLOAD_TYPE } from "./package-signing.ts";

// Test-only independent verifier for envelopes produced by package-signing.ts.
export function verifyFixtureDsse(envelope: DsseEnvelope, authorizedKeys: readonly string[], threshold: number): boolean {
	if (threshold < 1 || envelope.payloadType !== FIXTURE_DSSE_PAYLOAD_TYPE) return false;
	const payload = decodeGeneratedBase64(envelope.payload);
	if (!payload) return false;
	const pae = dssePae(envelope.payloadType, payload);
	const signatures = envelope.signatures.flatMap(({ sig }) => {
		const decoded = decodeGeneratedBase64(sig);
		return decoded?.byteLength === 64 ? [decoded] : [];
	});
	const distinctKeys = new Map<string, Uint8Array>();
	for (const encodedKey of authorizedKeys) {
		if (!/^[0-9a-f]{64}$/.test(encodedKey)) continue;
		const key = Buffer.from(encodedKey, "hex");
		distinctKeys.set(encodedKey, key);
	}
	let verified = 0;
	for (const publicKey of distinctKeys.values()) {
		if (signatures.some((signature) => ed25519.verify(signature, pae, publicKey, { zip215: false }))) verified += 1;
	}
	return verified >= threshold;
}

function decodeGeneratedBase64(value: string): Uint8Array | undefined {
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return undefined;
	const decoded = Buffer.from(value, "base64");
	return decoded.toString("base64") === value ? decoded : undefined;
}
