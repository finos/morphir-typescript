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

interface WorkflowStep {
	readonly name?: string;
	readonly uses?: string;
	readonly run?: string;
	readonly with?: Record<string, unknown>;
	readonly env?: Record<string, string>;
}

interface WorkflowJob {
	readonly needs?: string | readonly string[];
	readonly permissions?: Record<string, string>;
	readonly steps: readonly WorkflowStep[];
}

interface ReleaseWorkflow {
	readonly on: { readonly push: { readonly tags: readonly string[] } };
	readonly permissions: Record<string, string>;
	readonly concurrency: { readonly group: string; readonly "cancel-in-progress": boolean };
	readonly jobs: Record<string, WorkflowJob>;
}

const DOLLAR = String.fromCharCode(36);

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

async function releaseWorkflow(): Promise<{ source: string; workflow: ReleaseWorkflow }> {
	const source = await readFile(path.join(root, ".github/workflows/release.yml"), "utf8");
	return { source, workflow: Bun.YAML.parse(source) as ReleaseWorkflow };
}

function stepNamed(job: WorkflowJob, name: string): WorkflowStep {
	const step = job.steps.find((candidate) => candidate.name === name);
	if (step === undefined) throw new Error(`missing workflow step: ${name}`);
	return step;
}

function githubExpression(value: string): string {
	return `${DOLLAR}{{ ${value} }}`;
}

function shellExpansion(value: string): string {
	return `${DOLLAR}{${value}}`;
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

	test("starts releases for version tags with least-privilege job boundaries", async () => {
		const { workflow } = await releaseWorkflow();
		expect(workflow.on.push.tags).toEqual(["v*"]);
		expect(workflow.permissions).toEqual({});
		expect(workflow.concurrency.group).toContain(githubExpression("github.ref"));
		expect(workflow.concurrency["cancel-in-progress"]).toBeFalse();

		const { artifact, publish, "github-release": githubRelease } = workflow.jobs;
		expect(Object.keys(workflow.jobs).sort()).toEqual(["artifact", "github-release", "publish"]);
		expect(artifact?.permissions).toEqual({ contents: "read" });
		expect(publish?.needs).toBe("artifact");
		expect(publish?.permissions).toEqual({ "id-token": "write" });
		expect(githubRelease?.needs).toBe("publish");
		expect(githubRelease?.permissions).toEqual({ contents: "write" });
	});

	test("pins every action to its approved immutable revision", async () => {
		const { workflow } = await releaseWorkflow();
		const uses = Object.values(workflow.jobs).flatMap((job) => job.steps.flatMap((step) => (step.uses === undefined ? [] : [step.uses])));
		expect(uses).toContain("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
		expect(uses).toContain("jdx/mise-action@c2a87611a18de5b3828c5652fe268e992400cb5c");
		expect(uses).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
		expect(uses.filter((value) => value.startsWith("actions/download-artifact@"))).toEqual([
			"actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
			"actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
		]);
		expect(uses).toContain("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
		for (const action of uses) expect(action).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
	});

	test("validates the tag and main ancestry before executing repository code", async () => {
		const { workflow } = await releaseWorkflow();
		const artifact = workflow.jobs.artifact as WorkflowJob;
		const checkoutIndex = artifact.steps.findIndex((step) => step.uses?.startsWith("actions/checkout@"));
		const guardIndex = artifact.steps.findIndex((step) => step.name === "Validate release ref");
		const miseIndex = artifact.steps.findIndex((step) => step.uses?.startsWith("jdx/mise-action@"));
		expect(checkoutIndex).toBeGreaterThanOrEqual(0);
		expect(guardIndex).toBeGreaterThan(checkoutIndex);
		expect(miseIndex).toBeGreaterThan(guardIndex);
		expect(artifact.steps[checkoutIndex]?.with).toMatchObject({ "fetch-depth": 0, "persist-credentials": false });

		const guard = artifact.steps[guardIndex]?.run ?? "";
		expect(guard).toContain("set -euo pipefail");
		expect(guard).toContain('[[ "$GITHUB_REF_NAME" =~ ^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$ ]]');
		expect(guard).toContain("refs/remotes/origin/main");
		expect(guard).toContain('git merge-base --is-ancestor "$GITHUB_SHA" refs/remotes/origin/main');
	});

	test("builds and uploads one exact, checksummed artifact", async () => {
		const { workflow } = await releaseWorkflow();
		const artifact = workflow.jobs.artifact as WorkflowJob;
		const commands = artifact.steps.flatMap((step) => (step.run === undefined ? [] : [step.run])).join("\n");
		for (const command of [
			'mise run release:validate -- "$GITHUB_REF_NAME"',
			"mise run ci",
			"mise run release:artifact -- .dev/out/release",
			`mise run release:notes -- "${shellExpansion("GITHUB_REF_NAME#v")}" .dev/out/release/release-notes.md`,
		])
			expect(commands).toContain(command);
		expect(commands).toContain(`tarball=".dev/out/release/finos-morphir-ir-${shellExpansion("version")}.tgz"`);
		expect(commands).toContain("sha256sum");

		const upload = stepNamed(artifact, "Upload release artifact");
		expect(upload.with).toMatchObject({
			name: "morphir-ir-release",
			"if-no-files-found": "error",
		});
		expect(String(upload.with?.path).trim().split("\n")).toEqual([
			`.dev/out/release/finos-morphir-ir-${githubExpression("env.RELEASE_VERSION")}.tgz`,
			".dev/out/release/release-notes.md",
			".dev/out/release/SHA256SUMS",
		]);
	});

	test("publishes the downloaded tarball without repository access or rebuilds", async () => {
		const { source, workflow } = await releaseWorkflow();
		const publish = workflow.jobs.publish as WorkflowJob;
		expect(publish.steps.some((step) => step.uses?.startsWith("actions/checkout@"))).toBeFalse();
		expect(publish.steps.some((step) => step.uses?.startsWith("jdx/mise-action@"))).toBeFalse();
		expect(publish.steps.some((step) => /\b(?:bun|mise|npm pack)\b/.test(step.run ?? ""))).toBeFalse();
		expect(stepNamed(publish, "Download release artifact").with).toMatchObject({ name: "morphir-ir-release", path: ".dev/out/release" });
		expect(stepNamed(publish, "Set up Node.js").with).toMatchObject({
			"node-version": "24",
			"registry-url": "https://registry.npmjs.org",
			scope: "@finos",
		});
		const verification = stepNamed(publish, "Verify release artifact").run ?? "";
		expect(verification).toContain("set -euo pipefail");
		expect(verification).toContain("sha256sum --check --strict SHA256SUMS");
		expect(verification).toContain(`finos-morphir-ir-${shellExpansion("version")}.tgz`);

		const publishStep = stepNamed(publish, "Publish @finos/morphir-ir");
		expect(publishStep.run).toContain('npm publish "$tarball" --access public --provenance');
		expect(publishStep.env).toEqual({ NODE_AUTH_TOKEN: githubExpression("secrets.ORG_MORPHIR_NPM_TOKEN") });
		expect(source.match(/ORG_MORPHIR_NPM_TOKEN/g)).toHaveLength(1);
	});

	test("creates the GitHub Release from the same verified artifact", async () => {
		const { workflow } = await releaseWorkflow();
		const githubRelease = workflow.jobs["github-release"] as WorkflowJob;
		expect(githubRelease.steps.some((step) => step.uses?.startsWith("actions/checkout@"))).toBeFalse();
		expect(githubRelease.steps.some((step) => /\b(?:bun|mise|npm)\b/.test(step.run ?? ""))).toBeFalse();
		expect(stepNamed(githubRelease, "Download release artifact").with).toMatchObject({ name: "morphir-ir-release", path: ".dev/out/release" });
		const verification = stepNamed(githubRelease, "Verify release artifact").run ?? "";
		expect(verification).toContain("sha256sum --check --strict SHA256SUMS");
		const create = stepNamed(githubRelease, "Create GitHub Release");
		expect(create.run).toContain("gh release create");
		expect(create.run).toContain('"$GITHUB_REF_NAME"');
		expect(create.run).toContain("--verify-tag");
		expect(create.run).toContain("--notes-file .dev/out/release/release-notes.md");
		expect(create.run).toContain('"$tarball"');
		expect(create.env).toEqual({ GH_TOKEN: githubExpression("github.token") });
	});
});
