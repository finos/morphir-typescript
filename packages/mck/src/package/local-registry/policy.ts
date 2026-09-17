// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import type { PackagePath } from "../resolution/model.ts";
import { decodeJsonDomain, topShape } from "./decode.ts";
import { type DecodeResult, invalid, resourceFailure, selectFailure } from "./diagnostics.ts";
import { Digest, Namespace, PublisherKey, type PublisherRule, type TrustPolicy } from "./domain.ts";
import { member, Shape, toPlain } from "./shape.ts";

const subject = { kind: "policy" } as const;
interface PolicyWire {
	readonly repositories: readonly {
		readonly identity: string;
		readonly bootstrapRoot: { readonly version: number; readonly digest: string };
		readonly namespaces: readonly string[];
	}[];
	readonly publisherRules: readonly { readonly namespace: string; readonly publicKeys: readonly string[]; readonly threshold: number }[];
	readonly continuedUse: "previous-authorization" | "fresh-metadata";
}
/** Policy originates in local configuration. Parsing it cannot provision trust from registry bytes. */
export function decodeTrustPolicy(bytes: Uint8Array): DecodeResult<TrustPolicy> {
	const parsed = decodeJsonDomain(bytes, { kind: "policy" }, subject);
	if (!parsed.ok) return parsed;
	const document = parsed.value.document;
	const rules = member(document, "publisherRules");
	if (Array.isArray(rules)) {
		if (rules.length > 1024) return resourceFailure(subject, "decode", "publisher-rules", 1024);
		for (const rule of rules) {
			const keys = member(rule, "publicKeys");
			if (Array.isArray(keys) && keys.length > 64) return resourceFailure(subject, "decode", "publisher-keys", 64);
		}
	}
	let grants = 0;
	const repositories = member(document, "repositories");
	if (Array.isArray(repositories))
		for (const repository of repositories) {
			const namespaces = member(repository, "namespaces");
			if (Array.isArray(namespaces)) grants += namespaces.length;
			if (grants > 1024) return resourceFailure(subject, "decode", "namespace-grants", 1024);
		}
	const shape = new Shape(subject);
	if (topShape(document, shape, "LibraryTrustPolicy", ["repositories", "publisherRules", "continuedUse"])) {
		shape.literal(member(document, "continuedUse"), "/continuedUse", ["previous-authorization", "fresh-metadata"]);
		shape.array(member(document, "repositories"), "/repositories").forEach((entry, index) => {
			const pointer = `/repositories/${index}`;
			const obj = shape.object(entry, pointer, ["identity", "bootstrapRoot", "namespaces"]);
			if (!obj) return;
			shape.string(member(obj, "identity"), `${pointer}/identity`, Digest.parse, "invalid-digest");
			const root = shape.object(member(obj, "bootstrapRoot"), `${pointer}/bootstrapRoot`, ["version", "digest"]);
			if (root) {
				shape.positive(member(root, "version"), `${pointer}/bootstrapRoot/version`);
				shape.string(member(root, "digest"), `${pointer}/bootstrapRoot/digest`, Digest.parse, "invalid-digest");
			}
			shape.array(member(obj, "namespaces"), `${pointer}/namespaces`, true).forEach((namespace, n) => {
				shape.string(namespace, `${pointer}/namespaces/${n}`, Namespace.parse, "invalid-name");
			});
		});
		shape.array(member(document, "publisherRules"), "/publisherRules").forEach((entry, index) => {
			const pointer = `/publisherRules/${index}`;
			const obj = shape.object(entry, pointer, ["namespace", "publicKeys", "threshold"]);
			if (!obj) return;
			shape.string(member(obj, "namespace"), `${pointer}/namespace`, Namespace.parse, "invalid-name");
			shape.positive(member(obj, "threshold"), `${pointer}/threshold`);
			shape.array(member(obj, "publicKeys"), `${pointer}/publicKeys`, true).forEach((key, n) => {
				shape.string(key, `${pointer}/publicKeys/${n}`, PublisherKey.parse);
			});
		});
	}
	const unsupported = selectFailure(shape.support);
	if (unsupported) return unsupported;
	if (shape.violations.length) return invalid(subject, "shape", shape.violations);
	const wire = toPlain(document) as PolicyWire;
	const unique = (keys: readonly string[], pointer: (index: number) => string) => {
		const seen = new Set<string>();
		keys.forEach((key, index) => {
			if (seen.has(key)) shape.add(pointer(index), "duplicate-identity");
			else seen.add(key);
		});
	};
	unique(
		wire.repositories.map((repository) => repository.identity),
		(index) => `/repositories/${index}/identity`,
	);
	unique(
		wire.publisherRules.map((rule) => rule.namespace),
		(index) => `/publisherRules/${index}/namespace`,
	);
	wire.repositories.forEach((repository, index) => {
		unique(repository.namespaces, (n) => `/repositories/${index}/namespaces/${n}`);
	});
	wire.publisherRules.forEach((rule, index) => {
		unique(rule.publicKeys, (n) => `/publisherRules/${index}/publicKeys/${n}`);
		if (rule.threshold > new Set(rule.publicKeys).size) shape.add(`/publisherRules/${index}/threshold`, "threshold-exceeds-keys");
	});
	if (shape.violations.length) return invalid(subject, "structure", shape.violations);
	return {
		ok: true,
		value: {
			repositories: wire.repositories.map((repository) => ({
				identity: Digest.parse(repository.identity),
				bootstrapRoot: { version: repository.bootstrapRoot.version, digest: Digest.parse(repository.bootstrapRoot.digest) },
				namespaces: repository.namespaces.map(Namespace.parse),
			})),
			publisherRules: wire.publisherRules.map((rule) => ({
				namespace: Namespace.parse(rule.namespace),
				publicKeys: rule.publicKeys.map(PublisherKey.parse),
				threshold: rule.threshold,
			})),
			continuedUse: wire.continuedUse,
		},
	};
}
function namespaceMatches(namespace: Namespace, path: PackagePath): boolean {
	const components = namespace.toWire().split("/");
	const target = path.toWire().split("/");
	return components.every((component, index) => component === target[index]);
}
export function repositoryPermits(policy: TrustPolicy, identity: Digest, path: PackagePath): boolean {
	return policy.repositories.some(
		(repository) => repository.identity.toWire() === identity.toWire() && repository.namespaces.some((namespace) => namespaceMatches(namespace, path)),
	);
}
export function matchingPublisherRule(policy: TrustPolicy, path: PackagePath): PublisherRule | undefined {
	return policy.publisherRules
		.filter((rule) => namespaceMatches(rule.namespace, path))
		.sort((a, b) => b.namespace.toWire().split("/").length - a.namespace.toWire().split("/").length)[0];
}
/** Keys must already represent independently verified signatures; this function performs no cryptography. */
export function publisherThresholdMet(rule: PublisherRule | undefined, verifiedKeys: readonly PublisherKey[]): boolean {
	if (!rule) return false;
	const authorized = new Set(rule.publicKeys.map((key) => key.toWire()));
	return new Set(verifiedKeys.map((key) => key.toWire()).filter((key) => authorized.has(key))).size >= rule.threshold;
}
