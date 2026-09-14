// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the adapter protocol's runtime guards: one valid message per
// parser (drawn from protocol.example.json) and the invalid shapes an
// untrusted adapter process might send.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ProtocolError, parseCapabilities, parseDecodeResponse, parseEnvelope, parseRequest, parseWriteTreeResponse } from "./protocol.ts";

type Example = { readonly direction: "request" | "response"; readonly message: Record<string, unknown> };
const all = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "..", "protocol.example.json"), "utf8")) as readonly Example[];

function request(id: number): Record<string, unknown> {
	const found = all.find((e) => e.direction === "request" && e.message.id === id);
	if (!found) throw new Error(`no request example with id ${id}`);
	return found.message;
}
function responses(id: number): readonly Record<string, unknown>[] {
	return all.filter((e) => e.direction === "response" && e.message.id === id).map((e) => e.message);
}
function response(id: number, index = 0): Record<string, unknown> {
	const found = responses(id)[index];
	if (!found) throw new Error(`no response example with id ${id} at index ${index}`);
	return found;
}

// --- parseCapabilities ---

test("parseCapabilities accepts the example capabilities response", () => {
	const capabilities = response(1);
	const parsed = parseCapabilities(capabilities);
	expect(parsed.contractVersion).toBe(1);
	expect(parsed.binding).toBe("morphir-typescript");
	expect(parsed.profiles).toEqual(["json"]);
});

test("parseCapabilities rejects a non-object", () => {
	expect(() => parseCapabilities("nope")).toThrow(ProtocolError);
});

test("parseCapabilities rejects contractVersion 2", () => {
	const capabilities = response(1);
	expect(() => parseCapabilities({ ...capabilities, contractVersion: 2 })).toThrow("unsupported contractVersion 2; this driver speaks 1");
});

test("parseCapabilities rejects an unknown profile", () => {
	const capabilities = response(1);
	expect(() => parseCapabilities({ ...capabilities, profiles: ["xml"] })).toThrow(ProtocolError);
});

// --- parseDecodeResponse ---

test("parseDecodeResponse accepts the example ok:true decode response", () => {
	const okTrue = response(2, 0);
	const parsed = parseDecodeResponse(okTrue);
	expect(parsed.ok).toBe(true);
});

test("parseDecodeResponse accepts the example ok:false decode response", () => {
	const okFalse = response(2, 1);
	const parsed = parseDecodeResponse(okFalse);
	expect(parsed.ok).toBe(false);
});

test("parseDecodeResponse rejects a non-object", () => {
	expect(() => parseDecodeResponse(42)).toThrow(ProtocolError);
});

test("parseDecodeResponse rejects ok:true without warnings", () => {
	const okTrue = response(2, 0);
	const { warnings, ...withoutWarnings } = okTrue as { warnings: unknown } & Record<string, unknown>;
	expect(() => parseDecodeResponse(withoutWarnings)).toThrow('"warnings" must be an array');
});

test("parseDecodeResponse rejects ok:false without diagnostic.code", () => {
	const okFalse = response(2, 1);
	const diagnostic = okFalse.diagnostic as Record<string, unknown>;
	const { code, ...withoutCode } = diagnostic;
	expect(() => parseDecodeResponse({ ...okFalse, diagnostic: withoutCode })).toThrow('"code" must be a string');
});

// --- parseWriteTreeResponse ---

test("parseWriteTreeResponse accepts the example writeTree response", () => {
	const writeTreeResponse = response(4);
	const parsed = parseWriteTreeResponse(writeTreeResponse);
	expect(parsed.ok).toBe(true);
});

test("parseWriteTreeResponse rejects a file without content", () => {
	const writeTreeResponse = response(4);
	const files = (writeTreeResponse as { files: Record<string, unknown>[] }).files;
	const file = files[0];
	if (!file) throw new Error("example writeTree response has no files");
	const { content, ...withoutContent } = file;
	expect(() => parseWriteTreeResponse({ ...writeTreeResponse, files: [withoutContent] })).toThrow('"content" must be a string');
});

// --- parseRequest ---

test("parseRequest accepts the example capabilities request", () => {
	expect(parseRequest(request(1))).toEqual({ op: "capabilities" });
});

test("parseRequest accepts the example decode request", () => {
	const parsed = parseRequest(request(2));
	expect(parsed.op).toBe("decode");
});

test("parseRequest accepts the example readTree request", () => {
	const parsed = parseRequest(request(3));
	expect(parsed.op).toBe("readTree");
});

test("parseRequest accepts the example writeTree request", () => {
	const parsed = parseRequest(request(4));
	expect(parsed.op).toBe("writeTree");
});

test("parseRequest accepts the example exit request", () => {
	expect(parseRequest(request(5))).toEqual({ op: "exit" });
});

test("parseRequest rejects a non-object", () => {
	expect(() => parseRequest(null)).toThrow(ProtocolError);
});

test("parseRequest rejects an unknown op", () => {
	expect(() => parseRequest({ op: "frobnicate" })).toThrow('unknown op "frobnicate"');
});

// --- parseEnvelope ---

test("parseEnvelope accepts a well-formed line", () => {
	const envelope = parseEnvelope(JSON.stringify(request(1)));
	expect(envelope.id).toBe(1);
	expect(envelope.body.op).toBe("capabilities");
});

test("parseEnvelope rejects a line that is not JSON", () => {
	expect(() => parseEnvelope("not json at all")).toThrow(/^not a JSON line:/);
});

test("parseEnvelope rejects a message without a numeric id", () => {
	expect(() => parseEnvelope(JSON.stringify({ op: "capabilities" }))).toThrow("missing id");
});
