// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The adapter protocol, contract version 1, and the Testee interface both
// transports implement. Shapes are normative: spec S6.

export type Profile = "json" | "yaml";
export type Layout = "single" | "tree";
export type PathMode = "current" | "pinned";

export interface Capabilities {
	readonly contractVersion: 1;
	readonly binding: string;
	readonly language: string;
	readonly versions: readonly number[];
	readonly profiles: readonly Profile[];
	readonly layouts: readonly Layout[];
	readonly paths: readonly PathMode[];
	/** Node kinds this adapter decodes, spelled as the kit names them (aliases included, e.g. "Distribution"). */
	readonly nodes: readonly string[];
}

export interface TreeFile {
	readonly path: string;
	readonly content: string;
}

export interface DecodeRequest {
	readonly op: "decode";
	readonly version: number;
	readonly profile: Profile;
	readonly path: PathMode;
	readonly strip: boolean;
	readonly node: string;
	readonly input: string;
}

export interface ReadTreeRequest {
	readonly op: "readTree";
	readonly version: number;
	readonly profile: Profile;
	readonly path: PathMode;
	readonly strip: boolean;
	readonly node: string;
	readonly files: readonly TreeFile[];
}

export interface WriteTreeRequest {
	readonly op: "writeTree";
	readonly version: number;
	readonly path: PathMode;
	readonly policy: { readonly profile: Profile; readonly pathBudget: number };
	readonly input: string;
}

export type Request = { readonly op: "capabilities" } | DecodeRequest | ReadTreeRequest | WriteTreeRequest | { readonly op: "exit" };

export interface Warning {
	readonly code: string;
	readonly cursor: string;
}

export interface ProtocolDiagnostic {
	readonly code: string;
	readonly stage?: "syntax" | "normalization" | "semantic";
	readonly cursor?: string;
	readonly message?: string;
}

export type DecodeResponse =
	| { readonly ok: true; readonly kind: string; readonly canonical: Partial<Record<Profile, string>>; readonly warnings: readonly Warning[] }
	| { readonly ok: false; readonly diagnostic: ProtocolDiagnostic };

export type WriteTreeResponse = { readonly ok: true; readonly files: readonly TreeFile[] } | { readonly ok: false; readonly diagnostic: ProtocolDiagnostic };

export type Envelope<T> = T & { readonly id: number };

export interface Testee {
	capabilities(): Promise<Capabilities>;
	decode(req: DecodeRequest): Promise<DecodeResponse>;
	readTree(req: ReadTreeRequest): Promise<DecodeResponse>;
	writeTree(req: WriteTreeRequest): Promise<WriteTreeResponse>;
	close(): Promise<void>;
}
