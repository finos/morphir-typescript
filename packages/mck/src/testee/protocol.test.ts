// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the adapter protocol's runtime guards: one valid message per
// parser (drawn from protocol.example.json), a table-driven pass over every
// example so none is silently skipped, and the invalid shapes an untrusted
// adapter process might send.
//
// protocol.schema.json states the same contract a second time, for adapter
// authors in languages that cannot import these guards. Two statements of one
// contract can disagree, so the last section here compiles the schema and runs
// every example and every negative case through it too: a message the guards
// accept must validate, and a message the guards reject must not.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv, { type ValidateFunction } from "ajv";
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

test("parseCapabilities rejects an empty binding", () => {
	const capabilities = capabilitiesWith({ binding: "" });
	expect(() => parseCapabilities(body(capabilities))).toThrow('"binding" must be a non-empty string');
	expect(schemaVerdict("Capabilities", capabilities)).not.toBe(true);
});

test("parseCapabilities rejects an empty language", () => {
	const capabilities = capabilitiesWith({ language: "" });
	expect(() => parseCapabilities(body(capabilities))).toThrow('"language" must be a non-empty string');
	expect(schemaVerdict("Capabilities", capabilities)).not.toBe(true);
});

// --- formatVersions: the binding's support table ---
//
// The table is the adapter's own statement of which IR releases it accepts, so
// the driver holds it to the canonical spelling and to agreeing with
// `versions`: two fields describing one thing must not disagree.

test("parseCapabilities rejects capabilities without formatVersions", () => {
	expect(() => parseCapabilities(body(withoutKey(response(1), "formatVersions")))).toThrow('"formatVersions" must be a string');
});

test("parseCapabilities rejects a non-canonical formatVersions", () => {
	expect(() => parseCapabilities(body(capabilitiesWith({ formatVersions: "[4.0.0,4.1.0]" })))).toThrow("canonical");
});

test("parseCapabilities rejects a formatVersions that is not a support table at all", () => {
	expect(() => parseCapabilities(body(capabilitiesWith({ formatVersions: "not a table" })))).toThrow('"formatVersions" "not a table" is not a support table');
});

test("parseCapabilities rejects a formatVersions holding no release of a listed version", () => {
	expect(() => parseCapabilities(body(capabilitiesWith({ formatVersions: "[3.0.0,3.1.0)", versions: [4] })))).toThrow("versions");
});

test("parseCapabilities rejects a formatVersions touching a major that versions does not list", () => {
	expect(() => parseCapabilities(body(capabilitiesWith({ formatVersions: "[3.0.0,3.1.0),[4.0.0,4.1.0)", versions: [4] })))).toThrow(
		'"formatVersions" "[3.0.0,3.1.0),[4.0.0,4.1.0)" touches major 3 but "versions" does not list it',
	);
});

test("parseCapabilities accepts a canonical formatVersions agreeing with versions", () => {
	const parsed = parseCapabilities(body(capabilitiesWith({ formatVersions: "[4.0.0,4.1.0)", versions: [4] })));
	expect(parsed.formatVersions).toBe("[4.0.0,4.1.0)");
});

// An absent *upper* bound names no last major, so it is exempt from the
// "touches a major versions does not list" rule: `[4.0.0,)` reaches every
// later major by construction and the adapter cannot enumerate them.
test("parseCapabilities accepts a formatVersions unbounded above", () => {
	const parsed = parseCapabilities(body(capabilitiesWith({ formatVersions: "[4.0.0,)", versions: [4] })));
	expect(parsed.formatVersions).toBe("[4.0.0,)");
});

// An absent *lower* bound is not exempt. It stops at the domain floor, so the
// majors it touches are all nameable and the adapter has to name them:
// `(,4.1.0)` holds every 3.x release, and an adapter listing only version 4
// has claimed those releases without saying so.
test("parseCapabilities rejects a formatVersions unbounded below that reaches an unlisted major", () => {
	expect(() => parseCapabilities(body(capabilitiesWith({ formatVersions: "(,4.1.0)", versions: [4] })))).toThrow(
		'"formatVersions" "(,4.1.0)" touches major 3 but "versions" does not list it',
	);
});

test("parseCapabilities accepts a formatVersions unbounded below when versions lists every major it reaches", () => {
	const parsed = parseCapabilities(body(capabilitiesWith({ formatVersions: "(,4.1.0)", versions: [3, 4] })));
	expect(parsed.formatVersions).toBe("(,4.1.0)");
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

function writeTreeWith(policyPatch: Record<string, unknown>): Record<string, unknown> {
	return { ...request(4), policy: { ...(request(4).policy as Record<string, unknown>), ...policyPatch } };
}

test("parseRequest rejects a writeTree request with pathBudget 0", () => {
	const writeTreeRequest = writeTreeWith({ pathBudget: 0 });
	expect(() => parseRequest(body(writeTreeRequest))).toThrow('"policy.pathBudget" must be an integer of at least 64');
	expect(schemaVerdict("WriteTreeRequest", writeTreeRequest)).not.toBe(true);
});

test("parseRequest rejects a writeTree request with pathBudget 63", () => {
	const writeTreeRequest = writeTreeWith({ pathBudget: 63 });
	expect(() => parseRequest(body(writeTreeRequest))).toThrow('"policy.pathBudget" must be an integer of at least 64');
	expect(schemaVerdict("WriteTreeRequest", writeTreeRequest)).not.toBe(true);
});

test("parseRequest accepts a writeTree request with pathBudget 64", () => {
	const writeTreeRequest = writeTreeWith({ pathBudget: 64 });
	const parsed = parseRequest(body(writeTreeRequest));
	expect(parsed.op).toBe("writeTree");
	expect(schemaVerdict("WriteTreeRequest", writeTreeRequest)).toBe(true);
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

// --- the schema and the guards state one contract ---

const schemaDocument = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "..", "protocol.schema.json"), "utf8")) as {
	readonly $id: string;
	readonly definitions: Record<string, unknown>;
	readonly oneOf: readonly { readonly $ref: string }[];
};
// The schema is draft-07, which is Ajv 8's default dialect. `strict: false`
// because draft-07's `allOf` composition (an envelope merged with a message
// body) is exactly what Ajv's strict mode warns about, and the composition is
// deliberate.
const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addSchema(schemaDocument);

function validator(definition: string): ValidateFunction {
	const compiled = ajv.getSchema(`${schemaDocument.$id}#/definitions/${definition}`);
	if (compiled === undefined) throw new Error(`protocol.schema.json has no definition "${definition}"`);
	return compiled;
}

/** Validates, and on failure reports Ajv's own message rather than a bare `false`. */
function schemaVerdict(definition: string, message: unknown): true | string {
	const validate = validator(definition);
	return validate(message) === true ? true : ajv.errorsText(validate.errors);
}

const REQUEST_DEFINITION_BY_OP: Record<string, string> = {
	capabilities: "CapabilitiesRequest",
	decode: "DecodeRequest",
	readTree: "ReadTreeRequest",
	writeTree: "WriteTreeRequest",
	exit: "ExitRequest",
};
const RESPONSE_DEFINITION_BY_OP: Record<string, string> = {
	capabilities: "Capabilities",
	decode: "DecodeResponse",
	readTree: "DecodeResponse",
	writeTree: "WriteTreeResponse",
};

test("protocol.schema.json defines every message this driver speaks", () => {
	for (const definition of [...Object.values(REQUEST_DEFINITION_BY_OP), ...Object.values(RESPONSE_DEFINITION_BY_OP), "Request"]) {
		expect(Object.keys(schemaDocument.definitions)).toContain(definition);
	}
});

// The whole example file, message by message, dispatched by the op of the
// request carrying the same id — so a response can never be checked against
// the wrong definition, and no example can be silently skipped.
for (const entry of all) {
	const id = entry.message.id as number;
	const op = REQUEST_OP_BY_ID[id];
	if (op === undefined) throw new Error(`no request op known for id ${id}`);
	const definition = (entry.direction === "request" ? REQUEST_DEFINITION_BY_OP : RESPONSE_DEFINITION_BY_OP)[op];
	if (definition === undefined) throw new Error(`no schema definition known for a ${entry.direction} with op ${op}`);
	const okness = entry.direction === "response" && entry.message.ok === false ? ", ok:false" : "";
	test(`example ${entry.direction} id ${id} (${op}${okness}) validates against ${definition}`, () => {
		expect(schemaVerdict(definition, entry.message)).toBe(true);
	});
}

interface Negative {
	readonly what: string;
	readonly definition: string;
	readonly message: Record<string, unknown>;
	readonly guard: (body: Record<string, unknown>) => unknown;
}

function capabilitiesWith(patch: Record<string, unknown>): Record<string, unknown> {
	return { ...response(1), ...patch };
}
function withoutKey(source: Record<string, unknown>, key: string): Record<string, unknown> {
	const { [key]: _removed, ...rest } = source;
	return rest;
}

// Every negative the guard tests above use, restated as a whole message so the
// schema sees the same thing an adapter would send. Both must reject each one.
const NEGATIVES: readonly Negative[] = [
	{ what: "capabilities with contractVersion 2", definition: "Capabilities", message: capabilitiesWith({ contractVersion: 2 }), guard: parseCapabilities },
	{ what: "capabilities with an unknown profile", definition: "Capabilities", message: capabilitiesWith({ profiles: ["xml"] }), guard: parseCapabilities },
	{ what: "capabilities with an extra field", definition: "Capabilities", message: capabilitiesWith({ extra: true }), guard: parseCapabilities },
	{ what: "capabilities without nodes", definition: "Capabilities", message: withoutKey(response(1), "nodes"), guard: parseCapabilities },
	{ what: "capabilities without formatVersions", definition: "Capabilities", message: withoutKey(response(1), "formatVersions"), guard: parseCapabilities },
	{ what: "capabilities with a non-string node", definition: "Capabilities", message: capabilitiesWith({ nodes: ["Type", 42] }), guard: parseCapabilities },
	{ what: "capabilities with no nodes at all", definition: "Capabilities", message: capabilitiesWith({ nodes: [] }), guard: parseCapabilities },
	{ what: "a decode response without warnings", definition: "DecodeResponse", message: withoutKey(response(2, 0), "warnings"), guard: parseDecodeResponse },
	{
		what: "a decode response whose diagnostic has no code",
		definition: "DecodeResponse",
		message: { ...response(2, 1), diagnostic: withoutKey(response(2, 1).diagnostic as Record<string, unknown>, "code") },
		guard: parseDecodeResponse,
	},
	{ what: "a decode response with an extra field", definition: "DecodeResponse", message: { ...response(2, 0), extra: true }, guard: parseDecodeResponse },
	{
		what: "a writeTree response whose file has no content",
		definition: "WriteTreeResponse",
		message: { ...response(4), files: [withoutKey((response(4).files as Record<string, unknown>[])[0] as Record<string, unknown>, "content")] },
		guard: parseWriteTreeResponse,
	},
	{
		what: "a writeTree response with an extra field",
		definition: "WriteTreeResponse",
		message: { ...response(4), extra: true },
		guard: parseWriteTreeResponse,
	},
	{ what: "a decode request with an extra field", definition: "DecodeRequest", message: { ...request(2), extra: true }, guard: parseRequest },
	{ what: "a request with an unknown op", definition: "Request", message: { id: 1, op: "frobnicate" }, guard: parseRequest },
];

for (const negative of NEGATIVES) {
	test(`${negative.what} is rejected by both the guard and the schema`, () => {
		expect(() => negative.guard(body(negative.message))).toThrow(ProtocolError);
		expect(schemaVerdict(negative.definition, negative.message)).not.toBe(true);
	});
}

// The envelope's own negatives cannot go through `body()` — parseEnvelope is
// what rejects them — so they are checked directly against the same schema
// definition the valid message uses.
for (const id of [0, -1]) {
	test(`an id of ${id} is rejected by both parseEnvelope and the schema`, () => {
		const message = { ...request(1), id };
		expect(() => parseEnvelope(JSON.stringify(message))).toThrow(`"id" must be at least 1, got ${id}`);
		expect(schemaVerdict("CapabilitiesRequest", message)).not.toBe(true);
	});
}

test("parseCapabilities rejects an empty nodes list", () => {
	expect(() => parseCapabilities(body(capabilitiesWith({ nodes: [] })))).toThrow('"nodes" must list at least one node kind');
});

// --- the root schema, for a validator given no entrypoint ---
//
// A validator that is handed a line with no idea what it should be validates
// against the document root, whose `oneOf` must therefore discriminate: exactly
// one branch may accept any given message. The failure answer to decode,
// readTree and writeTree is one shape, so it is one branch (ErrorResponse) and
// the two success shapes are their own; listing DecodeResponse and
// WriteTreeResponse at the root instead would make every error response match
// twice and fail the root schema while passing its own entrypoint.

const ROOT_BRANCHES: readonly string[] = schemaDocument.oneOf.map((branch) => branch.$ref.replace("#/definitions/", ""));

function rootBranchesAccepting(message: unknown): readonly string[] {
	return ROOT_BRANCHES.filter((definition) => schemaVerdict(definition, message) === true);
}

function rootValidator(): ValidateFunction {
	const compiled = ajv.getSchema(schemaDocument.$id);
	if (compiled === undefined) throw new Error("protocol.schema.json did not compile at its root");
	return compiled;
}

test("the root oneOf lists disjoint branches, not the op-dispatched response wrappers", () => {
	expect(ROOT_BRANCHES).toEqual(["Request", "Capabilities", "DecodeSuccess", "WriteTreeSuccess", "ErrorResponse"]);
});

for (const entry of all) {
	const id = entry.message.id as number;
	test(`example ${entry.direction} id ${id} validates against the root schema, matching exactly one branch`, () => {
		const validate = rootValidator();
		expect(validate(entry.message) === true ? true : ajv.errorsText(validate.errors)).toBe(true);
		expect(rootBranchesAccepting(entry.message)).toHaveLength(1);
	});
}

test("an error response matches the root schema exactly once, and both op entrypoints still accept it", () => {
	const errorResponse = { id: 4, ok: false, diagnostic: { code: "invalid_type", stage: "semantic", cursor: "/Library/def", message: "no" } };
	expect(rootBranchesAccepting(errorResponse)).toEqual(["ErrorResponse"]);
	const validate = rootValidator();
	expect(validate(errorResponse) === true ? true : ajv.errorsText(validate.errors)).toBe(true);
	// The wrappers a validator reaches by op name still cover both outcomes.
	expect(schemaVerdict("DecodeResponse", errorResponse)).toBe(true);
	expect(schemaVerdict("WriteTreeResponse", errorResponse)).toBe(true);
});

test("the entrypoint names a validator dispatches by op all still resolve", () => {
	for (const definition of ["Request", "Capabilities", "DecodeResponse", "WriteTreeResponse"]) {
		expect(() => validator(definition)).not.toThrow();
	}
});
