// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { binaryNames } from "./binaries.ts";

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
	readonly if?: string;
	readonly needs?: string | readonly string[];
	readonly permissions?: Record<string, string>;
	readonly concurrency?: { readonly group: string; readonly "cancel-in-progress": boolean };
	readonly steps: readonly WorkflowStep[];
}

interface ReleaseWorkflow {
	readonly on: { readonly push: { readonly tags: readonly string[] } };
	readonly permissions: Record<string, string>;
	readonly concurrency: { readonly group: string; readonly "cancel-in-progress": boolean };
	readonly jobs: Record<string, WorkflowJob>;
}

const DOLLAR = String.fromCharCode(36);

/**
 * The exact files `mise run release:artifact` and `mise run release:binaries`
 * write, named with the workflow's own `${version}` expansion. Every place the
 * release workflow enumerates its output is pinned to this list, so changing
 * what the artifact commands produce without changing the workflow fails here
 * rather than on the next tag.
 */
const RELEASE_ARTIFACTS: readonly string[] = [
	`finos-morphir-ir-${DOLLAR}{version}.tgz`,
	`finos-morphir-mck-${DOLLAR}{version}.tgz`,
	...binaryNames(`${DOLLAR}{version}`),
];

/** Reads the `artifacts=( ... )` Bash array a release workflow step declares. */
function artifactArray(script: string): readonly string[] {
	const block = script.match(/^[ \t]*artifacts=\(\n([\s\S]*?)\n[ \t]*\)$/m)?.[1];
	if (block === undefined) throw new Error("workflow step does not declare an artifacts array");
	return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1] as string);
}

async function commandOutput(command: readonly string[]): Promise<string> {
	const child = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (exitCode !== 0) throw new Error(`${command.join(" ")} failed:\n${stderr}`);
	return stdout;
}

async function nodeSourceOutput(source: string, args: readonly string[]): Promise<{ stdout: string; exitCode: number }> {
	const child = Bun.spawn(["node", "-", ...args], { cwd: root, stdin: new Blob([source]), stdout: "pipe", stderr: "pipe" });
	const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
	return { stdout, exitCode };
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
		expect(byName.get("check:conformance")?.depends).toEqual(["setup"]);
		expect(byName.get("release:artifact")?.depends).toEqual(["setup"]);
		expect(byName.get("release:binaries")?.depends).toEqual(["setup"]);
		for (const dependency of ["check:lint", "check:typecheck", "check:kit", "test", "check:package", "check:workflows", "check:conformance"])
			expect(byName.get("ci")?.depends).toContain(dependency);

		const sources = new Map<string, string>();
		for (const name of ["check:package", "check:workflows", "release:artifact", "release:binaries"]) {
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
		expect(taskInvocation(sources.get("release:binaries") as string)).toBe(
			'await exec(["bun", "scripts/release/cli.ts", "binaries", ...process.argv.slice(2)]);',
		);

		const conformanceFile = byName.get("check:conformance")?.file;
		expect(conformanceFile).toBeString();
		await access(conformanceFile as string, constants.X_OK);
		const conformanceSource = await readFile(conformanceFile as string, "utf8");
		expect(conformanceSource).toMatch(/^#!\/usr\/bin\/env bun\n\/\/ Copyright 2026 FINOS\n\/\/ SPDX-License-Identifier: Apache-2\.0\n/);
		const conformanceInvocations = conformanceSource.match(/^await exec\(.+\);$/gm) ?? [];
		expect(conformanceInvocations).toHaveLength(4);
		expect(conformanceInvocations[0]).toContain('"run", "--report"');
		expect(conformanceInvocations[1]).toContain('"--adapter", "bun"');
		expect(conformanceInvocations[2]).toContain("scripts/conformance/compare-reports.ts");
		expect(conformanceInvocations[3]).toContain('"coverage"');
	});

	// The naming and format-version conformance corpora live only in the parent
	// finos/morphir repository, and their tests throw at load when the files are
	// absent. Dropping MORPHIR_FIXTURES_OPTIONAL therefore turns a standalone
	// checkout's suite red before a single test runs. Pin the variable, the
	// comment that scopes it to those two corpora, and the README sentence that
	// tells a standalone contributor the same thing.
	// The task file is read by path rather than through `mise tasks --json`: a
	// checkout nested inside the parent finos/morphir repository inherits that
	// repository's own `test` task and mise renames this one out from under a
	// lookup by name. The test above already pins `ci` to a `test` dependency.
	test("keeps the fixture opt-out on the test task, scoped to the two parent-only corpora", async () => {
		const file = path.join(root, ".config/mise/tasks/test.ts");
		await access(file, constants.X_OK);
		const source = await readFile(file, "utf8");
		expect(source).toMatch(/^#!\/usr\/bin\/env bun\n\/\/ Copyright 2026 FINOS\n\/\/ SPDX-License-Identifier: Apache-2\.0\n/);
		expect(source).toContain('//MISE depends=["setup"]');
		expect(taskInvocation(source)).toBe('await exec(["bun", "run", "test"], { MORPHIR_FIXTURES_OPTIONAL: "1" });');
		expect(source).toContain("docs/spec/ir/fixtures/{naming,format-version}-conformance.json");
		expect(source).toContain("format-version.test.ts throw at load when they are absent");
		expect(source).toContain("MCK kit is vendored under packages/mck/kit and needs no opt-out");

		const status = markdownSection(await readFile(path.join(root, "README.md"), "utf8"), "Project status");
		expect(status).toContain("vendored into packages/mck/kit");
		expect(status).toContain("MORPHIR_FIXTURES_OPTIONAL=1");
		expect(status).not.toContain("Standalone CI temporarily skips");
	});

	// actionlint 1.7.12 deadlocks on Windows when it feeds shellcheck a `run:`
	// script longer than the 4 KiB pipe buffer: a 4008-byte script lints, a
	// 4108-byte one hangs forever. That silently breaks `mise run ci` for
	// Windows contributors, so every step in every workflow stays under it.
	test("keeps every workflow run script under the 4 KiB actionlint limit", async () => {
		for (const file of [".github/workflows/release.yml", ".github/workflows/ci.yml"]) {
			const workflow = Bun.YAML.parse(await readFile(path.join(root, file), "utf8")) as { jobs: Record<string, WorkflowJob> };
			const scripts = Object.entries(workflow.jobs).flatMap(([job, definition]) =>
				definition.steps.flatMap((step) => (step.run === undefined ? [] : [[`${file} ${job} / ${step.name ?? "(unnamed)"}`, step.run] as const])),
			);
			expect(scripts.length).toBeGreaterThan(0);
			const oversized = scripts.filter(([, script]) => script.length >= 4096).map(([where, script]) => `${where}: ${script.length} bytes`);
			expect(oversized).toEqual([]);
		}
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
		// The suite version is read from a manifest rather than written here:
		// a literal in this test is what let the README keep advertising the
		// previous release after `release:prepare` bumped the packages.
		const suiteVersion = (JSON.parse(await readFile(path.join(root, "packages/ir/package.json"), "utf8")) as { version: string }).version;
		expect(status).toContain(suiteVersion);
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
			"mise run release:binaries",
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
			"VERSION=X.Y.Z",
			'mise run release:prepare -- "$VERSION"',
			"mise run ci",
			'git tag -s "v$VERSION" -m "Release $VERSION"',
			'git push origin "v$VERSION"',
			"Signed tags are an operator requirement",
			"does not cryptographically verify tag signatures",
			"provenance",
			"GitHub Release",
			"immutable",
			"main",
		])
			expect(publishing).toContain(expected);
		expect(publishing).not.toContain("mise run release:prepare -- 0.0.1");
		expect(publishing).toMatch(/does not (?:commit|create commits), tag, or push/i);
		expect(publishing).toContain("One tag publishes both packages");
		// 0.0.1 shipped ir only; 0.1.0 was the first release to publish both.
		expect(publishing).toContain("0.0.1 published only @finos/morphir-ir");
		expect(publishing).toContain("0.1.0 was the first release to publish both");
		expect(publishing).not.toContain("publishes from the next suite release");
		for (const expected of [
			"mck-VERSION-OS-ARCH",
			"mck-adapter-typescript-VERSION-OS-ARCH",
			"bun build --compile",
			"chmod +x",
			"mck kit status",
			"mck kit sync",
		])
			expect(publishing).toContain(expected);
	});

	test("starts releases for version tags with least-privilege job boundaries", async () => {
		const { workflow } = await releaseWorkflow();
		expect(workflow.on.push.tags).toEqual(["v*"]);
		expect(workflow.permissions).toEqual({});
		expect(workflow.concurrency.group).toContain(githubExpression("github.ref"));
		expect(workflow.concurrency["cancel-in-progress"]).toBeFalse();

		const { artifact, publish, "github-release": githubRelease } = workflow.jobs;
		expect(Object.keys(workflow.jobs).sort()).toEqual(["artifact", "github-release", "publish"]);
		expect(artifact?.if).toBe(githubExpression("github.event.deleted == false"));
		expect(artifact?.permissions).toEqual({ contents: "read" });
		expect(publish?.needs).toBe("artifact");
		expect(publish?.permissions).toEqual({ "id-token": "write" });
		expect(publish?.concurrency).toEqual({ group: "morphir-ir-npm-publish", "cancel-in-progress": false });
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

	test("builds, compiles, and uploads one exact, checksummed artifact", async () => {
		const { workflow } = await releaseWorkflow();
		const artifact = workflow.jobs.artifact as WorkflowJob;
		const commands = artifact.steps.flatMap((step) => (step.run === undefined ? [] : [step.run])).join("\n");
		for (const command of [
			'mise run release:validate -- "$GITHUB_REF_NAME"',
			"mise run ci",
			"mise run release:artifact -- .dev/out/release",
			"mise run release:binaries -- .dev/out/release",
			`mise run release:notes -- "${shellExpansion("GITHUB_REF_NAME#v")}" .dev/out/release/release-notes.md`,
		])
			expect(commands).toContain(command);
		expect(commands).toContain("sha256sum");

		const checksum = stepNamed(artifact, "Checksum release artifact").run ?? "";
		expect(checksum).toContain('version="$RELEASE_VERSION"');
		// The release notes are the release body, not a checksummed artifact.
		expect(checksum).toContain("! -name release-notes.md");
		expect(checksum).toContain(`sha256sum "${shellExpansion("checksummed[@]")}" > SHA256SUMS`);

		const upload = stepNamed(artifact, "Upload release artifact");
		expect(upload.with).toMatchObject({
			name: "morphir-ir-release",
			"if-no-files-found": "error",
		});
		const releaseVersion = githubExpression("env.RELEASE_VERSION");
		expect(String(upload.with?.path).trim().split("\n")).toEqual([
			`.dev/out/release/finos-morphir-ir-${releaseVersion}.tgz`,
			`.dev/out/release/finos-morphir-mck-${releaseVersion}.tgz`,
			`.dev/out/release/mck-${releaseVersion}-*`,
			`.dev/out/release/mck-adapter-typescript-${releaseVersion}-*`,
			".dev/out/release/release-notes.md",
			".dev/out/release/SHA256SUMS",
		]);
	});

	test("pins every enumerated release file set to what the artifact commands build", async () => {
		const { workflow } = await releaseWorkflow();
		expect(binaryNames("1.2.3")).toHaveLength(10);
		expect(RELEASE_ARTIFACTS).toHaveLength(12);

		const enumerating = [
			stepNamed(workflow.jobs.artifact as WorkflowJob, "Checksum release artifact"),
			stepNamed(workflow.jobs.publish as WorkflowJob, "Verify release artifact"),
			stepNamed(workflow.jobs["github-release"] as WorkflowJob, "Verify release artifact"),
		];
		expect(enumerating).toHaveLength(3);
		for (const step of enumerating) expect(artifactArray(step.run ?? "")).toEqual(RELEASE_ARTIFACTS as string[]);

		// The GitHub Release attaches every checksummed file plus SHA256SUMS.
		const upload = stepNamed(workflow.jobs["github-release"] as WorkflowJob, "Create or update GitHub Release").run ?? "";
		expect(upload).toContain(`test "${shellExpansion("#uploads[@]")}" -eq ${RELEASE_ARTIFACTS.length + 1}`);
	});

	test("publishes both downloaded tarballs without repository access or rebuilds", async () => {
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
		expect(verification).toContain(`finos-morphir-mck-${shellExpansion("version")}.tgz`);

		const publishStep = stepNamed(publish, "Publish npm packages");
		const publishScript = publishStep.run ?? "";
		const latestIndex = publishScript.indexOf('npm view "$package_name" dist-tags.latest --json');
		const publishIndex = publishScript.indexOf('npm publish "$tarball" --access public --provenance');
		expect(latestIndex).toBeGreaterThanOrEqual(0);
		expect(publishIndex).toBeGreaterThan(latestIndex);

		// One publish body runs once per package, ir before mck, because mck
		// depends on ir. Each package's outcome continues the loop; only a
		// genuine failure exits the step.
		expect(publishScript).toContain('for package_name in "@finos/morphir-ir" "@finos/morphir-mck"; do');
		expect(publishScript.match(/npm publish "\$tarball"/g)).toHaveLength(1);
		expect(publishScript).toContain(`tarball=".dev/out/release/finos-${shellExpansion("package_name#@finos/")}-${shellExpansion("version")}.tgz"`);
		expect(publishScript).not.toContain("exit 0");
		// The Node helpers live in their own step: the publish job has no
		// checkout, and actionlint deadlocks on Windows over a 4 KiB `run:`.
		const helpers = stepNamed(publish, "Write publish helpers").run ?? "";
		for (const helper of ["tarball-integrity.cjs", "published-integrity.cjs", "compare-versions.cjs"]) {
			expect(helpers).toContain(`cat > "$RUNNER_TEMP/${helper}" <<'NODE'`);
			expect(publishScript).toContain(`node "$RUNNER_TEMP/${helper}"`);
		}
		expect(helpers).toContain("BigInt");
		expect(helpers).toContain("createHash");
		expect(helpers).toContain("sha512-");

		expect(publishScript).toContain("E404");
		expect(publishScript).toContain('"$comparison" == "older"');
		expect(publishScript).toContain('"$comparison" == "equal"');
		expect(publishScript).toContain('"$remote_integrity" == "$local_integrity"');
		expect(publishScript).toContain("publish_status");
		expect(publishScript).toContain("for attempt in 1 2 3 4 5");
		expect(publishStep.env).toEqual({ NODE_AUTH_TOKEN: githubExpression("secrets.ORG_MORPHIR_NPM_TOKEN") });
		expect(source.match(/ORG_MORPHIR_NPM_TOKEN/g)).toHaveLength(1);
	});

	test("compares npm's latest stable version exactly with BigInt components", async () => {
		const { workflow } = await releaseWorkflow();
		const script = stepNamed(workflow.jobs.publish as WorkflowJob, "Write publish helpers").run ?? "";
		const comparator = script.match(/cat > "\$RUNNER_TEMP\/compare-versions\.cjs" <<'NODE'\n([\s\S]*?)\nNODE/)?.[1];
		expect(comparator).toBeString();

		for (const [target, latest, expected] of [
			["1.9.9", "2.0.0", "older"],
			["2.0.0", "2.0.0", "equal"],
			["2.0.1", "2.0.0", "newer"],
			["9007199254740993.0.0", "9007199254740992.999.999", "newer"],
		] as const) {
			const result = await nodeSourceOutput(comparator as string, [target, JSON.stringify(latest)]);
			expect(result).toEqual({ stdout: expected, exitCode: 0 });
		}

		const prerelease = await nodeSourceOutput(comparator as string, ["2.0.1", JSON.stringify("2.0.0-beta.1")]);
		expect(prerelease.exitCode).not.toBe(0);
	});

	test("creates the GitHub Release from the same verified artifact", async () => {
		const { workflow } = await releaseWorkflow();
		const githubRelease = workflow.jobs["github-release"] as WorkflowJob;
		expect(githubRelease.steps.some((step) => step.uses?.startsWith("actions/checkout@"))).toBeFalse();
		expect(githubRelease.steps.some((step) => /\b(?:bun|mise|npm)\b/.test(step.run ?? ""))).toBeFalse();
		expect(stepNamed(githubRelease, "Download release artifact").with).toMatchObject({ name: "morphir-ir-release", path: ".dev/out/release" });
		const verification = stepNamed(githubRelease, "Verify release artifact").run ?? "";
		expect(verification).toContain("sha256sum --check --strict SHA256SUMS");
		const create = stepNamed(githubRelease, "Create or update GitHub Release");
		const releaseScript = create.run ?? "";
		expect(releaseScript).toContain('gh release view "$tag"');
		expect(releaseScript).toContain('gh release edit "$tag"');
		expect(releaseScript).toContain('gh release create "$tag"');
		expect(releaseScript).toContain("--verify-tag");
		expect(releaseScript.match(/--notes-file \.dev\/out\/release\/release-notes\.md/g)).toHaveLength(2);
		expect(releaseScript).toContain(`gh release upload "$tag" "${shellExpansion("uploads[@]")}"`);
		expect(releaseScript).toContain("--clobber");
		expect(create.env).toEqual({ GH_TOKEN: githubExpression("github.token") });
	});
});
