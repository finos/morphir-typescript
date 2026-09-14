// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the adapter protocol's runtime guards: one valid message per
// parser (drawn from protocol.example.json), a table-driven pass over every
// example so none is silently skipped, and the invalid shapes an untrusted
// adapter process might send.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ProtocolError, parseCapabilities, parseDecodeResponse, parseEnvelope, parseRequest, parseWriteTreeResponse } from "./protocol.ts";

type Example = { readonly direction: "request" | "response"; readonly message: Record<string, unknown> };
const all = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "..", "protocol.example.json"), "utf8")) as readonly Example[];

// A real transport reads a line, calls parseEnvelope to peel off "id", then
// hands the remaining body to the op- or response-specific parser. Do the
// same here so the strict per-parser guards never see the envelope's "id".
function body(message: Record<string, unknown>): Record<string, unknown> {
	return parseEnvelope(JSON.stringify(message)).body;
}

function requests(id: number): readonly Record<string, unknown>[] {
	return all.filter((e) => e.direction === "request" && e.message.id === id).map((e) => e.message);
}
function request(id: number): Record<string, unknown> {
	const found = requests(id)[0];
	if (!found) throw new Error(`no request example with id ${id}`);
	return found;
}
function responses(id: number): readonly Record<string, unknown>[] {
	return all.filter((e) => e.direction === "response" && e.message.id === id).map((e) => e.message);
}
function response(id: number, index = 0): Record<string, unknown> {
	const found = responses(id)[index];
	if (!found) throw new Error(`no response example with id ${id} at index ${index}`);
	return found;
}

// --- every example, table-driven, so none can be silently skipped ---

const REQUEST_OP_BY_ID: Record<number, string> = { 1: "capabilities", 2: "decode", 3: "readTree", 4: "writeTree", 5: "exit" };
const RESPONSE_PARSER_BY_OP: Record<string, (v: unknown) => unknown> = {
	capabilities: parseCapabilities,
	decode: parseDecodeResponse,
	readTree: parseDecodeResponse,
	writeTree: parseWriteTreeResponse,
};

for (const entry of all) {
	const id = entry.message.id as number;
	const op = REQUEST_OP_BY_ID[id];
	if (entry.direction === "request") {
		test(`example request id ${id} (${op}) parses with parseRequest`, () => {
			expect(() => parseRequest(body(entry.message))).not.toThrow();
		});
		continue;
	}
	if (!op) throw new Error(`no request op known for response id ${id}`);
	const parser = RESPONSE_PARSER_BY_OP[op];
	if (!parser) throw new Error(`no parser known for op ${op}`);
	const okness = entry.message.ok === false ? "ok:false" : "ok:true";
	test(`example response id ${id} (${op}, ${okness}) parses with its matching parser`, () => {
		expect(() => parser(body(entry.message))).not.toThrow();
	});
}

// --- parseCapabilities ---

test("parseCapabilities accepts the example capabilities response", () => {
	const parsed = parseCapabilities(body(response(1)));
	expect(parsed.contractVersion).toBe(1);
	expect(parsed.binding).toBe("morphir-typescript");
	expect(parsed.profiles).toEqual(["json"]);
});

test("parseCapabilities rejects a non-object", () => {
	expect(() => parseCapabilities("nope")).toThrow("capabilities must be an object");
});

test("parseCapabilities rejects contractVersion 2", () => {
	const capabilities = body(response(1));
	expect(() => parseCapabilities({ ...capabilities, contractVersion: 2 })).toThrow("unsupported contractVersion 2; this driver speaks 1");
});

test("parseCapabilities rejects an unknown profile", () => {
	const capabilities = body(response(1));
	expect(() => parseCapabilities({ ...capabilities, profiles: ["xml"] })).toThrow('"profiles" contains "xml", expected one of json, yaml');
});

test("parseCapabilities rejects an extra field", () => {
	const capabilities = body(response(1));
	expect(() => parseCapabilities({ ...capabilities, extra: true })).toThrow('unknown field "extra"');
});

test("parseCapabilities accepts the example capabilities response's nodes", () => {
	const parsed = parseCapabilities(body(response(1)));
	expect(parsed.nodes).toContain("Type");
	expect(parsed.nodes).toContain("Distribution");
});

test("parseCapabilities rejects capabilities missing nodes", () => {
	const capabilities = body(response(1)) as Record<string, unknown>;
	const { nodes, ...withoutNodes } = capabilities;
	expect(() => parseCapabilities(withoutNodes)).toThrow('"nodes" must be an array of strings');
});

test("parseCapabilities rejects a non-string nodes entry", () => {
	const capabilities = body(response(1));
	expect(() => parseCapabilities({ ...capabilities, nodes: ["Type", 42] })).toThrow('"nodes" must be an array of strings');
});

// --- parseDecodeResponse ---

test("parseDecodeResponse accepts the example ok:true decode response", () => {
	const parsed = parseDecodeResponse(body(response(2, 0)));
	expect(parsed.ok).toBe(true);
});

test("parseDecodeResponse accepts the example ok:false decode response", () => {
	const parsed = parseDecodeResponse(body(response(2, 1)));
	expect(parsed.ok).toBe(false);
});

test("parseDecodeResponse accepts the example readTree response (id 3)", () => {
	const parsed = parseDecodeResponse(body(response(3)));
	expect(parsed.ok).toBe(true);
});

test("parseDecodeResponse rejects a non-object", () => {
	expect(() => parseDecodeResponse(42)).toThrow(ProtocolError);
});

test("parseDecodeResponse rejects ok:true without warnings", () => {
	const okTrue = body(response(2, 0));
	const { warnings, ...withoutWarnings } = okTrue as { warnings: unknown } & Record<string, unknown>;
	expect(() => parseDecodeResponse(withoutWarnings)).toThrow('"warnings" must be an array');
});

test("parseDecodeResponse rejects ok:false without diagnostic.code", () => {
	const okFalse = body(response(2, 1));
	const diagnostic = okFalse.diagnostic as Record<string, unknown>;
	const { code, ...withoutCode } = diagnostic;
	expect(() => parseDecodeResponse({ ...okFalse, diagnostic: withoutCode })).toThrow('"code" must be a string');
});

test("parseDecodeResponse rejects an extra field", () => {
	const okTrue = body(response(2, 0));
	expect(() => parseDecodeResponse({ ...okTrue, extra: true })).toThrow('unknown field "extra"');
});

// --- parseWriteTreeResponse ---

test("parseWriteTreeResponse accepts the example writeTree response", () => {
	const parsed = parseWriteTreeResponse(body(response(4)));
	expect(parsed.ok).toBe(true);
});

test("parseWriteTreeResponse rejects a file without content", () => {
	const writeTreeResponse = body(response(4));
	const files = (writeTreeResponse as { files: Record<string, unknown>[] }).files;
	const file = files[0];
	if (!file) throw new Error("example writeTree response has no files");
	const { content, ...withoutContent } = file;
	expect(() => parseWriteTreeResponse({ ...writeTreeResponse, files: [withoutContent] })).toThrow('"content" must be a string');
});

test("parseWriteTreeResponse rejects an extra field", () => {
	const writeTreeResponse = body(response(4));
	expect(() => parseWriteTreeResponse({ ...writeTreeResponse, extra: true })).toThrow('unknown field "extra"');
});

// --- parseRequest ---

test("parseRequest accepts the example capabilities request", () => {
	expect(parseRequest(body(request(1)))).toEqual({ op: "capabilities" });
});

test("parseRequest accepts the example decode request", () => {
	const parsed = parseRequest(body(request(2)));
	expect(parsed.op).toBe("decode");
});

test("parseRequest accepts the example readTree request", () => {
	const parsed = parseRequest(body(request(3)));
	expect(parsed.op).toBe("readTree");
});

test("parseRequest accepts the example writeTree request", () => {
	const parsed = parseRequest(body(request(4)));
	expect(parsed.op).toBe("writeTree");
});

test("parseRequest accepts the example exit request", () => {
	expect(parseRequest(body(request(5)))).toEqual({ op: "exit" });
});

test("parseRequest rejects a non-object", () => {
	expect(() => parseRequest(null)).toThrow("request must be an object");
});

test("parseRequest rejects an unknown op", () => {
	expect(() => parseRequest({ op: "frobnicate" })).toThrow('unknown op "frobnicate"');
});

test("parseRequest rejects an extra field", () => {
	const decodeRequest = body(request(2));
	expect(() => parseRequest({ ...decodeRequest, extra: true })).toThrow('unknown field "extra"');
});

// --- parseEnvelope ---

test("parseEnvelope accepts a well-formed line and strips id from the body", () => {
	const envelope = parseEnvelope(JSON.stringify(request(1)));
	expect(envelope.id).toBe(1);
	expect(envelope.body.op).toBe("capabilities");
	expect(envelope.body).not.toHaveProperty("id");
});

test("parseEnvelope rejects a line that is not JSON", () => {
	expect(() => parseEnvelope("not json at all")).toThrow(/^not a JSON line:/);
});

test("parseEnvelope rejects a message without a numeric id", () => {
	expect(() => parseEnvelope(JSON.stringify({ op: "capabilities" }))).toThrow("missing id");
});
