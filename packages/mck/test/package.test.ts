// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import packageProtocolSchema from "../package-protocol.schema.json";
import type { PackageRequest } from "../src/package/contract.ts";
import { parsePackageCapabilities, parsePackageRequest, parsePackageResponse } from "../src/package/protocol.ts";
import { referencePackageTestee } from "../src/package/reference.ts";

const emptyHash = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const objectHash = "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";

async function runAdapter(stdin: string): Promise<{ readonly code: number; readonly stdout: string }> {
	const child = Bun.spawn([process.execPath, path.resolve(import.meta.dir, "../src/adapter.ts"), "--suite", "package"], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	child.stdin.write(stdin);
	child.stdin.end();
	return { code: await child.exited, stdout: await new Response(child.stdout).text() };
}

describe("package reference implementation", () => {
	test("library integrity rejects absent roots and malformed documents", async () => {
		expect(
			await referencePackageTestee().execute({
				op: "verify-library-set",
				lock: '{"root":"n9","nodes":{}}',
				libraries: [],
				schemas: { manifest: {}, lock: {} },
			}),
		).toEqual({ ok: true, valid: false });
	});

	test("normalizes metadata canonically and hashes exact bytes", async () => {
		const reference = referencePackageTestee();
		expect(await reference.execute({ op: "normalize", input: " { }\n" })).toMatchObject({ ok: true, canonical: "{}", manifestDigest: objectHash });
		expect(await reference.execute({ op: "normalize", input: '{"2":"b","10":"a"}' })).toMatchObject({ canonical: '{"10":"a","2":"b"}' });
		expect(await reference.execute({ op: "hash-bytes", hex: "" })).toEqual({ ok: true, digest: emptyHash });
		expect(await reference.execute({ op: "hash-bytes", hex: "0a" })).not.toEqual({ ok: true, digest: emptyHash });
	});

	test.each(['{"x":"a","\\u0078":"b"}', "\uFEFF{}", '"é"', "null", "4", '"\\n"', `${"[".repeat(65)}"x"${"]".repeat(65)}`])(
		"rejects invalid metadata: %s",
		async (input) => {
			expect(await referencePackageTestee().execute({ op: "normalize", input })).toEqual({ ok: false, error: "invalid-document" });
		},
	);

	test("accepts metadata at the depth limit", async () => {
		expect(await referencePackageTestee().execute({ op: "normalize", input: `${"[".repeat(64)}"x"${"]".repeat(64)}` })).toMatchObject({ ok: true });
	});
});

describe("package protocol and adapter", () => {
	test("the published schema accepts capabilities, requests, and implementation responses", async () => {
		const validate = new Ajv2020().compile(packageProtocolSchema);
		const reference = referencePackageTestee();
		const schemas = { manifest: { type: "object" }, lock: { type: "object" } };
		const requests: readonly PackageRequest[] = [
			{ op: "normalize", input: "{}" },
			{ op: "hash-bytes", hex: "" },
			{ op: "validate", artifact: "manifest", input: "{}", schemas },
			{ op: "verify-library-set", lock: "{}", libraries: [], schemas },
		];
		expect(validate({ id: 1, ...(await reference.capabilities()) })).toBe(true);
		for (const request of requests) {
			expect(validate({ id: 2, ...request })).toBe(true);
			expect(validate({ id: 2, ...(await reference.execute(request)) })).toBe(true);
		}
		expect(validate({ id: 3, op: "hash-bytes", hex: "xx" })).toBe(false);
	});

	test("the executable adapter serves the draft.1 implementation", async () => {
		const result = await runAdapter('{"id":1,"op":"capabilities"}\n{"id":2,"op":"normalize","input":"{}"}\n{"id":3,"op":"exit"}\n');
		expect(result.code).toBe(0);
		const responses = result.stdout
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(responses[0]).toMatchObject({ id: 1, suite: "package", contractVersion: "0.1.0-draft.1", implementation: "morphir-typescript" });
		expect(responses[1]).toMatchObject({ id: 2, ok: true, canonical: "{}", manifestDigest: objectHash });
	});

	test("in-process requests reject malformed bytes just like the adapter", async () => {
		await expect(referencePackageTestee().execute({ op: "hash-bytes", hex: "zz" })).rejects.toThrow();
	});

	test("IR capabilities are never mistaken for package capabilities", () => {
		expect(() => parsePackageCapabilities({ contractVersion: 1, binding: "typescript", operations: [] })).toThrow();
	});

	test.each([{ op: "decode" }, { op: "hash-bytes", hex: "z1" }, { op: "normalize", input: "{}", ignored: true }])(
		"rejects malformed protocol requests",
		(request) => {
			expect(() => parsePackageRequest(request)).toThrow();
		},
	);

	test("does not confuse schema rejection with invalid normalization", () => {
		expect(() => parsePackageResponse({ ok: false, error: "invalid-document" }, "validate")).toThrow();
	});
});
