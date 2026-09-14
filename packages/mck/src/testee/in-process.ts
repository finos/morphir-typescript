// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The TypeScript binding as a Testee, in process. "current" goes through the
// package's current entry point and "pinned" through the v4 module, so the
// driver's two-path rule is exercised even while both resolve to v4.
//
// These two specifiers are relative source paths, not the package name:
// `moduleResolution: "bundler"` reads `@finos/morphir-ir`'s `exports`, which
// point at `dist/`, and `dist/` does not exist in a checkout. Bun resolves a
// bare specifier the same way at runtime, so a package import would fail here
// too. Importing the sources directly sidesteps both. Task 9's packaging step
// rewrites these two specifiers to the package names for the published
// `dist/`.
import * as current from "../../../ir/src/index.ts";
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
	profiles: ["json"],
	layouts: ["single"],
	paths: ["current", "pinned"],
};

const refuse = (code: string, message: string): DecodeResponse => ({ ok: false, diagnostic: { code, stage: "semantic", cursor: "/", message } });

function decodeWith(codec: Codec, req: DecodeRequest): DecodeResponse {
	if (req.version !== 4) return refuse("unsupported_version", `this binding reads IR version 4, not ${req.version}`);
	if (req.profile !== "json") return refuse("unsupported_profile", `this binding reads json, not ${req.profile}`);
	const node = resolveNode(req.node);
	if (node === null) return refuse("unknown_node", `no node kind named "${req.node}"`);
	const r = codec.readNodeChecked(node, req.input);
	if (!r.ok) return { ok: false, diagnostic: { code: r.error.code, stage: r.error.stage, cursor: r.error.cursor, message: r.error.message } };
	const value = req.strip ? codec.stripNode(r.value.value) : r.value.value;
	return {
		ok: true,
		kind: codec.nodeKindOf(r.value.value),
		canonical: { json: codec.writeNode(value) },
		warnings: r.value.warnings.map((w) => ({ code: w.code, cursor: w.cursor })),
	};
}

export function inProcessTestee(): Testee {
	return {
		capabilities: async () => IN_PROCESS_CAPABILITIES,
		decode: async (req) => decodeWith(req.path === "pinned" ? pinned : (current as unknown as Codec), req),
		readTree: async (_req: ReadTreeRequest) => refuse("unsupported_layout", "this binding reads single documents only (plan 2c adds the tree)"),
		writeTree: async (_req: WriteTreeRequest): Promise<WriteTreeResponse> => ({
			ok: false,
			diagnostic: { code: "unsupported_layout", stage: "semantic", cursor: "/", message: "this binding writes single documents only" },
		}),
		close: async () => {},
	};
}
