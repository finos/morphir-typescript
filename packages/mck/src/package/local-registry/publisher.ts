// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { ed25519 } from "@noble/curves/ed25519.js";
import { isObject, type JsonValue } from "../../../../ir/src/codec/json/value.ts";
import { type ReleaseId, type ReleaseIdWire, releaseIdToWire } from "../resolution/model.ts";
import { decodeJsonDomain } from "./decode.ts";
import { type DecodeResult, invalid, resourceFailure, type Subject, type SubjectWire, selectFailure, subjectToWire } from "./diagnostics.ts";
import type { PublisherKey, PublisherRule, TrustPolicy } from "./domain.ts";
import { matchingPublisherRule, publisherThresholdMet } from "./policy.ts";
import { member, pointerChild, Shape } from "./shape.ts";

const payloadType = "application/vnd.morphir.library-release.v0.1.0-draft.3+json";
type ObjectSubject = Extract<Subject, { kind: "object" }>;
declare const preparedBrand: unique symbol;
/** Decoded envelope only. The opaque token carries no authenticated authority. */
export interface PreparedPublisherEnvelope {
	readonly [preparedBrand]: true;
}
// Private fields make the evidence nominal: spreading metadata cannot rebind its authority.
// The implementation class and its constructor are deliberately not exported.
class VerifiedPublisherSignatures {
	readonly #payload: Uint8Array;
	readonly #envelope: Uint8Array;
	constructor(
		readonly requestedRelease: ReleaseId,
		readonly subject: ObjectSubject,
		readonly publisherRule: PublisherRule,
		readonly verifiedKeys: readonly PublisherKey[],
		payload: Uint8Array,
		envelope: Uint8Array,
	) {
		this.#payload = new Uint8Array(payload);
		this.#envelope = new Uint8Array(envelope);
		Object.freeze(this);
	}
	payloadBytes(): Uint8Array {
		return new Uint8Array(this.#payload);
	}
	envelopeBytes(): Uint8Array {
		return new Uint8Array(this.#envelope);
	}
}
Object.freeze(VerifiedPublisherSignatures.prototype);
/** Publisher signatures for the requested release, not a parsed or authenticated release. */
export type PublisherSignatureEvidence = VerifiedPublisherSignatures;
interface EnvelopeData {
	readonly subject: ObjectSubject;
	readonly envelope: Uint8Array;
	readonly payload: Uint8Array;
	readonly signatures: readonly Uint8Array[];
}
const preparedData = new WeakMap<PreparedPublisherEnvelope, EnvelopeData>();
type PublisherFault =
	| {
			readonly code: "unauthorized-publisher";
			readonly witnesses: readonly [
				{ readonly kind: "authority"; readonly registry: string; readonly release: ReleaseIdWire; readonly rule: "publisher-rule-missing" },
			];
	  }
	| {
			readonly code: "signature-invalid";
			readonly witnesses: readonly [
				{ readonly kind: "authentication"; readonly subject: SubjectWire; readonly role: "publisher"; readonly required: string; readonly verified: string },
			];
	  };
export type PublisherVerificationResult =
	| { readonly ok: true; readonly value: PublisherSignatureEvidence }
	| { readonly ok: false; readonly diagnostic: PublisherFault & { readonly category: "domain-rejection"; readonly phase: "authorization" } };

// Buffer's permissive decoder alone accepts whitespace, malformed padding and pad bits.
function decodeBase64(text: string): Uint8Array | undefined {
	if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(text) || (/[+/]/.test(text) && /[-_]/.test(text))) return undefined;
	const unpadded = text.replace(/=+$/, "");
	if (unpadded.length % 4 === 1) return undefined;
	if (text !== unpadded && (text.length % 4 !== 0 || text.length - unpadded.length !== (4 - (unpadded.length % 4)) % 4)) return undefined;
	const normalized = unpadded.replaceAll("-", "+").replaceAll("_", "/");
	const decoded = Buffer.from(normalized, "base64");
	if (decoded.toString("base64").replace(/=+$/, "") !== normalized) return undefined;
	return new Uint8Array(decoded);
}
function openObject(value: JsonValue | undefined, pointer: string, required: readonly string[], shape: Shape): boolean {
	if (value === undefined || !isObject(value)) {
		shape.add(pointer, "invalid-type");
		return false;
	}
	for (const name of required) if (!value.members.has(name)) shape.add(pointerChild(pointer, name), "missing-field");
	return true;
}
function base64Field(value: JsonValue | undefined, pointer: string, shape: Shape): Uint8Array | undefined {
	const text = shape.string(value, pointer);
	if (text === undefined) return undefined;
	const decoded = decodeBase64(text);
	if (decoded === undefined) shape.add(pointer, "invalid-value");
	return decoded;
}

/** Own exact bytes before interpreting them. Payload JSON is deliberately not parsed here. */
export function preparePublisherEnvelope(bytes: Uint8Array, subject: ObjectSubject): DecodeResult<PreparedPublisherEnvelope> {
	if (bytes.byteLength > 1048576) return resourceFailure(subject, "repository", "envelope-bytes", 1048576);
	const envelope = new Uint8Array(bytes);
	const ownedSubject = Object.freeze({ ...subject });
	const decoded = decodeJsonDomain(envelope, { kind: "dsse" }, ownedSubject, "repository");
	if (!decoded.ok) return decoded;
	const document = decoded.value.document;
	const signatures = member(document, "signatures");
	if (Array.isArray(signatures) && signatures.length > 64) return resourceFailure(ownedSubject, "repository", "signatures", 64);
	const shape = new Shape(ownedSubject);
	const decodedSignatures: Uint8Array[] = [];
	let payload: Uint8Array | undefined;
	if (openObject(document, "", ["payloadType", "payload", "signatures"], shape)) {
		shape.literal(member(document, "payloadType"), "/payloadType", [payloadType], "unsupported-payload-type");
		payload = base64Field(member(document, "payload"), "/payload", shape);
		if (payload !== undefined && payload.byteLength > 1048576) return resourceFailure(ownedSubject, "repository", "statement-bytes", 1048576);
		shape.array(signatures, "/signatures").forEach((signature, index) => {
			const pointer = `/signatures/${index}`;
			if (!openObject(signature, pointer, ["sig"], shape)) return;
			shape.string(member(signature, "keyid"), `${pointer}/keyid`);
			const sig = base64Field(member(signature, "sig"), `${pointer}/sig`, shape);
			if (sig !== undefined) decodedSignatures.push(sig);
		});
	}
	// Base64 grammar is remaining shape, after JSON syntax and supported literals.
	// Preserve the enclosing repository phase for every envelope diagnostic.
	const unsupported = selectFailure(shape.support.map((fault) => ({ ...fault, phase: "repository" as const })));
	if (unsupported) return unsupported;
	if (shape.violations.length) return invalid(ownedSubject, "repository", shape.violations);
	if (payload === undefined) throw new Error("validated DSSE envelope lacks payload");
	const token = Object.freeze({}) as PreparedPublisherEnvelope;
	preparedData.set(token, { subject: ownedSubject, envelope, payload, signatures: decodedSignatures });
	return { ok: true, value: token };
}

/** Current publisher policy applies to the requested release, never an unparsed payload identity.
 * Callers supply decoded policy. A structurally constructed invalid selected rule is a programmer error.
 */
export function verifyPublisherSignatures(
	envelope: PreparedPublisherEnvelope,
	context: { readonly release: ReleaseId; readonly policy: TrustPolicy },
): PublisherVerificationResult {
	const data = preparedData.get(envelope);
	if (data === undefined) throw new TypeError("expected a prepared publisher envelope");
	const requestedRelease = Object.freeze({ ...context.release });
	const selected = matchingPublisherRule(context.policy, requestedRelease.packagePath);
	if (selected === undefined)
		return {
			ok: false,
			diagnostic: {
				category: "domain-rejection",
				code: "unauthorized-publisher",
				phase: "authorization",
				witnesses: [
					{ kind: "authority", registry: data.subject.registry.toWire(), release: releaseIdToWire(requestedRelease), rule: "publisher-rule-missing" },
				],
			},
		};
	const publisherRule = Object.freeze({ ...selected, publicKeys: Object.freeze([...selected.publicKeys]) });
	if (
		!Number.isSafeInteger(publisherRule.threshold) ||
		publisherRule.threshold < 1 ||
		publisherRule.publicKeys.length > 64 ||
		publisherRule.threshold > new Set(publisherRule.publicKeys.map((key) => key.toWire())).size
	)
		throw new TypeError("expected a validated publisher rule with a positive achievable threshold");
	const type = Buffer.from(payloadType, "utf8");
	const pae = Buffer.concat([Buffer.from(`DSSEv1 ${type.byteLength} `), type, Buffer.from(` ${data.payload.byteLength} `), data.payload]);
	const distinct = new Map(publisherRule.publicKeys.map((key) => [key.toWire(), key]));
	const verifiedKeys = Object.freeze(
		[...distinct]
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.flatMap(([raw, key]) => {
				const publicKey = Buffer.from(raw, "hex");
				return data.signatures.some((sig) => sig.byteLength === 64 && ed25519.verify(sig, pae, publicKey, { zip215: false })) ? [key] : [];
			}),
	);
	if (!publisherThresholdMet(publisherRule, verifiedKeys))
		return {
			ok: false,
			diagnostic: {
				category: "domain-rejection",
				code: "signature-invalid",
				phase: "authorization",
				witnesses: [
					{
						kind: "authentication",
						subject: subjectToWire(data.subject),
						role: "publisher",
						required: String(publisherRule.threshold),
						verified: String(verifiedKeys.length),
					},
				],
			},
		};
	const value = new VerifiedPublisherSignatures(requestedRelease, data.subject, publisherRule, verifiedKeys, data.payload, data.envelope);
	return { ok: true, value };
}
