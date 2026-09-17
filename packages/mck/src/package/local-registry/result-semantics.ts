// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { isDeepStrictEqual } from "node:util";
import { array, object, string } from "../json.ts";
import { parseResolutionResponse, projectResolutionResult } from "../resolution/protocol.ts";
import { equal, records, sorted } from "./validation.ts";

export const maxima: Readonly<Record<string, bigint>> = Object.fromEntries([
	...["manifest-bytes", "record-bytes", "statement-bytes", "envelope-bytes", "policy-bytes", "root-bytes", "timestamp-bytes", "snapshot-bytes"].map((name) => [
		name,
		1048576n,
	]),
	...["lock-bytes", "targets-bytes"].map((name) => [name, 16777216n]),
	...["metadata-bytes", "file-bytes"].map((name) => [name, 268435456n]),
	...["publisher-keys", "role-keys", "signatures", "json-depth"].map((name) => [name, 64n]),
	...["registries", "root-rotations", "path-components"].map((name) => [name, 32n]),
	["bundle-bytes", 1073741824n],
	["operation-content-bytes", 8589934592n],
	["declared-files", 4096n],
	["bundle-entries", 65536n],
	["operation-entries", 1048576n],
	["graph-nodes", 512n],
	["node-bindings", 512n],
	["graph-bindings", 32768n],
	["catalog-releases", 4096n],
	["evidence-entries", 2048n],
	["target-entries", 8192n],
	["publisher-rules", 1024n],
	["namespace-grants", 1024n],
	["tuf-keys", 256n],
	["path-bytes", 240n],
	["component-bytes", 128n],
]);
const authorityRules: Readonly<Record<string, string>> = {
	"unauthorized-repository": "namespace-denied",
	"unauthorized-publisher": "publisher-rule-missing",
	"previous-authorization-ineligible": "previous-grant-ineligible",
	"release-revoked": "revoked",
	"freshness-required": "fresh-view-required",
};
export function validateResult(value: unknown, operation?: Record<string, unknown>, parse = false): void {
	const entry = object(value);
	if (entry.ok === true) {
		if (parse) throw new Error("parse cases require rejection");
		if (operation) {
			const expectedKind =
				operation.name === "publish-library" ? "publication" : operation.name === "refresh-library-registry" ? "registry-refreshed" : "graph-ready";
			equal(entry.kind, expectedKind, "operation/result kind");
			if (entry.kind === "registry-refreshed") equal(entry.registry, object(operation.input).registry, "refreshed registry");
		}
		if (entry.kind === "graph-ready") {
			const parsed = parseResolutionResponse({ ok: true, graph: entry.graph }, "resolve-library");
			equal(parsed, projectResolutionResult(parsed), "graph presentation");
			const graph = object(entry.graph);
			equal(
				entry.verified,
				records(graph.nodes).map((node) => node.release),
				"graph/verified output",
			);
			if (operation && ["resolve-library", "update-library"].includes(string(operation.name)))
				equal(graph.root, object(operation.input).root, "requested graph root");
		}
		return;
	}
	const diagnostic = object(entry.diagnostic);
	const code = string(diagnostic.code);
	const witnesses = records(diagnostic.witnesses);
	if (["io-failure", "resource-limit", "unsafe-path"].includes(code) && witnesses.length !== 1)
		throw new Error("fatal diagnostic requires exactly one witness");
	sorted(witnesses, "diagnostic witnesses");
	const expectedCategory = ["invalid-input", "resolution-invalid"].includes(code)
		? "invalid-input"
		: [
					"unsupported-profile",
					"unsupported-source",
					"unsupported-capability",
					"unsupported-payload-type",
					"capability-unavailable",
					"filesystem-unsupported",
					"resolution-unsupported",
					"record-replacement-unsupported",
				].includes(code)
			? "unsupported-capability"
			: ["missing-content", "io-failure", "commit-outcome-uncertain"].includes(code)
				? "operational-failure"
				: "domain-rejection";
	equal(diagnostic.category, expectedCategory, "diagnostic category");
	for (const witness of witnesses) {
		const kind = string(witness.kind);
		if (kind === "authority") equal(witness.rule, authorityRules[code], "authority rule");
		if (kind === "repository-authority" && (code !== "unauthorized-repository" || witness.rule !== "repository-unconfigured"))
			throw new Error("repository authority rule mismatch");
		if (kind === "resource") {
			const maximum = BigInt(string(witness.maximum));
			equal(BigInt(string(witness.observed)), maximum + 1n, "resource maximum + 1");
			const profile = maxima[string(witness.resource)];
			if (profile === undefined || (witness.scope === "profile" ? maximum !== profile : maximum >= profile))
				throw new Error("resource profile maximum mismatch");
			if (operation) {
				const limit = records(operation.limits).find((limit) => limit.resource === witness.resource);
				const effective = limit ? BigInt(string(limit.maximum)) : profile;
				equal(maximum, effective, "resource caller maximum");
			}
		}
		if (kind === "resolver") {
			const parsed = parseResolutionResponse({ ok: false, diagnostic: witness.diagnostic }, "resolve-library");
			equal(parsed, projectResolutionResult(parsed), "resolver witness ordering");
			const resolverCode = string(object(witness.diagnostic).code);
			const category = ["invalid-input", "invalid-lock"].includes(resolverCode)
				? "resolution-invalid"
				: resolverCode === "unsupported-capability"
					? "resolution-unsupported"
					: "resolution-rejected";
			equal(code, category, "resolver category");
		}
		if (kind === "time") {
			const at = string(witness.at);
			const boundary = string(witness.boundary);
			if (
				code === "metadata-expired"
					? witness.role === "clock" || at < boundary
					: code !== "trusted-time-unavailable" || witness.role !== "clock" || at >= boundary
			)
				throw new Error("time diagnostic relationship mismatch");
		}
		if (kind === "rollback") {
			const received = BigInt(string(witness.received));
			const trusted = BigInt(string(witness.trusted));
			const publication = diagnostic.phase === "publication" && witness.role !== "root" && (!operation || operation.name === "publish-library");
			if (received > trusted || (received === trusted && !publication)) throw new Error("role version rollback relationship mismatch");
		}
		if (kind === "continuity") {
			const missing = array(witness.missingVersions).map(string);
			sorted(missing, "missing root versions", (a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
			const from = BigInt(string(witness.fromVersion));
			const through = BigInt(string(witness.throughVersion));
			if (from > through || missing.some((version) => BigInt(version) < from || BigInt(version) > through))
				throw new Error("root continuity version range mismatch");
		}
		if (kind === "revision" && isDeepStrictEqual(witness.expected, witness.actual)) throw new Error("revision conflict requires different revisions");
		if (
			["digest", "length", "replacement", "immutable"].includes(kind) &&
			isDeepStrictEqual(witness.expected ?? witness.existing, witness.actual ?? witness.proposed)
		)
			throw new Error(`${kind} conflict requires different values`);
		if (kind === "authentication" && BigInt(string(witness.verified)) >= BigInt(string(witness.required)))
			throw new Error("authentication failure reached threshold");
		if (kind === "views") sorted(array(witness.snapshots), "conflicting views");
		if (kind === "catalog") {
			const candidates = records(witness.candidates);
			sorted(
				candidates.map((candidate) => [candidate.repository, candidate.snapshot, candidate.record].join("\0")),
				"catalog candidates",
			);
		}
		if (kind === "release-conflict" && witness.existingManifest === witness.proposedManifest && witness.existingContent === witness.proposedContent)
			throw new Error("release conflict requires changed content identity");
	}
}
