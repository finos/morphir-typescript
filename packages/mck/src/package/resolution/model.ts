// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { PackageName } from "../../../../ir/src/model/index.ts";

const STABLE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const PACKAGE_PATH = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const IR_PATH = /^(?:[a-z0-9]+|[A-Z0-9]+)(?:-(?:[a-z0-9]+|[A-Z0-9]+))*(?:\/(?:[a-z0-9]+|[A-Z0-9]+)(?:-(?:[a-z0-9]+|[A-Z0-9]+))*)*$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

function compareCanonicalDecimal(left: string, right: string): -1 | 0 | 1 {
	if (left.length < right.length) return -1;
	if (left.length > right.length) return 1;
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

export class StableVersion {
	readonly #text: string;
	readonly #components: readonly [string, string, string];

	private constructor(text: string, components: readonly [string, string, string]) {
		this.#text = text;
		this.#components = components;
		Object.freeze(this);
	}

	static parse(text: string): StableVersion {
		const match = STABLE_VERSION.exec(text);
		if (match === null) throw new Error(`invalid stable version: ${text}`);
		return new StableVersion(text, [match[1] as string, match[2] as string, match[3] as string]);
	}

	compare(other: StableVersion): -1 | 0 | 1 {
		for (let index = 0; index < this.#components.length; index += 1) {
			const comparison = compareCanonicalDecimal(this.#components[index] as string, other.#components[index] as string);
			if (comparison !== 0) return comparison;
		}
		return 0;
	}

	toWire(): string {
		return this.#text;
	}
}

export class PackagePath {
	readonly #text: string;

	private constructor(text: string) {
		this.#text = text;
		Object.freeze(this);
	}

	static parse(text: string): PackagePath {
		if (!PACKAGE_PATH.test(text)) throw new Error(`invalid package path: ${text}`);
		return new PackagePath(text);
	}

	compare(other: PackagePath): -1 | 0 | 1 {
		return this.#text < other.#text ? -1 : this.#text > other.#text ? 1 : 0;
	}

	equals(other: PackagePath): boolean {
		return this.#text === other.#text;
	}

	toWire(): string {
		return this.#text;
	}
}

export class IRPackageName {
	readonly #value: PackageName;
	readonly #text: string;

	private constructor(value: PackageName, text: string) {
		this.#value = value;
		this.#text = text;
		Object.freeze(this);
	}

	static parse(text: string): IRPackageName {
		if (!IR_PATH.test(text)) throw new Error(`invalid IR package name: ${text}`);
		const parsed = PackageName.parse(text);
		if (!parsed.ok || PackageName.canonical(parsed.value) !== text) throw new Error(`invalid IR package name: ${text}`);
		return new IRPackageName(parsed.value, text);
	}

	compare(other: IRPackageName): -1 | 0 | 1 {
		return this.#text < other.#text ? -1 : this.#text > other.#text ? 1 : 0;
	}

	equals(other: IRPackageName): boolean {
		return PackageName.equals(this.#value, other.#value);
	}

	toWire(): string {
		return this.#text;
	}
}

export class ManifestDigest {
	readonly #text: string;

	private constructor(text: string) {
		this.#text = text;
		Object.freeze(this);
	}

	static parse(text: string): ManifestDigest {
		if (!SHA256_DIGEST.test(text)) throw new Error(`invalid manifest digest: ${text}`);
		return new ManifestDigest(text);
	}

	toWire(): string {
		return this.#text;
	}
}

export class ContentDigest {
	readonly #text: string;

	private constructor(text: string) {
		this.#text = text;
		Object.freeze(this);
	}

	static parse(text: string): ContentDigest {
		if (!SHA256_DIGEST.test(text)) throw new Error(`invalid content digest: ${text}`);
		return new ContentDigest(text);
	}

	toWire(): string {
		return this.#text;
	}
}

export interface ReleaseId {
	readonly packagePath: PackagePath;
	readonly version: StableVersion;
	readonly sourcePointer?: string;
}

export interface ReleaseIdWire {
	readonly packagePath: string;
	readonly version: string;
}

export interface VersionRangeWire {
	readonly minimumInclusive: string;
	readonly maximumExclusive: string;
}

export interface RequirementWire {
	readonly irPackageName: string;
	readonly packagePath: string;
	readonly versionRange: VersionRangeWire;
}

export interface ReleaseRecordWire {
	readonly release: ReleaseIdWire;
	readonly irPackageName: string;
	readonly manifestDigest: string;
	readonly contentDigest: string;
	readonly dependencies: readonly RequirementWire[];
}

export interface CatalogWire {
	readonly packagePath: string;
	readonly releases: readonly ReleaseRecordWire[];
}

export type UpdateTargetWire =
	| { readonly kind: "eligible"; readonly packagePath: string }
	| { readonly kind: "exact"; readonly packagePath: string; readonly version: string };

export interface BindingWire {
	readonly irPackageName: string;
	readonly target: ReleaseIdWire;
}

export interface LockedNodeWire {
	readonly release: ReleaseIdWire;
	readonly irPackageName: string;
	readonly manifestDigest: string;
	readonly contentDigest: string;
	readonly bindings: readonly BindingWire[];
}

export interface LockedGraphWire {
	readonly root: ReleaseIdWire;
	readonly nodes: readonly LockedNodeWire[];
}

interface ResolutionInputWireCommon {
	readonly formatVersion: "0.1.0-draft.2";
	readonly capability: "flat-library";
	readonly root: ReleaseRecordWire;
}

export type ResolutionInputWire =
	| (ResolutionInputWireCommon & { readonly mode: "initial"; readonly catalogs: readonly CatalogWire[] })
	| (ResolutionInputWireCommon & {
			readonly mode: "update";
			readonly catalogs: readonly CatalogWire[];
			readonly lock: LockedGraphWire;
			readonly targets: readonly UpdateTargetWire[];
	  })
	| (ResolutionInputWireCommon & { readonly mode: "replay"; readonly releases: readonly ReleaseRecordWire[]; readonly lock: LockedGraphWire });

export function releaseIdToWire(release: ReleaseId): ReleaseIdWire {
	return { packagePath: release.packagePath.toWire(), version: release.version.toWire() };
}

export function releaseIdsEqual(left: ReleaseId, right: ReleaseId): boolean {
	return left.packagePath.equals(right.packagePath) && left.version.compare(right.version) === 0;
}

export class VersionRange {
	readonly #minimumInclusive: StableVersion;
	readonly #maximumExclusive: StableVersion;

	private constructor(minimumInclusive: StableVersion, maximumExclusive: StableVersion) {
		this.#minimumInclusive = minimumInclusive;
		this.#maximumExclusive = maximumExclusive;
		Object.freeze(this);
	}

	static parse(minimumInclusive: string, maximumExclusive: string): VersionRange {
		return VersionRange.of(StableVersion.parse(minimumInclusive), StableVersion.parse(maximumExclusive));
	}

	static of(minimumInclusive: StableVersion, maximumExclusive: StableVersion): VersionRange {
		if (minimumInclusive.compare(maximumExclusive) >= 0) throw new Error("invalid empty stable-version interval");
		return new VersionRange(minimumInclusive, maximumExclusive);
	}

	get minimumInclusive(): StableVersion {
		return this.#minimumInclusive;
	}

	get maximumExclusive(): StableVersion {
		return this.#maximumExclusive;
	}

	toWire(): VersionRangeWire {
		return { minimumInclusive: this.#minimumInclusive.toWire(), maximumExclusive: this.#maximumExclusive.toWire() };
	}
}

export interface Requirement {
	readonly sourcePointer: string;
	readonly irPackageName: IRPackageName;
	readonly packagePath: PackagePath;
	readonly versionRange: VersionRange;
}

export interface ReleaseRecord {
	readonly sourcePointer: string;
	readonly release: ReleaseId;
	readonly irPackageName: IRPackageName;
	readonly manifestDigest: ManifestDigest;
	readonly contentDigest: ContentDigest;
	readonly dependencies: readonly Requirement[];
}

export interface Catalog {
	readonly sourcePointer: string;
	readonly packagePath: PackagePath;
	readonly releases: readonly ReleaseRecord[];
}

export type UpdateTarget =
	| { readonly kind: "eligible"; readonly sourcePointer: string; readonly packagePath: PackagePath }
	| { readonly kind: "exact"; readonly sourcePointer: string; readonly packagePath: PackagePath; readonly version: StableVersion };

export interface Binding {
	readonly sourcePointer: string;
	readonly irPackageName: IRPackageName;
	readonly target: ReleaseId;
}

export interface LockedNode {
	readonly sourcePointer: string;
	readonly release: ReleaseId;
	readonly irPackageName: IRPackageName;
	readonly manifestDigest: ManifestDigest;
	readonly contentDigest: ContentDigest;
	readonly bindings: readonly Binding[];
}

export interface LockedGraph {
	readonly sourcePointer: string;
	readonly root: ReleaseId;
	readonly nodes: readonly LockedNode[];
}

interface ResolutionInputCommon {
	readonly formatVersion: "0.1.0-draft.2";
	readonly capability: "flat-library";
	readonly root: ReleaseRecord;
}

export interface InitialResolutionInput extends ResolutionInputCommon {
	readonly mode: "initial";
	readonly catalogs: readonly Catalog[];
}

export interface UpdateResolutionInput extends ResolutionInputCommon {
	readonly mode: "update";
	readonly catalogs: readonly Catalog[];
	readonly lock: LockedGraph;
	readonly targets: readonly UpdateTarget[];
}

export interface ReplayResolutionInput extends ResolutionInputCommon {
	readonly mode: "replay";
	readonly releases: readonly ReleaseRecord[];
	readonly lock: LockedGraph;
}

/** Input validated through resolution-contract phases 1 through 5, not a fully valid lock. */
export type StructurallyValidatedResolutionInput = InitialResolutionInput | UpdateResolutionInput | ReplayResolutionInput;

export type ViolationRule =
	| "malformed-json"
	| "duplicate-key"
	| "unknown-field"
	| "missing-field"
	| "invalid-type"
	| "invalid-value"
	| "invalid-name"
	| "invalid-version"
	| "invalid-interval"
	| "invalid-digest"
	| "duplicate-identity"
	| "identity-mismatch"
	| "missing-root"
	| "dangling-binding"
	| "binding-mismatch"
	| "requirement-mismatch"
	| "digest-mismatch"
	| "unreachable-node"
	| "cycle"
	| "unsupported-flat-binding";

export interface Violation {
	readonly pointer: string;
	readonly rule: ViolationRule;
}

export type MissingResolutionItem = { readonly kind: "catalog"; readonly packagePath: PackagePath } | { readonly kind: "release"; readonly release: ReleaseId };

export type ChangedPin =
	| { readonly kind: "changed"; readonly previous: ReleaseId; readonly selected: ReleaseId }
	| { readonly kind: "removed"; readonly previous: ReleaseId };

export interface WitnessBinding {
	readonly irPackageName: IRPackageName;
	readonly targetOccurrence: readonly IRPackageName[];
}

export interface WitnessNode {
	readonly occurrence: readonly IRPackageName[];
	readonly release: ReleaseId;
	readonly bindings: readonly WitnessBinding[];
}

export interface ResolutionWitness {
	readonly nodes: readonly WitnessNode[];
}

export type ResolutionDiagnostic =
	| { readonly code: "invalid-input" | "invalid-lock"; readonly violations: readonly Violation[] }
	| { readonly code: "incomplete-input"; readonly missing: readonly MissingResolutionItem[] }
	| { readonly code: "update-scope-conflict"; readonly changedPins: readonly ChangedPin[]; readonly witness: ResolutionWitness }
	| {
			readonly code: "unsupported-capability";
			readonly requiredCapabilities: readonly ["graph-aware-coexistence"];
			readonly changedPins: readonly ChangedPin[];
			readonly witness: ResolutionWitness;
	  }
	| {
			readonly code: "unsatisfiable-requirements";
			readonly root: ReleaseRecord;
			readonly catalogs: readonly Catalog[];
			readonly targets: readonly UpdateTarget[];
	  };

export type MissingResolutionItemWire =
	| { readonly kind: "catalog"; readonly packagePath: string }
	| { readonly kind: "release"; readonly release: ReleaseIdWire };

export type ChangedPinWire =
	| { readonly kind: "changed"; readonly previous: ReleaseIdWire; readonly selected: ReleaseIdWire }
	| { readonly kind: "removed"; readonly previous: ReleaseIdWire };

export interface WitnessBindingWire {
	readonly irPackageName: string;
	readonly targetOccurrence: readonly string[];
}

export interface WitnessNodeWire {
	readonly occurrence: readonly string[];
	readonly release: ReleaseIdWire;
	readonly bindings: readonly WitnessBindingWire[];
}

export interface ResolutionWitnessWire {
	readonly nodes: readonly WitnessNodeWire[];
}

export type ResolutionDiagnosticWire =
	| { readonly code: "invalid-input" | "invalid-lock"; readonly violations: readonly Violation[] }
	| { readonly code: "incomplete-input"; readonly missing: readonly MissingResolutionItemWire[] }
	| { readonly code: "update-scope-conflict"; readonly changedPins: readonly ChangedPinWire[]; readonly witness: ResolutionWitnessWire }
	| {
			readonly code: "unsupported-capability";
			readonly requiredCapabilities: readonly ["graph-aware-coexistence"];
			readonly changedPins: readonly ChangedPinWire[];
			readonly witness: ResolutionWitnessWire;
	  }
	| {
			readonly code: "unsatisfiable-requirements";
			readonly root: ReleaseRecordWire;
			readonly catalogs: readonly CatalogWire[];
			readonly targets: readonly UpdateTargetWire[];
	  };

export type ResolutionResult = { readonly ok: true; readonly graph: LockedGraphWire } | { readonly ok: false; readonly diagnostic: ResolutionDiagnosticWire };

export type ResolutionParseResult =
	| { readonly ok: true; readonly value: StructurallyValidatedResolutionInput }
	| { readonly ok: false; readonly diagnostic: Extract<ResolutionDiagnostic, { readonly code: "invalid-input" | "invalid-lock" }> };
