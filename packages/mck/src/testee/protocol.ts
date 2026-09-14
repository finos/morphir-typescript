// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Runtime guards for every protocol message. An adapter is a foreign process,
// so nothing it sends is trusted until it has been checked; every failure is
// a ProtocolError whose message names the field, which the driver reports as
// kit-error rather than letting a malformed answer pass as a result.
import type { Capabilities, DecodeResponse, Layout, PathMode, Profile, Request, TreeFile, Warning, WriteTreeResponse } from "./testee.ts";

export class ProtocolError extends Error {
	override readonly name = "ProtocolError";
}

const PROFILES: readonly Profile[] = ["json", "yaml"];
const LAYOUTS: readonly Layout[] = ["single", "tree"];
const PATHS: readonly PathMode[] = ["current", "pinned"];

function isRecord(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}
function need<T>(cond: boolean, message: string, value: T): T {
	if (!cond) throw new ProtocolError(message);
	return value;
}
function str(o: Record<string, unknown>, key: string): string {
	return need(typeof o[key] === "string", `"${key}" must be a string`, o[key] as string);
}
function list<T extends string>(o: Record<string, unknown>, key: string, allowed: readonly T[]): readonly T[] {
	const v = o[key];
	need(Array.isArray(v), `"${key}" must be an array`, v);
	for (const item of v as unknown[])
		need(allowed.includes(item as T), `"${key}" contains ${JSON.stringify(item)}, expected one of ${allowed.join(", ")}`, item);
	return v as T[];
}

export function parseEnvelope(line: string): { readonly id: number; readonly body: Record<string, unknown> } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch (error) {
		throw new ProtocolError(`not a JSON line: ${line.slice(0, 200)}`, { cause: error });
	}
	need(isRecord(parsed), "message must be a JSON object", parsed);
	const body = parsed as Record<string, unknown>;
	need(typeof body.id === "number" && Number.isInteger(body.id), "missing id", body.id);
	return { id: body.id as number, body };
}

export function parseCapabilities(v: unknown): Capabilities {
	need(isRecord(v), "capabilities must be an object", v);
	const o = v as Record<string, unknown>;
	need(o.contractVersion === 1, `unsupported contractVersion ${JSON.stringify(o.contractVersion)}; this driver speaks 1`, o);
	const versions = o.versions;
	need(Array.isArray(versions) && versions.every((n) => Number.isInteger(n) && (n as number) > 0), '"versions" must be positive integers', versions);
	return {
		contractVersion: 1,
		binding: str(o, "binding"),
		language: str(o, "language"),
		versions: versions as number[],
		profiles: list(o, "profiles", PROFILES),
		layouts: list(o, "layouts", LAYOUTS),
		paths: list(o, "paths", PATHS),
	};
}

function parseDiagnostic(v: unknown): DecodeResponse & { ok: false } {
	need(isRecord(v), '"diagnostic" must be an object', v);
	const d = v as Record<string, unknown>;
	const code = str(d, "code");
	const out: { code: string; stage?: "syntax" | "normalization" | "semantic"; cursor?: string; message?: string } = { code };
	if (d.stage !== undefined)
		out.stage = need(
			["syntax", "normalization", "semantic"].includes(d.stage as string),
			'"stage" must be syntax, normalization, or semantic',
			d.stage as "syntax",
		);
	if (d.cursor !== undefined) out.cursor = str(d, "cursor");
	if (d.message !== undefined) out.message = str(d, "message");
	return { ok: false, diagnostic: out };
}

function parseFiles(v: unknown, key: string): readonly TreeFile[] {
	need(Array.isArray(v), `"${key}" must be an array`, v);
	return (v as unknown[]).map((f) => {
		need(isRecord(f), `"${key}" entries must be objects`, f);
		return { path: str(f as Record<string, unknown>, "path"), content: str(f as Record<string, unknown>, "content") };
	});
}

export function parseDecodeResponse(v: unknown): DecodeResponse {
	need(isRecord(v), "response must be an object", v);
	const o = v as Record<string, unknown>;
	if (o.ok === false) return parseDiagnostic(o.diagnostic);
	need(o.ok === true, '"ok" must be true or false', o.ok);
	const canonical = o.canonical;
	need(isRecord(canonical), '"canonical" must be an object', canonical);
	const out: Partial<Record<Profile, string>> = {};
	for (const [k, val] of Object.entries(canonical as Record<string, unknown>)) {
		need(PROFILES.includes(k as Profile), `"canonical" has unknown profile "${k}"`, k);
		need(typeof val === "string", `"canonical.${k}" must be a string`, val);
		out[k as Profile] = val as string;
	}
	const warnings = o.warnings;
	need(Array.isArray(warnings), '"warnings" must be an array', warnings);
	const parsedWarnings: Warning[] = (warnings as unknown[]).map((w) => {
		need(isRecord(w), '"warnings" entries must be objects', w);
		return { code: str(w as Record<string, unknown>, "code"), cursor: str(w as Record<string, unknown>, "cursor") };
	});
	return { ok: true, kind: str(o, "kind"), canonical: out, warnings: parsedWarnings };
}

export function parseWriteTreeResponse(v: unknown): WriteTreeResponse {
	need(isRecord(v), "response must be an object", v);
	const o = v as Record<string, unknown>;
	if (o.ok === false) return parseDiagnostic(o.diagnostic);
	need(o.ok === true, '"ok" must be true or false', o.ok);
	return { ok: true, files: parseFiles(o.files, "files") };
}

export function parseRequest(v: unknown): Request {
	need(isRecord(v), "request must be an object", v);
	const o = v as Record<string, unknown>;
	const op = str(o, "op");
	const common = () => ({
		version: need(Number.isInteger(o.version), '"version" must be an integer', o.version as number),
		path: need(PATHS.includes(o.path as PathMode), '"path" must be current or pinned', o.path as PathMode),
	});
	switch (op) {
		case "capabilities":
		case "exit":
			return { op };
		case "decode":
			return {
				op,
				...common(),
				profile: need(PROFILES.includes(o.profile as Profile), '"profile" must be json or yaml', o.profile as Profile),
				strip: need(typeof o.strip === "boolean", '"strip" must be a boolean', o.strip as boolean),
				node: str(o, "node"),
				input: str(o, "input"),
			};
		case "readTree":
			return {
				op,
				...common(),
				profile: need(PROFILES.includes(o.profile as Profile), '"profile" must be json or yaml', o.profile as Profile),
				strip: need(typeof o.strip === "boolean", '"strip" must be a boolean', o.strip as boolean),
				node: str(o, "node"),
				files: parseFiles(o.files, "files"),
			};
		case "writeTree": {
			const policy = o.policy;
			need(isRecord(policy), '"policy" must be an object', policy);
			const p = policy as Record<string, unknown>;
			return {
				op,
				...common(),
				policy: {
					profile: need(PROFILES.includes(p.profile as Profile), '"policy.profile" must be json or yaml', p.profile as Profile),
					pathBudget: need(Number.isInteger(p.pathBudget), '"policy.pathBudget" must be an integer', p.pathBudget as number),
				},
				input: str(o, "input"),
			};
		}
		default:
			throw new ProtocolError(`unknown op "${op}"`);
	}
}
