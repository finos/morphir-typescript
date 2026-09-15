// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The TypeScript binding as a Testee, in process. "current" goes through the
// package's current entry point and "pinned" through the v4 module, so the
// driver's two-path rule is exercised even while both resolve to v4.
//
// These specifiers are relative source paths, not the package name:
// `moduleResolution: "bundler"` reads `@finos/morphir-ir`'s `exports`, which
// point at `dist/`, and `dist/` does not exist in a checkout. Bun resolves a
// bare specifier the same way at runtime, so a package import would fail here
// too. Importing the sources directly sidesteps both. The packaging step
// rewrites these specifiers to the package names for the published `dist/`.
import * as current from "../../../ir/src/index.ts";
// The document tree is one implementation shared by every version module, so
// it is imported once here rather than through `current`/`pinned`.
import { readTree as readDocumentTree, writeTree as writeDocumentTree } from "../../../ir/src/layout/index.ts";
import * as pinned from "../../../ir/src/versions/v4/index.ts";
import type { Capabilities, DecodeRequest, DecodeResponse, ReadTreeRequest, Testee, WriteTreeRequest, WriteTreeResponse } from "./testee.ts";

type Codec = typeof pinned;
type NodeKind = pinned.NodeKind;

export const NODE_KINDS: readonly NodeKind[] = [
	"Name",
	"Path",
	"FQName",
	"FormatVersion",
	"Type",
	"Literal",
	"Pattern",
	"Value",
	"TypeSpecification",
	"TypeDefinition",
	"ValueSpecification",
	"ValueDefinition",
	"AccessControlledTypeDefinition",
	"AccessControlledValueDefinition",
	"ModuleDefinition",
	"ModuleSpecification",
	"IRFile",
	"DistributionManifestFile",
	"ModuleManifestFile",
	"TypeDefinitionFile",
	"ValueDefinitionFile",
];
const NODES: ReadonlyMap<string, NodeKind> = new Map<string, NodeKind>([
	...NODE_KINDS.map((k): readonly [string, NodeKind] => [k, k]),
	...Object.entries(pinned.NODE_ALIASES),
]);

export function resolveNode(name: string): NodeKind | null {
	return NODES.get(name) ?? null;
}

export const IN_PROCESS_CAPABILITIES: Capabilities = {
	contractVersion: 1,
	binding: "morphir-typescript",
	language: "typescript",
	versions: [4],
	profiles: ["json", "yaml"],
	layouts: ["single", "tree"],
	paths: ["current", "pinned"],
	nodes: [...NODE_KINDS, ...Object.keys(pinned.NODE_ALIASES)],
};

const refuse = (code: string, message: string): DecodeResponse => ({ ok: false, diagnostic: { code, stage: "semantic", cursor: "/", message } });

// The IR's Diagnostic, structurally: the model module is not one of the
// entry points this file may name, and the protocol wants plain strings
// anyway.
interface IrDiagnostic {
	readonly code: string;
	readonly stage: "syntax" | "normalization" | "semantic";
	readonly cursor: string;
	readonly message: string;
}

const diagnosticOf = (d: IrDiagnostic): IrDiagnostic => ({
	code: d.code,
	stage: d.stage,
	cursor: d.cursor,
	message: d.message,
});

function decodeWith(codec: Codec, req: DecodeRequest): DecodeResponse {
	if (req.version !== 4) return refuse("unsupported_version", `this binding reads IR version 4, not ${req.version}`);
	const profile: pinned.ProfileCodec | undefined = codec.profiles[req.profile];
	if (profile === undefined) return refuse("unsupported_profile", `this binding reads json and yaml, not ${req.profile}`);
	const node = resolveNode(req.node);
	if (node === null) return refuse("unknown_node", `no node kind named "${req.node}"`);
	const r = codec.readNodeCheckedWith(profile, node, req.input);
	if (!r.ok) return { ok: false, diagnostic: diagnosticOf(r.error) };
	const value = req.strip ? codec.stripNode(r.value.value) : r.value.value;
	return {
		ok: true,
		kind: codec.nodeKindOf(r.value.value),
		canonical: { [req.profile]: codec.writeNodeWith(profile, value) },
		warnings: r.value.warnings.map((w) => ({ code: w.code, cursor: w.cursor })),
	};
}

// A tree read answers like a decode of the whole-document node: the same
// `kind`, the same canonical in the requested profile, the same warnings. The
// driver then compares that canonical with the case's canonical fence, so one
// distribution written two ways is held to one expectation.
function readTreeWith(codec: Codec, req: ReadTreeRequest): DecodeResponse {
	if (req.version !== 4) return refuse("unsupported_version", `this binding reads IR version 4, not ${req.version}`);
	const profile: pinned.ProfileCodec | undefined = codec.profiles[req.profile];
	if (profile === undefined) return refuse("unsupported_profile", `this binding reads json and yaml, not ${req.profile}`);
	const files = new Map(req.files.map((f) => [f.path, f.content]));
	const r = readDocumentTree(files, profile);
	if (!r.ok) return { ok: false, diagnostic: diagnosticOf(r.error) };
	const node = { node: "IRFile", value: r.value.value } as const;
	const value = req.strip ? codec.stripNode(node) : node;
	return {
		ok: true,
		kind: codec.nodeKindOf(node),
		canonical: { [req.profile]: codec.writeNodeWith(profile, value) },
		warnings: r.value.warnings.map((w) => ({ code: w.code, cursor: w.cursor })),
	};
}

function writeTreeWith(codec: Codec, req: WriteTreeRequest): WriteTreeResponse {
	const fail = (code: string, message: string): WriteTreeResponse => ({ ok: false, diagnostic: { code, stage: "semantic", cursor: "/", message } });
	if (req.version !== 4) return fail("unsupported_version", `this binding writes IR version 4, not ${req.version}`);
	const profile: pinned.ProfileCodec | undefined = codec.profiles[req.policy.profile];
	if (profile === undefined) return fail("unsupported_profile", `this binding writes json and yaml, not ${req.policy.profile}`);
	// The single document the tree is written from, read through the same node
	// entry point a `decode` of a Distribution would take.
	const file = codec.readNodeCheckedWith(profile, "IRFile", req.input);
	if (!file.ok) return { ok: false, diagnostic: diagnosticOf(file.error) };
	const node = file.value.value;
	if (node.node !== "IRFile") return fail("unknown_node", `reading IRFile produced a ${node.node}`);
	const written = writeDocumentTree(node.value, { profile, pathBudget: req.policy.pathBudget });
	if (!written.ok) return { ok: false, diagnostic: diagnosticOf(written.error) };
	return { ok: true, files: [...written.value].map(([path, content]) => ({ path, content })) };
}

export function inProcessTestee(): Testee {
	const codecFor = (path: "current" | "pinned"): Codec => (path === "pinned" ? pinned : (current as unknown as Codec));
	return {
		capabilities: async () => IN_PROCESS_CAPABILITIES,
		decode: async (req) => decodeWith(codecFor(req.path), req),
		readTree: async (req) => readTreeWith(codecFor(req.path), req),
		writeTree: async (req) => writeTreeWith(codecFor(req.path), req),
		close: async () => {},
	};
}
