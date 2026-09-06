// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";

const root = path.resolve(import.meta.dir, "../..");

interface MiseTask {
	readonly name: string;
	readonly depends: readonly string[];
	readonly file: string | null;
}

async function commandOutput(command: readonly string[]): Promise<string> {
	const child = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (exitCode !== 0) throw new Error(`${command.join(" ")} failed:\n${stderr}`);
	return stdout;
}

function markdownSection(source: string, heading: string): string {
	const tree = fromMarkdown(source);
	const start = tree.children.findIndex((node) => node.type === "heading" && node.depth === 2 && nodeText(node) === heading);
	if (start === -1) throw new Error(`missing Markdown section: ${heading}`);
	const end = tree.children.findIndex((node, index) => index > start && node.type === "heading" && node.depth <= 2);
	return tree.children
		.slice(start + 1, end === -1 ? undefined : end)
		.map(nodeText)
		.join("\n");
}

function nodeText(node: { readonly value?: string; readonly children?: readonly unknown[] }): string {
	if (node.value !== undefined) return node.value;
	return (node.children ?? []).map((child) => nodeText(child as { readonly value?: string; readonly children?: readonly unknown[] })).join("");
}

function taskInvocation(source: string): string {
	const matches = source.match(/^await exec\(.+\);$/gm) ?? [];
	if (matches.length !== 1) throw new Error(`expected one top-level exec invocation, received ${matches.length}`);
	return matches[0] as string;
}

describe("release automation contract", () => {
	test("pins the required toolchain versions", async () => {
		const config = Bun.TOML.parse(await readFile(path.join(root, "mise.toml"), "utf8")) as { tools: Record<string, string> };
		expect(config.tools.bun).toBe("1.4.2");
		expect(config.tools.node).toBe("20.20.2");
		expect(config.tools.actionlint).toBe("1.7.12");
	});

	test("registers executable package, workflow, and artifact tasks in the CI graph", async () => {
		const tasks = JSON.parse(await commandOutput(["mise", "tasks", "--json"])) as MiseTask[];
		const byName = new Map(tasks.map((task) => [task.name, task]));

		expect(byName.get("check:package")?.depends).toEqual(["setup"]);
		expect(byName.get("check:workflows")?.depends).toEqual([]);
		expect(byName.get("release:artifact")?.depends).toEqual(["setup"]);
		for (const dependency of ["check:lint", "check:typecheck", "test", "check:package", "check:workflows"])
			expect(byName.get("ci")?.depends).toContain(dependency);

		const sources = new Map<string, string>();
		for (const name of ["check:package", "check:workflows", "release:artifact"]) {
			const file = byName.get(name)?.file;
			expect(file).toBeString();
			await access(file as string, constants.X_OK);
			const source = await readFile(file as string, "utf8");
			sources.set(name, source);
			expect(source).toMatch(/^#!\/usr\/bin\/env bun\n\/\/ Copyright 2026 FINOS\n\/\/ SPDX-License-Identifier: Apache-2\.0\n/);
		}

		expect(taskInvocation(sources.get("check:package") as string)).toBe('await exec(["bun", "scripts/release/cli.ts", "artifact", ".dev/out/package-check"]);');
		expect(taskInvocation(sources.get("check:workflows") as string)).toBe('await exec(["actionlint"]);');
		expect(taskInvocation(sources.get("release:artifact") as string)).toBe(
			'await exec(["bun", "scripts/release/cli.ts", "artifact", ...process.argv.slice(2)]);',
		);
	});

	test("keeps workflow orchestration as one local CI invocation", async () => {
		const workflow = await readFile(path.join(root, ".github/workflows/ci.yml"), "utf8");
		const invocations = workflow.match(/\brun:\s*mise run ci\s*$/gm) ?? [];
		expect(invocations).toHaveLength(1);
		const jobName = workflow.match(/^[ \t]+name: (.+)$/m)?.[1];
		expect(jobName?.toLowerCase()).toContain("package");
		expect(jobName?.toLowerCase()).toContain("workflow");
		expect(workflow).not.toMatch(/^\s+run:\s*(?:bun|actionlint|npm)\b/m);
	});

	test("documents package status, suite releases, and local release commands", async () => {
		const readme = await readFile(path.join(root, "README.md"), "utf8");
		const status = markdownSection(readme, "Project status");
		expect(status).toContain("@finos/morphir-ir");
		expect(status).toContain("0.0.1");
		expect(status).toContain("@finos/morphir-mck");
		expect(status).toContain("private");
		expect(status).toContain("suite version");

		const development = markdownSection(readme, "Development");
		for (const command of [
			"mise run check:package",
			"mise run check:workflows",
			"mise run release:prepare",
			"mise run release:validate",
			"mise run release:artifact",
		])
			expect(development).toContain(command);
		expect(development).toContain("Bun.build");
		expect(development).toContain("Node.js 20");
	});

	test("documents the tag-driven publishing and recovery contract", async () => {
		const guide = await readFile(path.join(root, ".github/workflows/README.md"), "utf8");
		const publishing = markdownSection(guide, "Publishing");
		for (const expected of [
			"ORG_MORPHIR_NPM_TOKEN",
			"mise run release:prepare -- 0.0.1",
			"mise run ci",
			'git tag -s v0.0.1 -m "Release 0.0.1"',
			"git push origin v0.0.1",
			"provenance",
			"GitHub Release",
			"immutable",
			"main",
		])
			expect(publishing).toContain(expected);
		expect(publishing).toMatch(/does not (?:commit|create commits), tag, or push/i);
		expect(publishing).toContain("publishes only @finos/morphir-ir");
	});
});
