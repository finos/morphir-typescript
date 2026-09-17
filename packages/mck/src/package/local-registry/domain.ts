// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import type { LockedGraphWire, ReleaseId, ReleaseRecord } from "../resolution/model.ts";

class ValidatedText {
	protected constructor(private readonly text: string) {
		Object.freeze(this);
	}
	toWire(): string {
		return this.text;
	}
}
export class LocalId extends ValidatedText {
	declare private readonly localIdBrand: true;
	static parse(text: string): LocalId {
		if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(text)) throw new Error("invalid local ID");
		return new LocalId(text);
	}
}
export class RegistryPath extends ValidatedText {
	declare private readonly registryPathBrand: true;
	static parse(text: string): RegistryPath {
		if (registryPathFault(text)) throw new Error("invalid registry path");
		return new RegistryPath(text);
	}
}
export type RegistryPathFault =
	| { readonly kind: "resource"; readonly resource: "path-bytes" | "path-components" | "component-bytes"; readonly maximum: number }
	| { readonly kind: "path"; readonly rule: "grammar" | "reserved-name" };
export function registryPathFault(text: string): RegistryPathFault | undefined {
	if (Buffer.byteLength(text, "utf8") > 240) return { kind: "resource", resource: "path-bytes", maximum: 240 };
	const components = text.split("/");
	if (components.length > 32) return { kind: "resource", resource: "path-components", maximum: 32 };
	if (components.some((component) => Buffer.byteLength(component, "utf8") > 128)) return { kind: "resource", resource: "component-bytes", maximum: 128 };
	if (!/^[a-z0-9]+([.-][a-z0-9]+)*(\/[a-z0-9]+([.-][a-z0-9]+)*)*$/.test(text)) return { kind: "path", rule: "grammar" };
	if (components.some((component) => /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(component.split(".")[0] ?? "")))
		return { kind: "path", rule: "reserved-name" };
	return undefined;
}
export class Digest extends ValidatedText {
	declare private readonly digestBrand: true;
	static parse(text: string): Digest {
		if (!/^sha256:[0-9a-f]{64}$/.test(text)) throw new Error("invalid digest");
		return new Digest(text);
	}
}
export class Namespace extends ValidatedText {
	declare private readonly namespaceBrand: true;
	static parse(text: string): Namespace {
		if (!/^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+(\/[a-z0-9]+(-[a-z0-9]+)*)*$/.test(text)) throw new Error("invalid namespace");
		return new Namespace(text);
	}
}
export class PublisherKey extends ValidatedText {
	declare private readonly publisherKeyBrand: true;
	static parse(text: string): PublisherKey {
		if (!/^[0-9a-f]{64}$/.test(text)) throw new Error("invalid publisher key");
		return new PublisherKey(text);
	}
}
export interface ObjectReference {
	readonly path: RegistryPath;
	readonly digest: Digest;
}
export interface DirectorySource {
	readonly kind: "registry-directory";
	readonly path: RegistryPath;
}
export type EvidenceKind = "tuf-root" | "tuf-timestamp" | "tuf-snapshot" | "tuf-targets" | "release-statement";
export interface LibraryAcquisition {
	readonly release: ReleaseId;
	readonly registry: LocalId;
	readonly record: ObjectReference;
	readonly source: DirectorySource;
	readonly statement: LocalId;
}
export interface LibraryEvidence extends ObjectReference {
	readonly id: LocalId;
	readonly registry: LocalId;
	readonly kind: EvidenceKind;
}
/** Decoded structure only. Neither this value nor its graph establishes authentication. */
export interface LibraryLock {
	readonly graph: LockedGraphWire;
	readonly registries: readonly { readonly id: LocalId; readonly snapshot: LocalId }[];
	readonly acquisitions: readonly LibraryAcquisition[];
	readonly evidence: readonly LibraryEvidence[];
}
export interface RegistryRecord extends ReleaseRecord {
	readonly source: DirectorySource;
	readonly statement: ObjectReference;
}
export interface PublisherRule {
	readonly namespace: Namespace;
	readonly publicKeys: readonly PublisherKey[];
	readonly threshold: number;
}
export interface PolicyRepository {
	readonly identity: Digest;
	readonly bootstrapRoot: { readonly version: number; readonly digest: Digest };
	readonly namespaces: readonly Namespace[];
}
export interface TrustPolicy {
	readonly repositories: readonly PolicyRepository[];
	readonly publisherRules: readonly PublisherRule[];
	readonly continuedUse: "previous-authorization" | "fresh-metadata";
}
