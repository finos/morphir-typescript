// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { isNumber, isObject, type JsonValue, jsonObject, parseJsonWithDuplicateKeys } from "../../../../ir/src/codec/json/value.ts";
import {
	ContentDigest,
	IRPackageName,
	type LockedGraphWire,
	ManifestDigest,
	PackagePath,
	type ReleaseId,
	type ReleaseIdWire,
	type ReleaseRecord,
	type ReleaseRecordWire,
	StableVersion,
	VersionRange,
} from "../resolution/model.ts";
import { validateLockIdentities, validateLockShape } from "../resolution/validate.ts";
import {
	type DecodeFault,
	type DecodeResource,
	type DecodeResult,
	invalid,
	type Phase,
	resourceFailure,
	type Subject,
	selectFailure,
	subjectToWire,
} from "./diagnostics.ts";
import { Digest, type EvidenceKind, type LibraryLock, LocalId, RegistryPath, type RegistryRecord, registryPathFault } from "./domain.ts";
import { member, pointerChild, Shape, toPlain } from "./shape.ts";

export type JsonDomain =
	| { readonly kind: "morphir"; readonly document: "lock" | "record" | "statement" }
	| { readonly kind: "policy" }
	| { readonly kind: "tuf"; readonly role: "root" | "timestamp" | "snapshot" | "targets" }
	| { readonly kind: "dsse" };
export interface DecodedJson {
	readonly text: string;
	readonly document: JsonValue;
}
const resourceFor = (domain: JsonDomain): DecodeResource =>
	domain.kind === "morphir"
		? `${domain.document}-bytes`
		: domain.kind === "policy"
			? "policy-bytes"
			: domain.kind === "dsse"
				? "envelope-bytes"
				: `${domain.role}-bytes`;

// Count container edges and scalar leaves without recursive parsing or allocating a value tree.
function exceedsDepth(text: string): boolean {
	let containers = 0;
	let quoted = false;
	let escaped = false;
	for (const char of text) {
		if (quoted) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') quoted = false;
			continue;
		}
		if (char === "}" || char === "]") {
			containers--;
			continue;
		}
		if (" \t\r\n,:".includes(char)) continue;
		if (containers > 64) return true;
		if (char === '"') quoted = true;
		else if (char === "{" || char === "[") containers++;
	}
	return false;
}
/** Syntax boundary only: TUF and DSSE retain lossless ASTs, unknown members and number lexemes. */
export function decodeJsonDomain(
	bytes: Uint8Array,
	domain: JsonDomain,
	subject: Subject,
	phase: Phase = subject.kind === "object" ? "repository" : "decode",
): DecodeResult<DecodedJson> {
	const resource = resourceFor(domain);
	const maximum = resource === "lock-bytes" || resource === "targets-bytes" ? 16777216 : 1048576;
	if (bytes.byteLength > maximum) return resourceFailure(subject, phase, resource, maximum);
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		return invalid(subject, phase, [{ pointer: "", rule: "malformed-json" }]);
	}
	if (text.startsWith("\uFEFF")) return invalid(subject, phase, [{ pointer: "", rule: "malformed-json" }]);
	if (exceedsDepth(text)) return resourceFailure(subject, phase, "json-depth", 64);
	const parsed = parseJsonWithDuplicateKeys(text);
	if (!parsed.ok) return invalid(subject, phase, [{ pointer: "", rule: "malformed-json" }]);
	if (parsed.value.duplicateKeys.length)
		return invalid(
			subject,
			phase,
			parsed.value.duplicateKeys.map((pointer) => ({ pointer, rule: "duplicate-key" })),
		);
	if (domain.kind === "tuf") {
		const violations: { pointer: string; rule: "invalid-value" }[] = [];
		const visit = (value: JsonValue, pointer: string): void => {
			if (isNumber(value) && /[.eE]/.test(value.text)) violations.push({ pointer, rule: "invalid-value" });
			if (Array.isArray(value))
				value.forEach((child, index) => {
					visit(child, pointerChild(pointer, index));
				});
			if (isObject(value)) for (const [key, child] of value.members) visit(child, pointerChild(pointer, key));
		};
		visit(parsed.value.document, "");
		if (violations.length) return invalid(subject, phase, violations);
	}
	return { ok: true, value: { text, document: parsed.value.document } };
}

const lockSubject = { kind: "lock" } as const;
const format = "0.1.0-draft.3";
const evidenceKinds: readonly EvidenceKind[] = ["tuf-root", "tuf-timestamp", "tuf-snapshot", "tuf-targets", "release-statement"];
function releaseShape(value: JsonValue | undefined, shape: Shape, pointer: string): void {
	const obj = shape.object(value, pointer, ["packagePath", "version"]);
	if (!obj) return;
	shape.string(member(obj, "packagePath"), `${pointer}/packagePath`, PackagePath.parse, "invalid-name");
	shape.string(member(obj, "version"), `${pointer}/version`, StableVersion.parse, "invalid-version");
}
function pathShape(value: JsonValue | undefined, shape: Shape, pointer: string, prefix: string, registry?: JsonValue): void {
	const text = shape.string(value, pointer);
	if (text === undefined) return;
	const fault = registryPathFault(text);
	let pathSubject = subjectToWire(shape.subject);
	if (shape.subject.kind === "object") pathSubject = { kind: "object", registry: shape.subject.registry.toWire(), path: text };
	if (typeof registry === "string") {
		try {
			pathSubject = { kind: "object", registry: LocalId.parse(registry).toWire(), path: text };
		} catch {
			/* Invalid alias is diagnosed at its own field. */
		}
	}
	if (fault?.kind === "resource") {
		const diagnostic = resourceFailure(shape.subject, "shape", fault.resource, fault.maximum).diagnostic;
		shape.support.push({ ...diagnostic, witnesses: diagnostic.witnesses.map((witness) => ({ ...witness, subject: pathSubject })) });
	} else if (fault?.kind === "path")
		shape.support.push({ code: "unsafe-path", phase: "shape", witnesses: [{ kind: "path", subject: pathSubject, rule: fault.rule }] });
	else if (!text.startsWith(prefix)) shape.add(pointer, "invalid-value");
}
function referenceShape(value: JsonValue | undefined, shape: Shape, pointer: string, prefix: string, registry?: JsonValue): void {
	const obj = shape.object(value, pointer, ["path", "digest"]);
	if (!obj) return;
	pathShape(member(obj, "path"), shape, `${pointer}/path`, prefix, registry);
	shape.string(member(obj, "digest"), `${pointer}/digest`, Digest.parse, "invalid-digest");
}
function sourceShape(value: JsonValue | undefined, shape: Shape, pointer: string, registry?: JsonValue): void {
	const known = member(value, "kind") === "registry-directory";
	const obj = shape.object(value, pointer, known ? ["kind", "path"] : ["kind"], ["kind", "path"]);
	if (!obj) return;
	if (shape.literal(member(obj, "kind"), `${pointer}/kind`, ["registry-directory"], "unsupported-source"))
		pathShape(member(obj, "path"), shape, `${pointer}/path`, "bundles/", registry);
}
function topShape(document: JsonValue, shape: Shape, kind: string, names: readonly string[]): boolean {
	const supported = member(document, "kind") === kind && member(document, "formatVersion") === format;
	const obj = shape.object(document, "", supported ? ["formatVersion", "kind", ...names] : ["formatVersion", "kind"], ["formatVersion", "kind", ...names]);
	if (!obj) return false;
	shape.literal(member(obj, "formatVersion"), "/formatVersion", [format]);
	shape.literal(member(obj, "kind"), "/kind", [kind]);
	return supported;
}

export { topShape };
export function decodeLibraryLock(bytes: Uint8Array): DecodeResult<LibraryLock> {
	const parsed = decodeJsonDomain(bytes, { kind: "morphir", document: "lock" }, lockSubject);
	if (!parsed.ok) return parsed;
	const document = parsed.value.document;
	const nodes = member(member(document, "graph"), "nodes");
	if (Array.isArray(nodes) && nodes.length > 512) return resourceFailure(lockSubject, "decode", "graph-nodes", 512);
	let graphBindings = 0;
	if (Array.isArray(nodes))
		for (const node of nodes) {
			const bindings = member(node, "bindings");
			if (Array.isArray(bindings)) {
				if (bindings.length > 512) return resourceFailure(lockSubject, "decode", "node-bindings", 512);
				graphBindings += bindings.length;
				if (graphBindings > 32768) return resourceFailure(lockSubject, "decode", "graph-bindings", 32768);
			}
		}
	const evidenceEntries = member(document, "evidence");
	if (Array.isArray(evidenceEntries) && evidenceEntries.length > 2048) return resourceFailure(lockSubject, "decode", "evidence-entries", 2048);
	const shape = new Shape(lockSubject);
	if (topShape(document, shape, "LibraryLock", ["resolution", "graph", "registries", "acquisitions", "evidence"])) {
		const resolution = shape.object(member(document, "resolution"), "/resolution", ["policy", "profile", "requiredCapabilities"]);
		if (resolution) {
			shape.literal(member(resolution, "policy"), "/resolution/policy", ["flat-library:0.1.0-draft.2"]);
			shape.literal(member(resolution, "profile"), "/resolution/profile", ["local-library"]);
			const capabilities = shape.array(member(resolution, "requiredCapabilities"), "/resolution/requiredCapabilities");
			const required = ["dsse-ed25519", "local-directory", "tuf-1.0.36"];
			const seenCapabilities = new Set<JsonValue>();
			capabilities.forEach((capability, index) => {
				shape.literal(capability, `/resolution/requiredCapabilities/${index}`, required, "unsupported-capability");
				if (seenCapabilities.has(capability)) shape.add(`/resolution/requiredCapabilities/${index}`, "duplicate-identity");
				else seenCapabilities.add(capability);
			});
			if (required.some((capability) => !seenCapabilities.has(capability))) shape.add("/resolution/requiredCapabilities", "invalid-value");
		}
		const graph = member(document, "graph");
		if (graph !== undefined)
			shape.violations.push(
				...validateLockShape(jsonObject([["lock", graph]])).violations.map((v) => ({ ...v, pointer: v.pointer.replace(/^\/lock/, "/graph") })),
			);
		shape.array(member(document, "registries"), "/registries", true).forEach((entry, index) => {
			const pointer = `/registries/${index}`;
			const obj = shape.object(entry, pointer, ["id", "snapshot"]);
			if (obj) for (const name of ["id", "snapshot"]) shape.string(member(obj, name), `${pointer}/${name}`, LocalId.parse, "invalid-name");
		});
		shape.array(member(document, "acquisitions"), "/acquisitions", true).forEach((entry, index) => {
			const pointer = `/acquisitions/${index}`;
			const obj = shape.object(entry, pointer, ["release", "registry", "record", "source", "statement"]);
			if (!obj) return;
			releaseShape(member(obj, "release"), shape, `${pointer}/release`);
			for (const name of ["registry", "statement"]) shape.string(member(obj, name), `${pointer}/${name}`, LocalId.parse, "invalid-name");
			referenceShape(member(obj, "record"), shape, `${pointer}/record`, "records/", member(obj, "registry"));
			sourceShape(member(obj, "source"), shape, `${pointer}/source`, member(obj, "registry"));
		});
		shape.array(member(document, "evidence"), "/evidence", true).forEach((entry, index) => {
			const pointer = `/evidence/${index}`;
			const obj = shape.object(entry, pointer, ["id", "registry", "kind", "path", "digest"]);
			if (!obj) return;
			for (const name of ["id", "registry"]) shape.string(member(obj, name), `${pointer}/${name}`, LocalId.parse, "invalid-name");
			const recognized = shape.literal(member(obj, "kind"), `${pointer}/kind`, evidenceKinds);
			shape.string(member(obj, "digest"), `${pointer}/digest`, Digest.parse, "invalid-digest");
			if (recognized) {
				const kind = member(obj, "kind") as EvidenceKind;
				pathShape(member(obj, "path"), shape, `${pointer}/path`, kind === "release-statement" ? "statements/" : "metadata/", member(obj, "registry"));
				if (kind !== "release-statement")
					shape.string(member(obj, "path"), `${pointer}/path`, (text) => {
						if (!new RegExp(`^metadata/[1-9][0-9]*\\.${kind.slice(4)}\\.json$`).test(text)) throw new Error("invalid historical metadata name");
					});
			}
		});
	}
	const unsupported = selectFailure(orderLockFaults(shape.support, document));
	if (unsupported) return unsupported;
	if (shape.violations.length) return invalid(lockSubject, "shape", shape.violations);
	const wire = toPlain(document) as LockWire;
	const graphValue = member(document, "graph");
	if (graphValue !== undefined && isObject(graphValue))
		shape.violations.push(...validateLockIdentities(graphValue).map((v) => ({ ...v, pointer: v.pointer.replace(/^\/lock/, "/graph") })));
	if (!shape.violations.length) topology(wire.graph, shape);
	lockClosure(wire, shape);
	if (shape.violations.length) return invalid(lockSubject, "structure", shape.violations);
	return {
		ok: true,
		value: {
			graph: wire.graph,
			registries: wire.registries.map((registry) => ({ id: LocalId.parse(registry.id), snapshot: LocalId.parse(registry.snapshot) })),
			acquisitions: wire.acquisitions.map((acquisition) => ({
				release: parseRelease(acquisition.release),
				registry: LocalId.parse(acquisition.registry),
				record: parseReference(acquisition.record),
				source: { kind: "registry-directory", path: RegistryPath.parse(acquisition.source.path) },
				statement: LocalId.parse(acquisition.statement),
			})),
			evidence: wire.evidence.map((evidence) => ({
				...parseReference(evidence),
				id: LocalId.parse(evidence.id),
				registry: LocalId.parse(evidence.registry),
				kind: evidence.kind,
			})),
		},
	};
}
function orderLockFaults(faults: readonly DecodeFault[], document: JsonValue): readonly DecodeFault[] {
	if (faults.length < 2) return faults;
	const text = (value: JsonValue | undefined) => (typeof value === "string" ? value : "");
	const identity = (value: JsonValue | undefined) => JSON.stringify([text(member(value, "packagePath")), text(member(value, "version"))]);
	const root = identity(member(member(document, "graph"), "root"));
	const acquisitions = member(document, "acquisitions");
	const entries = Array.isArray(acquisitions) ? [...acquisitions] : [];
	entries.sort((left, right) => {
		const a = member(left, "release");
		const b = member(right, "release");
		if (identity(a) === root && identity(b) !== root) return -1;
		if (identity(b) === root && identity(a) !== root) return 1;
		const path = Buffer.compare(Buffer.from(text(member(a, "packagePath"))), Buffer.from(text(member(b, "packagePath"))));
		if (path) return path;
		try {
			return -StableVersion.parse(text(member(a, "version"))).compare(StableVersion.parse(text(member(b, "version"))));
		} catch {
			return 0;
		}
	});
	const evidence = member(document, "evidence");
	const objectOrder = new Map<string, Map<string, readonly string[]>>();
	const firstOrder = (registry: string, path: string, order: readonly string[]): void => {
		let paths = objectOrder.get(registry);
		if (!paths) {
			paths = new Map();
			objectOrder.set(registry, paths);
		}
		if (!paths.has(path)) paths.set(path, order);
	};
	if (Array.isArray(evidence))
		for (const entry of evidence) {
			const registry = member(entry, "registry");
			const path = member(entry, "path");
			if (typeof registry === "string" && typeof path === "string") firstOrder(registry, path, [registry, "0", path]);
		}
	entries.forEach((entry, index) => {
		const registry = member(entry, "registry");
		if (typeof registry !== "string") return;
		for (const name of ["record", "source"]) {
			const path = member(member(entry, name), "path");
			if (typeof path === "string") firstOrder(registry, path, [registry, "1", String(index).padStart(8, "0"), path]);
		}
	});
	const key = (fault: DecodeFault): readonly string[] => {
		const subject = fault.witnesses[0]?.subject;
		if (subject?.kind !== "object") return [""];
		return objectOrder.get(subject.registry)?.get(subject.path) ?? [subject.registry, "1", "000000-1", subject.path];
	};
	return faults
		.map((fault) => ({ fault, order: key(fault) }))
		.sort((left, right) => {
			const a = left.order;
			const b = right.order;
			for (let index = 0; index < Math.max(a.length, b.length); index++) {
				const compared = Buffer.compare(Buffer.from(a[index] ?? ""), Buffer.from(b[index] ?? ""));
				if (compared) return compared;
			}
			return 0;
		})
		.map(({ fault }) => fault);
}
interface ReferenceWire {
	readonly path: string;
	readonly digest: string;
}
interface LockWire {
	readonly graph: LockedGraphWire;
	readonly registries: readonly { readonly id: string; readonly snapshot: string }[];
	readonly acquisitions: readonly {
		readonly release: ReleaseIdWire;
		readonly registry: string;
		readonly record: ReferenceWire;
		readonly source: { readonly kind: "registry-directory"; readonly path: string };
		readonly statement: string;
	}[];
	readonly evidence: readonly (ReferenceWire & { readonly id: string; readonly registry: string; readonly kind: EvidenceKind })[];
}
const releaseKey = (release: ReleaseIdWire) => `${release.packagePath}@${release.version}`;
function topology(graph: LockedGraphWire, shape: Shape): void {
	const nodes = new Map(graph.nodes.map((node, index) => [releaseKey(node.release), index]));
	const root = nodes.get(releaseKey(graph.root));
	if (root === undefined) shape.add("/graph/root", "missing-root");
	const edges = graph.nodes.map((node) => node.bindings.map((binding) => nodes.get(releaseKey(binding.target))));
	const reachable = new Set<number>();
	const pending = root === undefined ? [] : [root];
	while (pending.length) {
		const index = pending.pop() as number;
		if (reachable.has(index)) continue;
		reachable.add(index);
		for (const target of edges[index] ?? []) if (target !== undefined) pending.push(target);
	}
	// Tarjan's single traversal finds all strongly connected components in O(nodes + bindings).
	// Recursion is bounded by the already-enforced 512-node profile limit.
	const discovery = new Map<number, number>();
	const low = new Map<number, number>();
	const components = new Map<number, number>();
	const stack: number[] = [];
	const active = new Set<number>();
	const visit = (index: number): void => {
		const ordinal = discovery.size;
		discovery.set(index, ordinal);
		low.set(index, ordinal);
		stack.push(index);
		active.add(index);
		for (const target of edges[index] ?? []) {
			if (target === undefined) continue;
			if (!discovery.has(target)) {
				visit(target);
				low.set(index, Math.min(low.get(index) as number, low.get(target) as number));
			} else if (active.has(target)) low.set(index, Math.min(low.get(index) as number, discovery.get(target) as number));
		}
		if (low.get(index) === ordinal) {
			let member: number;
			do {
				member = stack.pop() as number;
				active.delete(member);
				components.set(member, index);
			} while (member !== index);
		}
	};
	for (let index = 0; index < graph.nodes.length; index++) if (!discovery.has(index)) visit(index);
	graph.nodes.forEach((node, index) => {
		if (root !== undefined && !reachable.has(index)) shape.add(`/graph/nodes/${index}/release`, "unreachable-node");
		node.bindings.forEach((_binding, bindingIndex) => {
			const pointer = `/graph/nodes/${index}/bindings/${bindingIndex}`;
			const target = edges[index]?.[bindingIndex];
			if (target === undefined) shape.add(`${pointer}/target`, "dangling-binding");
			else if (components.get(index) === components.get(target)) shape.add(`${pointer}/target`, "cycle");
		});
	});
}
function lockClosure(wire: LockWire, shape: Shape): void {
	const unique = <T>(values: readonly T[], key: (value: T) => string, pointer: (index: number) => string): void => {
		const seen = new Set<string>();
		values.forEach((value, index) => {
			const identity = key(value);
			if (seen.has(identity)) shape.add(pointer(index), "duplicate-identity");
			else seen.add(identity);
		});
	};
	unique(
		wire.registries,
		(r) => r.id,
		(i) => `/registries/${i}/id`,
	);
	unique(
		wire.acquisitions,
		(a) => releaseKey(a.release),
		(i) => `/acquisitions/${i}/release`,
	);
	const seenAcquisitions = new Set<string>();
	const firstAcquisitions: { readonly entry: LockWire["acquisitions"][number]; readonly index: number }[] = [];
	wire.acquisitions.forEach((entry, index) => {
		const key = releaseKey(entry.release);
		if (!seenAcquisitions.has(key)) {
			seenAcquisitions.add(key);
			firstAcquisitions.push({ entry, index });
		}
	});
	unique(
		firstAcquisitions,
		({ entry }) => `${entry.registry}:${entry.record.path}`,
		(i) => `/acquisitions/${firstAcquisitions[i]?.index}/record/path`,
	);
	unique(
		wire.evidence,
		(e) => e.id,
		(i) => `/evidence/${i}/id`,
	);
	unique(
		wire.evidence,
		(e) => `${e.registry}:${e.path}`,
		(i) => `/evidence/${i}/path`,
	);
	const registries = new Set(wire.registries.map((r) => r.id));
	const evidence = new Map(wire.evidence.map((e) => [e.id, e]));
	const evidenceCounts = new Map<string, number>();
	const evidenceByRole = new Map<string, Map<EvidenceKind, { readonly entry: LockWire["evidence"][number]; readonly index: number }[]>>();
	wire.evidence.forEach((entry, index) => {
		evidenceCounts.set(entry.id, (evidenceCounts.get(entry.id) ?? 0) + 1);
		let roles = evidenceByRole.get(entry.registry);
		if (!roles) {
			roles = new Map();
			evidenceByRole.set(entry.registry, roles);
		}
		const entries = roles.get(entry.kind);
		if (entries) entries.push({ entry, index });
		else roles.set(entry.kind, [{ entry, index }]);
	});
	const acquiredRegistries = new Set(wire.acquisitions.map((entry) => entry.registry));
	const referencedStatements = new Set(wire.acquisitions.map((entry) => entry.statement));
	const acquisitions = new Set(wire.acquisitions.map((a) => releaseKey(a.release)));
	const nodes = new Set(wire.graph.nodes.map((n) => releaseKey(n.release)));
	const completeAcquisitions = [...nodes].every((key) => acquisitions.has(key)) && [...acquisitions].every((key) => nodes.has(key));
	const completeStatements = firstAcquisitions.every(({ entry: a }) => {
		const entry = evidence.get(a.statement);
		return entry?.kind === "release-statement" && entry.registry === a.registry;
	});
	wire.graph.nodes.forEach((node, index) => {
		if (!acquisitions.has(releaseKey(node.release))) shape.add(`/graph/nodes/${index}/release`, "missing-reference");
	});
	const reference = (id: string, registry: string, kind: EvidenceKind, pointer: string): void => {
		if ((evidenceCounts.get(id) ?? 0) > 1) return; // Only this ID is ambiguous.
		const entry = evidence.get(id);
		if (!entry) shape.add(pointer, "missing-reference");
		else if (entry.kind !== kind) shape.add(pointer, "evidence-kind-mismatch");
		else if (entry.registry !== registry) shape.add(pointer, "identity-mismatch");
	};
	firstAcquisitions.forEach(({ entry: a, index }) => {
		if (!nodes.has(releaseKey(a.release))) shape.add(`/acquisitions/${index}/release`, "orphan-reference");
		if (!registries.has(a.registry)) shape.add(`/acquisitions/${index}/registry`, "missing-reference");
		reference(a.statement, a.registry, "release-statement", `/acquisitions/${index}/statement`);
	});
	wire.registries.forEach((r, index) => {
		if (!acquiredRegistries.has(r.id)) shape.add(`/registries/${index}/id`, "orphan-reference");
		reference(r.snapshot, r.id, "tuf-snapshot", `/registries/${index}/snapshot`);
		for (const kind of ["tuf-root", "tuf-timestamp", "tuf-snapshot", "tuf-targets"] as const) {
			const matches = evidenceByRole.get(r.id)?.get(kind) ?? [];
			if (!matches.length) shape.add(`/registries/${index}`, "missing-reference");
			if (kind !== "tuf-root") for (const extra of matches.slice(1)) shape.add(`/evidence/${extra.index}`, "orphan-reference");
		}
	});
	wire.evidence.forEach((e, index) => {
		if (!registries.has(e.registry)) shape.add(`/evidence/${index}/registry`, "missing-reference");
		if (completeAcquisitions && completeStatements && e.kind === "release-statement" && !referencedStatements.has(e.id))
			shape.add(`/evidence/${index}/id`, "orphan-reference");
	});
	// Signed root-chain membership and authenticated timestamp/snapshot/targets links require repository verification.
}
function parseRelease(wire: ReleaseIdWire): ReleaseId {
	return { packagePath: PackagePath.parse(wire.packagePath), version: StableVersion.parse(wire.version) };
}
function parseReference(wire: ReferenceWire) {
	return { path: RegistryPath.parse(wire.path), digest: Digest.parse(wire.digest) };
}
function recordShape(document: JsonValue, shape: Shape, record: boolean): void {
	if (
		!topShape(document, shape, record ? "LibraryRegistryRecord" : "LibraryReleaseStatement", [
			"release",
			"irPackageName",
			"dependencies",
			"manifestDigest",
			"contentDigest",
			...(record ? ["source", "statement"] : []),
		])
	)
		return;
	releaseShape(member(document, "release"), shape, "/release");
	shape.string(member(document, "irPackageName"), "/irPackageName", IRPackageName.parse, "invalid-name");
	for (const name of ["manifestDigest", "contentDigest"]) shape.string(member(document, name), `/${name}`, Digest.parse, "invalid-digest");
	shape.array(member(document, "dependencies"), "/dependencies").forEach((dependency, index) => {
		const pointer = `/dependencies/${index}`;
		const obj = shape.object(dependency, pointer, ["irPackageName", "packagePath", "versionRange"]);
		if (!obj) return;
		shape.string(member(obj, "irPackageName"), `${pointer}/irPackageName`, IRPackageName.parse, "invalid-name");
		shape.string(member(obj, "packagePath"), `${pointer}/packagePath`, PackagePath.parse, "invalid-name");
		const range = shape.object(member(obj, "versionRange"), `${pointer}/versionRange`, ["minimumInclusive", "maximumExclusive"]);
		if (range)
			for (const name of ["minimumInclusive", "maximumExclusive"])
				shape.string(member(range, name), `${pointer}/versionRange/${name}`, StableVersion.parse, "invalid-version");
	});
	if (record) {
		sourceShape(member(document, "source"), shape, "/source");
		referenceShape(member(document, "statement"), shape, "/statement", "statements/");
	}
}
function canonicalMetadata(value: JsonValue): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalMetadata).join(",")}]`;
	if (isObject(value))
		return `{${[...value.members]
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, child]) => `${JSON.stringify(key)}:${canonicalMetadata(child)}`)
			.join(",")}}`;
	throw new Error("metadata domain validation prerequisite");
}
function decodeRecord(bytes: Uint8Array, subject: Subject, record: boolean): DecodeResult<RegistryRecord | ReleaseRecord> {
	const phase = "repository";
	const parsed = decodeJsonDomain(bytes, { kind: "morphir", document: record ? "record" : "statement" }, subject, phase);
	if (!parsed.ok) return parsed;
	const { document, text } = parsed.value;
	const dependencies = member(document, "dependencies");
	if (Array.isArray(dependencies) && dependencies.length > 512) return resourceFailure(subject, phase, "node-bindings", 512);
	const shape = new Shape(subject);
	recordShape(document, shape, record);
	const unsupported = selectFailure(shape.support.map((fault) => ({ ...fault, phase })));
	if (unsupported) return unsupported;
	if (shape.violations.length) return invalid(subject, phase, shape.violations);
	const wire = toPlain(document) as ReleaseRecordWire & {
		readonly source: { readonly kind: "registry-directory"; readonly path: string };
		readonly statement: ReferenceWire;
	};
	const sorted = wire.dependencies.every((dependency, index) => index === 0 || (wire.dependencies[index - 1]?.irPackageName ?? "") <= dependency.irPackageName);
	if (!sorted || text !== canonicalMetadata(document) + (record ? "\n" : "")) return invalid(subject, phase, [{ pointer: "", rule: "noncanonical" }]);
	const names = new Set<string>();
	wire.dependencies.forEach((dependency, index) => {
		if (names.has(dependency.irPackageName)) shape.add(`/dependencies/${index}/irPackageName`, "duplicate-identity");
		names.add(dependency.irPackageName);
		if (StableVersion.parse(dependency.versionRange.minimumInclusive).compare(StableVersion.parse(dependency.versionRange.maximumExclusive)) >= 0)
			shape.add(`/dependencies/${index}/versionRange`, "invalid-interval");
	});
	if (shape.violations.length) return invalid(subject, phase, shape.violations);
	const value: ReleaseRecord = {
		sourcePointer: "",
		release: parseRelease(wire.release),
		irPackageName: IRPackageName.parse(wire.irPackageName),
		manifestDigest: ManifestDigest.parse(wire.manifestDigest),
		contentDigest: ContentDigest.parse(wire.contentDigest),
		dependencies: wire.dependencies.map((dependency, index) => ({
			sourcePointer: `/dependencies/${index}`,
			irPackageName: IRPackageName.parse(dependency.irPackageName),
			packagePath: PackagePath.parse(dependency.packagePath),
			versionRange: VersionRange.parse(dependency.versionRange.minimumInclusive, dependency.versionRange.maximumExclusive),
		})),
	};
	return {
		ok: true,
		value: record
			? { ...value, source: { kind: "registry-directory", path: RegistryPath.parse(wire.source.path) }, statement: parseReference(wire.statement) }
			: value,
	};
}
export function decodeRegistryRecord(bytes: Uint8Array, subject: Subject): DecodeResult<RegistryRecord> {
	return decodeRecord(bytes, subject, true) as DecodeResult<RegistryRecord>;
}
export function decodeReleaseStatement(bytes: Uint8Array, subject: Subject): DecodeResult<ReleaseRecord> {
	return decodeRecord(bytes, subject, false);
}
