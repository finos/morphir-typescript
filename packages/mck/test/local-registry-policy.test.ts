// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { Digest, PublisherKey } from "../src/package/local-registry/domain.ts";
import { decodeTrustPolicy, matchingPublisherRule, publisherThresholdMet, repositoryPermits } from "../src/package/local-registry/policy.ts";
import { PackagePath } from "../src/package/resolution/model.ts";

const identity = `sha256:${"0".repeat(64)}`;
const key = "0".repeat(64);
const otherKey = "1".repeat(64);
function item<T>(values: readonly T[], index: number): T {
	const value = values[index];
	if (value === undefined) throw new Error("missing test fixture item");
	return value;
}
function policy() {
	return {
		formatVersion: "0.1.0-draft.3",
		kind: "LibraryTrustPolicy",
		repositories: [{ identity, bootstrapRoot: { version: 1, digest: identity }, namespaces: ["example.com/finance"] }],
		publisherRules: [
			{ namespace: "example.com", publicKeys: [key], threshold: 1 },
			{ namespace: "example.com/finance", publicKeys: [otherKey], threshold: 1 },
		],
		continuedUse: "previous-authorization",
	};
}
const parse = (value: unknown) => decodeTrustPolicy(Buffer.from(JSON.stringify(value)));
test.each(["example.com/finance", "example.com/finance/eligibility", "example.com/finance-other", "other.example.com/finance", "example.com.evil/finance"])(
	"namespace component boundary %s",
	(name) => {
		const decoded = parse(policy());
		expect(decoded.ok).toBe(true);
		if (!decoded.ok) return;
		expect(repositoryPermits(decoded.value, Digest.parse(identity), PackagePath.parse(name))).toBe(
			name === "example.com/finance" || name === "example.com/finance/eligibility",
		);
	},
);
test("longest publisher rule wins with no fallback or threshold pooling", () => {
	const decoded = parse(policy());
	if (!decoded.ok) throw new Error("valid policy rejected");
	const rule = matchingPublisherRule(decoded.value, PackagePath.parse("example.com/finance/eligibility"));
	expect(rule?.namespace.toWire()).toBe("example.com/finance");
	expect(publisherThresholdMet(rule, [PublisherKey.parse(key)])).toBe(false);
	expect(publisherThresholdMet(rule, [PublisherKey.parse(otherKey)])).toBe(true);
	expect(matchingPublisherRule(decoded.value, PackagePath.parse("other.example.com/finance"))).toBeUndefined();
});
test.each([0, -1, 2, 1.5, 9007199254740992])("invalid threshold %s", (threshold) => {
	const value = policy();
	item(value.publisherRules, 0).threshold = threshold;
	expect(parse(value)).toMatchObject({ ok: false, diagnostic: { phase: threshold === 2 ? "structure" : "shape" } });
});
test.each(["1e0", "1.0"])("policy rejects nondecimal integer token %s", (token) => {
	expect(decodeTrustPolicy(Buffer.from(JSON.stringify(policy()).replace('"threshold":1', `"threshold":${token}`)))).toMatchObject({
		ok: false,
		diagnostic: { phase: "shape" },
	});
});
test.each(["repository", "rule", "key", "namespace"])("policy duplicate %s rejected", (kind) => {
	const value = policy();
	if (kind === "repository") value.repositories.push(item(value.repositories, 0));
	if (kind === "rule") value.publisherRules.push(item(value.publisherRules, 0));
	if (kind === "key") item(value.publisherRules, 0).publicKeys.push(key);
	if (kind === "namespace") item(value.repositories, 0).namespaces.push("example.com/finance");
	expect(parse(value)).toMatchObject({ ok: false, diagnostic: { phase: "structure" } });
});
test("empty policy grants nothing and unknown fields fail closed", () => {
	expect(parse({ ...policy(), repositories: [], publisherRules: [] }).ok).toBe(true);
	expect(parse({ ...policy(), implicitTrust: "yes" })).toMatchObject({ ok: false, diagnostic: { phase: "shape" } });
	expect(parse({ ...policy(), continuedUse: "future", extra: "bad" })).toMatchObject({
		ok: false,
		diagnostic: { phase: "support", code: "unsupported-profile" },
	});
});

test.each(["publisher-rules", "namespace-grants", "publisher-keys"])("policy bounds %s before validation", (resource) => {
	const value = policy();
	if (resource === "publisher-rules") value.publisherRules = Array.from({ length: 1025 }, () => item(value.publisherRules, 0));
	if (resource === "namespace-grants") item(value.repositories, 0).namespaces = Array.from({ length: 1025 }, () => "example.com");
	if (resource === "publisher-keys") item(value.publisherRules, 0).publicKeys = Array.from({ length: 65 }, () => key);
	const result = parse(value);
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.diagnostic.code).toBe("resource-limit");
});
