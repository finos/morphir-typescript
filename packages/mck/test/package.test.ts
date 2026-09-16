// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import packageProtocolSchema from "../package-protocol.schema.json";
import packageReportSchema from "../package-report.schema.json";
import { loadPackageKitFromFiles } from "../src/package/corpus.ts";
import { processPackageTestee } from "../src/package/process.ts";
import { parsePackageCapabilities, parsePackageRequest, parsePackageResponse } from "../src/package/protocol.ts";
import { referencePackageTestee } from "../src/package/reference.ts";
import { packageExitCode, runPackageKit } from "../src/package/run.ts";

const emptyHash = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const objectHash = "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
const version = "0.1.0-draft.1";
export function packageFiles(): Map<string, Uint8Array> {
	const files = new Map<string, Uint8Array>();
	const put = (name: string, value: unknown) => files.set(name, new TextEncoder().encode(JSON.stringify(value)));
	put("mck/digest-vectors.json", {
		formatVersion: version,
		cases: [{ id: "duplicate", input: '{"a":"x","a":"y"}', error: "invalid-document" }],
		byteCases: [{ id: "empty", hex: "", digest: emptyHash }],
	});
	put("mck/schema-cases.json", { formatVersion: version, cases: [{ id: "schema", schema: "manifest", fixture: "eligibility", expected: "accept" }] });
	put("mck/library-cases.json", { formatVersion: version, cases: [{ id: "invalid-library", expected: "reject" }] });
	put("mck/fixtures/two-libraries/eligibility/ir.json", {});
	put("mck/fixtures/two-libraries/loan-rules/ir.json", {});
	put("schemas/library-manifest.schema.json", { $schema: "https://json-schema.org/draft/2020-12/schema", $id: "https://example.com/manifest", type: "object" });
	put("schemas/lock-core.schema.json", { $schema: "https://json-schema.org/draft/2020-12/schema", $id: "https://example.com/lock", type: "object" });
	for (const name of ["eligibility/manifest.json", "loan-rules/manifest.json", "lock-core.json"]) put(`mck/fixtures/two-libraries/${name}`, {});
	return files;
}

describe("package reference", () => {
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
	test("normalizes sorted metadata and hashes exact bytes", async () => {
		const ref = referencePackageTestee();
		expect(await ref.execute({ op: "normalize", input: " { }\n" })).toMatchObject({ ok: true, canonical: "{}", manifestDigest: objectHash });
		expect(await ref.execute({ op: "normalize", input: '{"2":"b","10":"a"}' })).toMatchObject({ canonical: '{"10":"a","2":"b"}' });
		expect(await ref.execute({ op: "hash-bytes", hex: "" })).toEqual({ ok: true, digest: emptyHash });
		expect(await ref.execute({ op: "hash-bytes", hex: "0a" })).not.toEqual({ ok: true, digest: emptyHash });
	});
	test.each(['{"x":"a","\\u0078":"b"}', "\uFEFF{}", '"é"', "null", "4", '"\\n"', `${"[".repeat(65)}"x"${"]".repeat(65)}`])(
		"rejects invalid metadata: %s",
		async (input) => {
			expect(await referencePackageTestee().execute({ op: "normalize", input })).toEqual({ ok: false, error: "invalid-document" });
		},
	);
	test("accepts depth 64", async () => {
		expect(await referencePackageTestee().execute({ op: "normalize", input: `${"[".repeat(64)}"x"${"]".repeat(64)}` })).toMatchObject({ ok: true });
	});
});

describe("package adapter and CLI", () => {
	test.each([{ args: ["--help"] }, { args: ["package", "--help"] }, { args: ["package", "run", "--help"] }])(
		"Effect CLI discovers package commands: %j",
		async ({ args }) => {
			const child = Bun.spawn([process.execPath, path.resolve(import.meta.dir, "../src/cli.ts"), ...args], { stdout: "pipe", stderr: "pipe" });
			const output = await new Response(child.stdout).text();
			expect(await child.exited).toBe(0);
			expect(output).toContain("package");
		},
	);
	test("published schemas accept every request, response and the report", async () => {
		const validateProtocol = new Ajv2020().compile(packageProtocolSchema);
		const validateReport = new Ajv2020().compile(packageReportSchema);
		const testee = referencePackageTestee();
		const kit = loadPackageKitFromFiles(packageFiles());
		expect(validateProtocol({ id: 1, ...(await testee.capabilities()) })).toBe(true);
		for (const entry of kit.cases) {
			expect(validateProtocol({ id: 2, ...entry.request })).toBe(true);
			expect(validateProtocol({ id: 2, ...(await testee.execute(entry.request)) })).toBe(true);
		}
		expect(validateReport(await runPackageKit(kit, testee))).toBe(true);
		expect(validateReport(await runPackageKit(loadPackageKitFromFiles(new Map()), testee))).toBe(true);
		expect(validateProtocol({ id: 3, op: "hash-bytes", hex: "xx" })).toBe(false);
		expect(validateProtocol({ id: 0, op: "exit" })).toBe(false);
	});
	test("in-process requests reject malformed bytes just like adapters", async () => {
		await expect(referencePackageTestee().execute({ op: "hash-bytes", hex: "zz" })).rejects.toThrow();
	});
	test("IR capabilities are never mistaken for package capabilities", () => {
		expect(() => parsePackageCapabilities({ contractVersion: 1, binding: "typescript", operations: [] })).toThrow();
	});
	test("wrong adapter response ids cannot pass", async () => {
		const testee = processPackageTestee([process.execPath, "-e", 'process.stdin.on("data", () => process.stdout.write(JSON.stringify({id:99})+"\\n"))'], {
			timeoutMs: 100,
		});
		try {
			expect(packageExitCode(await runPackageKit(loadPackageKitFromFiles(packageFiles()), testee))).toBe(1);
		} finally {
			await testee.close();
		}
	});
	test("an abnormal adapter exit after valid responses cannot report success", async () => {
		const referencePath = path.resolve(import.meta.dir, "../src/package/reference.ts");
		const program = `import {referencePackageTestee} from ${JSON.stringify(referencePath)}; const ref=referencePackageTestee(); for await (const line of console) { const {id,...request}=JSON.parse(line); if(request.op==='exit') process.exit(7); const response=request.op==='capabilities'?await ref.capabilities():await ref.execute(request); console.log(JSON.stringify({id,...response})); }`;
		const testee = processPackageTestee([process.execPath, "-e", program], { timeoutMs: 1000 });
		const report = await runPackageKit(loadPackageKitFromFiles(packageFiles()), testee);
		expect(packageExitCode(report)).toBe(1);
		expect(report.records.at(-1)?.result).toBe("kit-error");
	});
	test("driver closes testees even when the corpus is malformed", async () => {
		let closed = false;
		await runPackageKit(loadPackageKitFromFiles(new Map()), {
			...referencePackageTestee(),
			close: async () => {
				closed = true;
			},
		});
		expect(closed).toBe(true);
	});
	test("same fixed corpus passes the executable adapter", async () => {
		const testee = processPackageTestee([process.execPath, path.resolve(import.meta.dir, "../src/adapter.ts"), "--suite", "package"], { timeoutMs: 5000 });
		try {
			const report = await runPackageKit(loadPackageKitFromFiles(packageFiles()), testee);
			expect(packageExitCode(report)).toBe(0);
			expect(report.testee?.implementation).toBe("morphir-typescript");
		} finally {
			await testee.close();
		}
	});
	test("CLI writes a versioned report using the supplied corpus", async () => {
		const directory = mkdtempSync(path.join(os.tmpdir(), "mck-package-"));
		try {
			for (const [name, bytes] of packageFiles()) {
				const file = path.join(directory, name);
				mkdirSync(path.dirname(file), { recursive: true });
				writeFileSync(file, bytes);
			}
			const report = path.join(directory, "report.json");
			const child = Bun.spawn(
				[process.execPath, path.resolve(import.meta.dir, "../src/cli.ts"), "package", "run", "--kit", path.join(directory, "mck"), "--report", report],
				{ stdout: "pipe", stderr: "pipe" },
			);
			expect(await child.exited).toBe(0);
			expect(JSON.parse(readFileSync(report, "utf8"))).toMatchObject({ suite: "package", contractVersion: version });
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
	test.each([{ op: "decode" }, { op: "hash-bytes", hex: "z1" }, { op: "normalize", input: "{}", ignored: true }])(
		"rejects malformed protocol requests",
		(request) => {
			expect(() => parsePackageRequest(request)).toThrow();
		},
	);
	test("schema rejection is not interchangeable with invalid normalization", () => {
		expect(() => parsePackageResponse({ ok: false, error: "invalid-document" }, "validate")).toThrow();
	});
});

describe("shared package runner", () => {
	test("malformed schemas, unknown fixtures, and invalid mutation targets are kit errors", async () => {
		for (const [file, value] of [
			["schemas/library-manifest.schema.json", { type: "not-a-type" }],
			["mck/schema-cases.json", { formatVersion: version, cases: [{ id: "s", schema: "manifest", fixture: "../../outside", expected: "reject" }] }],
			[
				"mck/schema-cases.json",
				{ formatVersion: version, cases: [{ id: "s", schema: "manifest", fixture: "eligibility", expected: "reject", remove: ["absent"] }] },
			],
			[
				"mck/schema-cases.json",
				{
					formatVersion: version,
					cases: [{ id: "s", schema: "manifest", fixture: "eligibility", expected: "reject", replace: { path: ["__proto__", "x"], value: "polluted" } }],
				},
			],
		] as const) {
			const files = packageFiles();
			files.set(file, new TextEncoder().encode(JSON.stringify(value)));
			const report = await runPackageKit(loadPackageKitFromFiles(files), referencePackageTestee());
			expect(report.records[0]?.result).toBe("kit-error");
			expect(packageExitCode(report)).toBe(1);
		}
	});
	test("corpus hash includes payload bytes and schemas", () => {
		const files = packageFiles();
		const original = loadPackageKitFromFiles(files).contentHash;
		files.set("mck/fixtures/two-libraries/eligibility/ir.json", new TextEncoder().encode("{}\n"));
		expect(loadPackageKitFromFiles(files).contentHash).not.toBe(original);
	});
	test("testee mutation cannot alter later corpus requests", async () => {
		const kit = loadPackageKitFromFiles(packageFiles());
		const before = structuredClone(kit.cases);
		const reference = referencePackageTestee();
		await runPackageKit(kit, {
			...reference,
			execute: async (request) => {
				if (request.op === "validate") Object.assign(request.schemas.manifest, { type: "null" });
				return reference.execute(request);
			},
		});
		expect(kit.cases).toEqual(before);
	});
	test("compares fixed expectations and records package provenance", async () => {
		const kit = loadPackageKitFromFiles(packageFiles());
		const report = await runPackageKit(kit, referencePackageTestee());
		expect(report.suite).toBe("package");
		expect(report.kit.contentHash).toMatch(/^sha256-/);
		expect(report.records.map((r) => r.result)).toEqual(["pass", "pass", "pass", "pass"]);
		expect(packageExitCode(report)).toBe(0);
	});
	test("tampered expectation fails; implementation never supplies expectations", async () => {
		const files = packageFiles();
		files.set(
			"mck/digest-vectors.json",
			new TextEncoder().encode(
				JSON.stringify({
					formatVersion: version,
					cases: [{ id: "invalid", input: "null", error: "invalid-document" }],
					byteCases: [{ id: "wrong", hex: "00", digest: emptyHash }],
				}),
			),
		);
		const report = await runPackageKit(loadPackageKitFromFiles(files), referencePackageTestee());
		expect(report.records.find((r) => r.caseId === "wrong")?.result).toBe("fail");
		expect(packageExitCode(report)).toBe(1);
	});
	test("missing capabilities cannot yield compatibility success", async () => {
		const ref = referencePackageTestee();
		const report = await runPackageKit(loadPackageKitFromFiles(packageFiles()), {
			...ref,
			capabilities: async () => ({ ...(await ref.capabilities()), operations: [] }),
		});
		expect(report.records.every((r) => r.result === "skipped")).toBe(true);
		expect(packageExitCode(report)).toBe(1);
	});
	test("execution errors are not expected rejections", async () => {
		const report = await runPackageKit(loadPackageKitFromFiles(packageFiles()), {
			...referencePackageTestee(),
			execute: async () => {
				throw new Error("broken adapter");
			},
		});
		expect(report.records.some((r) => r.result === "pass")).toBe(false);
		expect(packageExitCode(report)).toBe(1);
	});
	test.each([
		' {"formatVersion":"0.1.0-draft.1","cases":[],"byteCases":[]}',
		'{"formatVersion":"future","cases":[],"byteCases":[]}',
		'{"formatVersion":"0.1.0-draft.1","cases":[],"cases":[],"byteCases":[]}',
		JSON.stringify({ formatVersion: version, cases: [{ id: "x", input: "null", error: "invalid-document", typo: true }], byteCases: [] }),
		JSON.stringify({
			formatVersion: version,
			cases: [
				{ id: "x", input: "null", error: "invalid-document" },
				{ id: "x", input: "null", error: "invalid-document" },
			],
			byteCases: [],
		}),
	])("malformed corpus is a kit error, never a vacuous pass", async (text) => {
		const files = packageFiles();
		files.set("mck/digest-vectors.json", new TextEncoder().encode(text));
		const report = await runPackageKit(loadPackageKitFromFiles(files), referencePackageTestee());
		expect(report.records[0]?.result).toBe("kit-error");
		expect(packageExitCode(report)).toBe(1);
	});
});
