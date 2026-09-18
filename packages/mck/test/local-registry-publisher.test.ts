// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { decodeReleaseStatement } from "../src/package/local-registry/decode.ts";
import { LocalId, Namespace, PublisherKey, RegistryPath, type TrustPolicy } from "../src/package/local-registry/domain.ts";
import * as publisher from "../src/package/local-registry/publisher.ts";
import { PackagePath, StableVersion } from "../src/package/resolution/model.ts";
import { FIXTURE_DSSE_PAYLOAD_TYPE, fixtureKey, signFixtureDsse } from "./support/package-signing.ts";

const alice = fixtureKey("publisher-alice");
const bob = fixtureKey("publisher-bob");
const outsider = fixtureKey("publisher-outsider");
const payload = Buffer.from("{ malformed payload with UTF-8: λ }");
const subject = () => ({ kind: "object" as const, registry: LocalId.parse("example"), path: RegistryPath.parse("statements/release.json") });
const release = (name = "example.com/finance/a") => ({ packagePath: PackagePath.parse(name), version: StableVersion.parse("1.0.0") });
const rule = (namespace: string, keys = [alice.publicKey, bob.publicKey], threshold = 1) => ({
	namespace: Namespace.parse(namespace),
	publicKeys: keys.map(PublisherKey.parse),
	threshold,
});
const policy = (rules = [rule("example.com")]): TrustPolicy => ({ repositories: [], publisherRules: rules, continuedUse: "previous-authorization" });
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const envelope = () => signFixtureDsse(payload, [alice, bob]);

// Compiler regression: copying public fields cannot preserve signature evidence authority.
// This function is deliberately never called; the workspace typecheck checks its body.
function cannotRebindEvidence(evidence: publisher.PublisherSignatureEvidence): publisher.PublisherSignatureEvidence {
	// @ts-expect-error A structural copy is not opaque publisher-signature evidence.
	const rebound: publisher.PublisherSignatureEvidence = {
		...evidence,
		requestedRelease: release("attacker.example/rebound"),
		payloadBytes: () => new Uint8Array([0]),
		envelopeBytes: () => evidence.envelopeBytes(),
	};
	return rebound;
}
void cannotRebindEvidence;

function prepared(value: unknown = envelope()) {
	const result = publisher.preparePublisherEnvelope(bytes(value), subject());
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(JSON.stringify(result));
	return result.value;
}
function verify(value: unknown = envelope(), trust = policy(), requested = release()) {
	return publisher.verifyPublisherSignatures(prepared(value), { release: requested, policy: trust });
}

test("publisher entry points exist independently of public package routing", () => {
	expect(typeof publisher.preparePublisherEnvelope).toBe("function");
	expect(typeof publisher.verifyPublisherSignatures).toBe("function");
});

// Independent fixed vectors from RFC 8032 section 7.1, TEST 1 and TEST 2.
// https://www.rfc-editor.org/rfc/rfc8032#section-7.1
test.each([
	[
		"d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
		"",
		"e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
	],
	[
		"3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
		"72",
		"92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
	],
])("strict Ed25519 qualifies against RFC 8032 key %s", (key, message, signature) => {
	const sig = Buffer.from(signature, "hex");
	const pk = Buffer.from(key, "hex");
	const msg = Buffer.from(message, "hex");
	expect(ed25519.verify(sig, msg, pk, { zip215: false })).toBe(true);
	expect(ed25519.verify(sig, Buffer.concat([msg, Buffer.from([0])]), pk, { zip215: false })).toBe(false);
	const overflow = Buffer.from(sig);
	overflow.fill(255, 32);
	expect(ed25519.verify(overflow, msg, pk, { zip215: false })).toBe(false);
});

test("strict verifier rejects the identity-key signature accepted by default ZIP215", () => {
	const key = `01${"00".repeat(31)}`;
	const sig = Buffer.from(`01${"00".repeat(63)}`, "hex");
	expect(ed25519.verify(sig, payload, Buffer.from(key, "hex"))).toBe(true);
	expect(ed25519.verify(sig, payload, Buffer.from(key, "hex"), { zip215: false })).toBe(false);
	expect(verify({ ...envelope(), signatures: [{ sig: sig.toString("base64") }] }, policy([rule("example.com", [key])]))).toMatchObject({
		ok: false,
		diagnostic: {
			code: "signature-invalid",
			category: "domain-rejection",
			phase: "authorization",
			witnesses: [{ role: "publisher", required: "1", verified: "0" }],
		},
	});
});

test("threshold one retains all distinct verified authorized raw keys in sorted order", () => {
	const value = envelope();
	const signatures = [...value.signatures, ...value.signatures, { sig: "AA==", keyid: alice.publicKey }, ...signFixtureDsse(payload, [outsider]).signatures];
	const result = verify({ ...value, signatures: signatures.map((s, i) => ({ ...s, keyid: i % 2 ? "misleading λ" : "" })) });
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.value.verifiedKeys.map((key) => key.toWire())).toEqual([alice.publicKey, bob.publicKey].sort());
	expect(result.value.payloadBytes()).toEqual(new Uint8Array(payload));
});

test("absent hints work; repeated valid signatures cannot inflate a threshold", () => {
	const signed = signFixtureDsse(payload, [alice]);
	const signatures = signed.signatures.map(({ sig }) => ({ sig }));
	expect(verify({ ...signed, signatures }).ok).toBe(true);
	expect(verify({ ...signed, signatures: [...signatures, ...signatures] }, policy([rule("example.com", undefined, 2)]))).toMatchObject({
		ok: false,
		diagnostic: { witnesses: [{ required: "2", verified: "1" }] },
	});
});

test("component boundaries and longest rule prevent fallback and pooling", () => {
	const trust = policy([rule("example.com", [alice.publicKey]), rule("example.com/finance", [bob.publicKey, outsider.publicKey], 2)]);
	expect(verify(envelope(), trust)).toMatchObject({ ok: false, diagnostic: { witnesses: [{ required: "2", verified: "1" }] } });
	expect(verify(envelope(), trust, release("example.com/finance-other/a")).ok).toBe(true);
	const requested = release("example.com.evil/finance/a");
	expect(verify(envelope(), trust, requested)).toEqual({
		ok: false,
		diagnostic: {
			category: "domain-rejection",
			code: "unauthorized-publisher",
			phase: "authorization",
			witnesses: [
				{ kind: "authority", registry: "example", release: { packagePath: requested.packagePath.toWire(), version: "1.0.0" }, rule: "publisher-rule-missing" },
			],
		},
	});
});

test.each(
	[[], [{ sig: "" }], [{ sig: "AA==" }], [{ sig: Buffer.alloc(65).toString("base64") }], [{ sig: Buffer.alloc(64, 255).toString("base64") }]].map(
		(signatures) => [signatures] as const,
	),
)("well-decoded invalid signatures contribute zero: %j", (signatures) => {
	expect(verify({ ...envelope(), signatures })).toMatchObject({
		ok: false,
		diagnostic: { code: "signature-invalid", witnesses: [{ required: "1", verified: "0" }] },
	});
});

test("exact PAE authenticates type, decimal byte lengths, and payload bytes", () => {
	const value = envelope();
	expect(verify(value).ok).toBe(true);
	expect(verify({ ...value, payload: Buffer.concat([payload, Buffer.from(" ")]).toString("base64") }).ok).toBe(false);
	for (const message of [
		payload,
		Buffer.from(`DSSEv1 0  ${payload.length} ${payload}`),
		Buffer.from(`DSSEv1 ${FIXTURE_DSSE_PAYLOAD_TYPE.length} ${FIXTURE_DSSE_PAYLOAD_TYPE} 0${payload.length} ${payload}`),
	]) {
		const sig = ed25519.sign(message, Buffer.from(alice.seed, "hex"));
		expect(verify({ ...value, signatures: [{ sig: Buffer.from(sig).toString("base64") }] }).ok).toBe(false);
	}
});

test.each(["standard padded", "standard unpadded", "url padded", "url unpadded"])("accepts %s base64", (form) => {
	const encode = (text: string) => {
		const standard = form.startsWith("url") ? text.replaceAll("+", "-").replaceAll("/", "_") : text;
		return form.endsWith("unpadded") ? standard.replace(/=+$/, "") : standard;
	};
	const value = signFixtureDsse(Buffer.from([251, 255, 255, 254]), [alice]);
	expect(verify({ ...value, payload: encode(value.payload), signatures: value.signatures.map(({ sig }) => ({ sig: encode(sig) })) }).ok).toBe(true);
});

test.each(["A", "AA=", "AA===", "=AAA", "AAA==", "AA==x", " A A==", "AA==\n", "+_8=", "AB==", "AAB=", "AB", "AAB"])(
	"rejects malformed base64 %j before crypto",
	(text) => {
		for (const value of [
			{ ...envelope(), payload: text },
			{ ...envelope(), signatures: [...envelope().signatures, { sig: text }] },
		])
			expect(publisher.preparePublisherEnvelope(bytes(value), subject())).toMatchObject({
				ok: false,
				diagnostic: { code: "invalid-input", phase: "repository" },
			});
	},
);

test("unknown extension JSON remains open, including numeric tokens and Unicode", () => {
	const value = envelope();
	const json = JSON.stringify({ ...value, extension: ["λ", null, true, 1.5], signatures: value.signatures.map((s) => ({ ...s, extension: false })) }).replace(
		"1.5",
		"1.5e9999",
	);
	const result = publisher.preparePublisherEnvelope(Buffer.from(json), subject());
	expect(result.ok).toBe(true);
	if (result.ok) expect(publisher.verifyPublisherSignatures(result.value, { release: release(), policy: policy() }).ok).toBe(true);
});

test.each([
	'{"payload":"","payloadType":"future","signatures":[],"x":"\\ud800"}',
	'{"payload":"","payloadType":"future","signatures":[],"x":{"sig":"","\\u0073ig":""}}',
	"\uFEFF{}",
])("malformed JSON domain precedes unsupported literals: %j", (text) => {
	expect(publisher.preparePublisherEnvelope(Buffer.from(text), subject())).toMatchObject({
		ok: false,
		diagnostic: { code: "invalid-input", phase: "repository" },
	});
});
test("invalid UTF-8 in an ignored member still rejects the envelope", () => {
	expect(publisher.preparePublisherEnvelope(Buffer.concat([Buffer.from('{"x":"'), Buffer.from([0xff]), Buffer.from('"}')]), subject())).toMatchObject({
		ok: false,
		diagnostic: { code: "invalid-input" },
	});
});
test("unsupported type precedes remaining shape errors", () => {
	expect(publisher.preparePublisherEnvelope(bytes({ payloadType: "future", payload: false, signatures: [{}] }), subject())).toMatchObject({
		ok: false,
		diagnostic: {
			category: "unsupported-capability",
			code: "unsupported-payload-type",
			phase: "repository",
			witnesses: [{ pointer: "/payloadType", value: "future" }],
		},
	});
});
test("unsupported type precedes base64 shape errors after valid JSON decoding", () => {
	expect(publisher.preparePublisherEnvelope(bytes({ ...envelope(), payloadType: "future", payload: "AB==" }), subject())).toMatchObject({
		ok: false,
		diagnostic: { code: "unsupported-payload-type", phase: "repository" },
	});
});
test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 3])("invalid structurally constructed policy threshold %s is a programmer error", (threshold) => {
	expect(() => verify({ ...envelope(), signatures: [] }, policy([rule("example.com", undefined, threshold)]))).toThrow(TypeError);
});
test("noncanonical points cannot contribute an authorized key", () => {
	const noncanonical = Buffer.from(`ee${"ff".repeat(30)}7f`, "hex"); // y = p + 1, the identity only after noncanonical reduction.
	const identitySig = Buffer.from(`01${"00".repeat(63)}`, "hex");
	expect(ed25519.verify(identitySig, payload, noncanonical)).toBe(true);
	expect(ed25519.verify(identitySig, payload, noncanonical, { zip215: false })).toBe(false);
	expect(
		verify({ ...envelope(), signatures: [{ sig: identitySig.toString("base64") }] }, policy([rule("example.com", [noncanonical.toString("hex")])])),
	).toMatchObject({ ok: false, diagnostic: { code: "signature-invalid", witnesses: [{ verified: "0" }] } });
	const badR = Buffer.concat([noncanonical, Buffer.alloc(32)]);
	expect(verify({ ...envelope(), signatures: [{ sig: badR.toString("base64") }] })).toMatchObject({ ok: false, diagnostic: { code: "signature-invalid" } });
});
test.each(
	[
		null,
		[],
		{},
		{ payloadType: 4 },
		{ ...envelope(), payload: null },
		{ ...envelope(), signatures: null },
		{ ...envelope(), signatures: [null] },
		{ ...envelope(), signatures: [{}] },
		{ ...envelope(), signatures: [{ sig: "", keyid: null }] },
	].map((value) => [value] as const),
)("required member shape rejects %j", (value) => {
	expect(publisher.preparePublisherEnvelope(bytes(value), subject())).toMatchObject({ ok: false, diagnostic: { code: "invalid-input", phase: "repository" } });
});

test("signatures bound includes duplicates and precedes entry shape checks", () => {
	const value = envelope();
	expect(publisher.preparePublisherEnvelope(bytes({ ...value, signatures: Array(64).fill(value.signatures[0]) }), subject()).ok).toBe(true);
	expect(publisher.preparePublisherEnvelope(bytes({ ...value, signatures: Array(65).fill(null) }), subject())).toMatchObject({
		ok: false,
		diagnostic: { code: "resource-limit", phase: "repository", witnesses: [{ resource: "signatures", maximum: "64", observed: "65" }] },
	});
});
test("envelope bytes and ignored extension depth honor inclusive limits", () => {
	const value = envelope();
	const source = JSON.stringify(value);
	expect(publisher.preparePublisherEnvelope(Buffer.from(source.padEnd(1048576, " ")), subject()).ok).toBe(true);
	expect(publisher.preparePublisherEnvelope(Buffer.from(source.padEnd(1048577, " ")), subject())).toMatchObject({
		ok: false,
		diagnostic: { witnesses: [{ resource: "envelope-bytes", maximum: "1048576", observed: "1048577" }] },
	});
	for (const depth of [64, 65]) {
		const json = `${source.slice(0, -1)},"x":${"[".repeat(depth - 1)}0${"]".repeat(depth - 1)}}`;
		const result = publisher.preparePublisherEnvelope(Buffer.from(json), subject());
		expect(result.ok).toBe(depth === 64);
		if (depth === 65) expect(result).toMatchObject({ diagnostic: { witnesses: [{ resource: "json-depth", maximum: "64", observed: "65" }] } });
	}
});

test("signature evidence does not parse or authenticate the statement or its release identity", () => {
	for (const raw of [payload, Buffer.from('{"release":{"packagePath":"other.example/b","version":"2.0.0"}}')]) {
		const result = verify(signFixtureDsse(raw, [alice]));
		expect(result.ok).toBe(true);
		if (!result.ok) continue;
		expect(result.value.requestedRelease.packagePath.toWire()).toBe("example.com/finance/a");
		expect(result.value.payloadBytes()).toEqual(new Uint8Array(raw));
		expect(decodeReleaseStatement(result.value.payloadBytes(), subject()).ok).toBe(false);
	}
	expect(verify({ ...envelope(), signatures: [] })).toMatchObject({ ok: false, diagnostic: { code: "signature-invalid" } });
});

test("a correctly signed noncanonical statement remains publisher evidence until payload decoding", () => {
	const digest = `sha256:${"0".repeat(64)}`;
	const canonical = Buffer.from(
		`{"contentDigest":"${digest}","dependencies":[],"formatVersion":"0.1.0-draft.3","irPackageName":"example/b","kind":"LibraryReleaseStatement","manifestDigest":"${digest}","release":{"packagePath":"example.com/finance/b","version":"1.0.0"}}`,
	);
	expect(decodeReleaseStatement(canonical, subject()).ok).toBe(true);
	const noncanonical = Buffer.concat([canonical, Buffer.from("\n")]);
	const result = verify(signFixtureDsse(noncanonical, [alice]));
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.value.payloadBytes()).toEqual(new Uint8Array(noncanonical));
	expect(decodeReleaseStatement(result.value.payloadBytes(), subject())).toMatchObject({
		ok: false,
		diagnostic: { code: "invalid-input", witnesses: [{ rule: "noncanonical" }] },
	});
});

test("prepared envelopes are rechecked against each current policy", () => {
	const input = prepared();
	expect(publisher.verifyPublisherSignatures(input, { release: release(), policy: policy() }).ok).toBe(true);
	expect(publisher.verifyPublisherSignatures(input, { release: release(), policy: policy([rule("example.com", [outsider.publicKey])]) })).toMatchObject({
		ok: false,
		diagnostic: { code: "signature-invalid" },
	});
	expect(publisher.verifyPublisherSignatures(input, { release: release(), policy: policy([]) })).toMatchObject({
		ok: false,
		diagnostic: { code: "unauthorized-publisher" },
	});
});

test("prepared bytes and successful evidence are immutable snapshots with defensive copies", () => {
	const original = bytes(envelope());
	const input = Buffer.from(original);
	const source = subject();
	const prep = publisher.preparePublisherEnvelope(input, source);
	if (!prep.ok) throw new Error(JSON.stringify(prep));
	input.fill(0);
	source.registry = LocalId.parse("changed");
	const requested = release();
	const selected = rule("example.com");
	const rules = [selected];
	const result = publisher.verifyPublisherSignatures(prep.value, { release: requested, policy: policy(rules) });
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	requested.packagePath = PackagePath.parse("other.example/b");
	selected.publicKeys.length = 0;
	selected.threshold = 9;
	rules.length = 0;
	result.value.payloadBytes().fill(0);
	result.value.envelopeBytes().fill(0);
	expect(result.value.payloadBytes()).toEqual(new Uint8Array(payload));
	expect(result.value.envelopeBytes()).toEqual(new Uint8Array(original));
	expect(result.value.subject.registry.toWire()).toBe("example");
	expect(result.value.requestedRelease.packagePath.toWire()).toBe("example.com/finance/a");
	expect(result.value.publisherRule.threshold).toBe(1);
	expect(result.value.publisherRule.publicKeys).toHaveLength(2);
	expect(Object.isFrozen(result.value)).toBe(true);
	expect(Object.isFrozen(result.value.verifiedKeys)).toBe(true);
	expect(Object.isFrozen(result.value.publisherRule.publicKeys)).toBe(true);
	expect(Object.isFrozen(result.value.requestedRelease)).toBe(true);
});
