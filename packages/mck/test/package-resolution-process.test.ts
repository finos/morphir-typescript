// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { processResolutionTestee } from "../src/package/process.ts";
import { loadResolutionKit } from "../src/package/resolution/corpus.ts";
import { packageExitCode, runResolutionKit } from "../src/package/run.ts";
import { writeResolutionPackage } from "./package-resolution-fixture.ts";

const adapter = path.resolve(import.meta.dir, "../src/adapter.ts");

async function runAdapter(args: readonly string[], stdin = ""): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
	const child = Bun.spawn([process.execPath, adapter, ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
	child.stdin.write(stdin);
	child.stdin.end();
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	return { code, stdout, stderr };
}

async function withKit<T>(use: (kit: ReturnType<typeof loadResolutionKit>) => Promise<T>): Promise<T> {
	const directory = mkdtempSync(path.join(os.tmpdir(), "mck-resolution-process-"));
	try {
		return await use(loadResolutionKit(writeResolutionPackage(directory)));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

describe("resolution process transport", () => {
	test.each([
		{ args: ["--contract", "future"] },
		{ args: ["--suite", "ir", "--contract", "future"] },
		{ args: ["--contract", "future", "--suite", "package"] },
		{ args: ["--suite", "future"] },
	])("rejects unsupported or misplaced adapter selectors: $args", async ({ args }) => {
		const result = await runAdapter(args);
		expect(result.code).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("usage:");
	});

	test("explicit IR suite selection preserves protocol v1", async () => {
		const result = await runAdapter(["--suite", "ir"], '{"id":1,"op":"capabilities"}\n{"id":2,"op":"exit"}\n');
		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout.trim())).toMatchObject({ id: 1, contractVersion: 1, binding: "morphir-typescript" });
	});

	test("runs the fixed corpus through the executable adapter", async () => {
		await withKit(async (kit) => {
			const report = await runResolutionKit(
				kit,
				processResolutionTestee([process.execPath, adapter, "--suite", "package", "--contract", "0.1.0-draft.2"], { timeoutMs: 5000 }),
			);
			expect(packageExitCode(report)).toBe(0);
			expect(report.records).toHaveLength(2);
		});
	});

	test("wrong response ids and unknown response fields are protocol errors", async () => {
		const digest = `sha256:${"0".repeat(64)}`;
		for (const response of [
			"console.log(JSON.stringify({id:99,ok:true,graph:{}}))",
			"console.log(JSON.stringify({id:request.id,ok:true,graph:{},ignored:true}))",
			"console.log(JSON.stringify({id:request.id,ok:true,graph:{}}))",
			`console.log(JSON.stringify({id:request.id,ok:true,graph:{root:{packagePath:"example.com/app/root",version:"1.0.0"},nodes:[{release:{packagePath:"example.com/app/root",version:"1.0.0"},irPackageName:"example/app",manifestDigest:"${digest}",contentDigest:"${digest}",bindings:[{irPackageName:"example/wrong",target:{packagePath:"example.com/lib/child",version:"1.0.0"}}]},{release:{packagePath:"example.com/lib/child",version:"1.0.0"},irPackageName:"example/child",manifestDigest:"${digest}",contentDigest:"${digest}",bindings:[]}]}}))`,
		]) {
			const program = `
				const readline=require("node:readline");
				const rl=readline.createInterface({input:process.stdin});
				rl.on("line",line=>{const request=JSON.parse(line);if(request.op==="capabilities")console.log(JSON.stringify({id:request.id,suite:"package",contractVersion:"0.1.0-draft.2",implementation:"fake",implementationVersion:"1",operations:["resolve-library"],profiles:["flat-library"]}));else {${response}}});
			`;
			await withKit(async (kit) => {
				const report = await runResolutionKit(kit, processResolutionTestee([process.execPath, "-e", program], { timeoutMs: 200 }));
				expect(packageExitCode(report)).toBe(1);
				expect(report.records[0]?.result).toBe("kit-error");
			});
		}
	});

	test("abnormal shutdown cannot report success", async () => {
		const program = `
			const readline=require("node:readline");
			const rl=readline.createInterface({input:process.stdin});
			rl.on("line",line=>{const request=JSON.parse(line);if(request.op==="exit")process.exit(7);if(request.op==="capabilities")console.log(JSON.stringify({id:request.id,suite:"package",contractVersion:"0.1.0-draft.2",implementation:"fake",implementationVersion:"1",operations:["resolve-library"],profiles:["flat-library"]}));else console.log(JSON.stringify({id:request.id,ok:false,diagnostic:{code:"invalid-input",violations:[{pointer:"",rule:"malformed-json"}]}}));});
		`;
		await withKit(async (kit) => {
			const malformed = kit.cases.find((entry) => entry.request.input === "{");
			if (!malformed) throw new Error("missing literal malformed-input case");
			const report = await runResolutionKit({ ...kit, cases: [malformed] }, processResolutionTestee([process.execPath, "-e", program], { timeoutMs: 1000 }));
			expect(report.records[0]?.result).toBe("pass");
			expect(packageExitCode(report)).toBe(1);
			expect(report.records.at(-1)).toMatchObject({ caseId: "package-adapter-close", result: "kit-error" });
		});
	});

	test("adapter stderr does not contaminate protocol stdout", async () => {
		const program = `
			const readline=require("node:readline");
			const rl=readline.createInterface({input:process.stdin});
			rl.on("line",line=>{const request=JSON.parse(line);if(request.op==="exit")process.exit(0);console.error("adapter diagnostic");console.log(JSON.stringify({id:request.id,suite:"package",contractVersion:"0.1.0-draft.2",implementation:"fake",implementationVersion:"1",operations:["resolve-library"],profiles:["flat-library"]}));});
		`;
		const testee = processResolutionTestee([process.execPath, "-e", program], { timeoutMs: 1000 });
		expect(await testee.capabilities()).toMatchObject({ implementation: "fake" });
		await expect(testee.close()).resolves.toBeUndefined();
	});
});
