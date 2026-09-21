// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import protocolSchema from "../package-resolution-protocol.schema.json";
import { referenceResolutionTestee } from "../src/package/reference.ts";
import type { ResolutionResponse } from "../src/package/resolution/contract.ts";
import { parseResolutionResponse } from "../src/package/resolution/protocol.ts";

const adapter = path.resolve(import.meta.dir, "../src/adapter.ts");

async function run(command: readonly string[], stdin = ""): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
	const child = Bun.spawn([...command], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
	child.stdin.write(stdin);
	child.stdin.end();
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	return { code, stdout, stderr };
}

function lines(output: string): unknown[] {
	return output
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

const digest = `sha256:${"0".repeat(64)}`;
const rootRelease = { packagePath: "example.com/app/root", version: "1.0.0" };
const childRelease = { packagePath: "example.com/lib/child", version: "1.0.0" };
const sharedRelease = { packagePath: "example.com/lib/shared", version: "1.0.0" };

function successGraph(bindingName = "example/child") {
	return {
		ok: true as const,
		graph: {
			root: rootRelease,
			nodes: [
				{
					release: rootRelease,
					irPackageName: "example/app",
					manifestDigest: digest,
					contentDigest: digest,
					bindings: [{ irPackageName: bindingName, target: childRelease }],
				},
				{
					release: childRelease,
					irPackageName: "example/child",
					manifestDigest: digest,
					contentDigest: digest,
					bindings: [],
				},
			],
		},
	};
}

interface WitnessBindingFixture {
	irPackageName: string;
	targetOccurrence: string[];
}

interface WitnessNodeFixture {
	occurrence: string[];
	release: { packagePath: string; version: string };
	bindings: WitnessBindingFixture[];
}

function witnessResult(nodes: readonly WitnessNodeFixture[]): ResolutionResponse {
	return {
		ok: false as const,
		diagnostic: {
			code: "unsupported-capability" as const,
			requiredCapabilities: ["graph-aware-coexistence"] as const,
			changedPins: [],
			witness: { nodes },
		},
	};
}

function sharedSiblingWitness(): WitnessNodeFixture[] {
	return [
		{
			occurrence: [],
			release: rootRelease,
			bindings: [
				{ irPackageName: "example/left", targetOccurrence: ["example/left"] },
				{ irPackageName: "example/right", targetOccurrence: ["example/right"] },
			],
		},
		{ occurrence: ["example/left"], release: sharedRelease, bindings: [] },
		{ occurrence: ["example/right"], release: sharedRelease, bindings: [] },
	];
}

function witnessNode(nodes: WitnessNodeFixture[], index: number): WitnessNodeFixture {
	const node = nodes[index];
	if (node === undefined) throw new Error(`missing witness node ${index}`);
	return node;
}

function witnessBinding(node: WitnessNodeFixture, index: number): WitnessBindingFixture {
	const binding = node.bindings[index];
	if (binding === undefined) throw new Error(`missing witness binding ${index}`);
	return binding;
}

describe("versioned package protocol routing", () => {
	test.each([
		{ args: ["--contract", "future"] },
		{ args: ["--suite", "ir", "--contract", "future"] },
		{ args: ["--contract", "future", "--suite", "package"] },
		{ args: ["--suite", "future"] },
	])("rejects unsupported or misplaced adapter selectors: $args", async ({ args }) => {
		const result = await run([process.execPath, adapter, ...args]);
		expect(result.code).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("usage:");
	});

	test("explicit IR suite selection preserves protocol v1", async () => {
		const result = await run([process.execPath, adapter, "--suite", "ir"], '{"id":1,"op":"capabilities"}\n{"id":2,"op":"exit"}\n');
		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout.trim())).toMatchObject({ id: 1, contractVersion: 1, binding: "morphir-typescript" });
	});

	test("installed schema accepts the implementation's requests, results, and capabilities", async () => {
		const protocol = new Ajv2020().compile(protocolSchema);
		const testee = referenceResolutionTestee();
		expect(protocol({ id: 1, ...(await testee.capabilities()) })).toBe(true);
		const request = { op: "resolve-library" as const, input: "{" };
		expect(protocol({ id: 2, ...request })).toBe(true);
		expect(protocol({ id: 2, ...(await testee.execute(request)) })).toBe(true);
		expect(protocol({ id: 2, ok: true, graph: {}, ignored: true })).toBe(false);
	});

	test("rejects an update-scope conflict without a changed pin", () => {
		expect(() =>
			parseResolutionResponse(
				{
					ok: false,
					diagnostic: {
						code: "update-scope-conflict",
						changedPins: [],
						witness: { nodes: [{ occurrence: [], release: { packagePath: "example.com/app/root", version: "1.0.0" }, bindings: [] }] },
					},
				},
				"resolve-library",
			),
		).toThrow();
	});

	test("a graph binding name must match its target node", () => {
		expect(parseResolutionResponse(successGraph(), "resolve-library")).toEqual(successGraph());
		expect(() => parseResolutionResponse(successGraph("example/wrong"), "resolve-library")).toThrow(/binding/i);
	});

	test("a witness permits the same release at distinct sibling occurrences", () => {
		const result = witnessResult(sharedSiblingWitness());
		expect(parseResolutionResponse(result, "resolve-library")).toEqual(result);
	});

	test.each([
		["missing root occurrence", () => sharedSiblingWitness().slice(1)],
		[
			"duplicate occurrence",
			() => {
				const nodes = sharedSiblingWitness();
				return [...nodes, structuredClone(witnessNode(nodes, 1))];
			},
		],
		[
			"dangling binding child",
			() => {
				const nodes = sharedSiblingWitness();
				return [witnessNode(nodes, 0)];
			},
		],
		[
			"noncanonical target occurrence",
			() => {
				const nodes = sharedSiblingWitness();
				witnessBinding(witnessNode(nodes, 0), 0).targetOccurrence = ["example/right"];
				return nodes;
			},
		],
		[
			"duplicate binding name",
			() => {
				const nodes = sharedSiblingWitness();
				witnessNode(nodes, 0).bindings[1] = { irPackageName: "example/left", targetOccurrence: ["example/left"] };
				return nodes;
			},
		],
		[
			"unreachable occurrence",
			() => {
				const nodes = sharedSiblingWitness();
				witnessNode(nodes, 0).bindings = [];
				return [witnessNode(nodes, 0), witnessNode(nodes, 1)];
			},
		],
		[
			"release repeated on an ancestor path",
			() => {
				const nodes = sharedSiblingWitness();
				const root = witnessNode(nodes, 0);
				root.bindings = [witnessBinding(root, 0)];
				witnessNode(nodes, 1).release = rootRelease;
				return [root, witnessNode(nodes, 1)];
			},
		],
	] as const)("rejects a witness with %s", (_name, nodes) => {
		expect(() => parseResolutionResponse(witnessResult(nodes()), "resolve-library")).toThrow();
	});

	test("draft.1 rejects resolve-library", async () => {
		const result = await run(
			[process.execPath, adapter, "--suite", "package", "--contract", "0.1.0-draft.1"],
			'{"id":1,"op":"resolve-library","input":"{}"}\n',
		);
		expect(result.code).not.toBe(0);
		expect(result.stdout).toBe("");
	});

	test("draft.2 accepts resolve-library and declares the flat-library profile", async () => {
		const result = await run(
			[process.execPath, adapter, "--suite", "package", "--contract", "0.1.0-draft.2"],
			'{"id":1,"op":"capabilities"}\n{"id":2,"op":"resolve-library","input":"{}"}\n{"id":3,"op":"exit"}\n',
		);
		expect(result.code).toBe(0);
		expect(lines(result.stdout)).toEqual([
			{
				id: 1,
				suite: "package",
				contractVersion: "0.1.0-draft.2",
				implementation: "morphir-typescript",
				implementationVersion: expect.any(String),
				operations: ["resolve-library"],
				profiles: ["flat-library"],
			},
			{
				id: 2,
				ok: false,
				diagnostic: { code: "invalid-input", violations: expect.any(Array) },
			},
		]);
	});

	test("omitting the package adapter contract preserves draft.1", async () => {
		const result = await run([process.execPath, adapter, "--suite", "package"], '{"id":1,"op":"capabilities"}\n{"id":2,"op":"exit"}\n');
		expect(result.code).toBe(0);
		expect(lines(result.stdout)[0]).toMatchObject({ contractVersion: "0.1.0-draft.1" });
	});

	test("omitting adapter arguments preserves the IR protocol", async () => {
		const result = await run([process.execPath, adapter], '{"id":1,"op":"capabilities"}\n{"id":2,"op":"exit"}\n');
		expect(result.code).toBe(0);
		expect(lines(result.stdout)[0]).toMatchObject({ id: 1, contractVersion: 1, binding: "morphir-typescript" });
	});
});
