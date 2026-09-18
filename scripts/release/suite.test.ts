// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test } from "bun:test";
import { copyFile, mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runReleaseCli } from "./cli.ts";
import { prepareSuiteRelease, validateSuiteRelease } from "./suite.ts";

const temporaryDirectories: string[] = [];

const manifestPaths = ["package.json", "packages/ir/package.json", "packages/mck/package.json", "packages/sdk/package.json"] as const;
const malformedVisibilityCases = [
	["package.json", "true", "root package must be private"],
	["package.json", 1, "root package must be private"],
	["package.json", null, "root package must be private"],
	["package.json", {}, "root package must be private"],
	["package.json", [], "root package must be private"],
	["packages/ir/package.json", "false", "@finos/morphir-ir must be public"],
	["packages/ir/package.json", 0, "@finos/morphir-ir must be public"],
	["packages/ir/package.json", null, "@finos/morphir-ir must be public"],
	["packages/ir/package.json", {}, "@finos/morphir-ir must be public"],
	["packages/ir/package.json", [], "@finos/morphir-ir must be public"],
	["packages/mck/package.json", "false", "@finos/morphir-mck must be public"],
	["packages/mck/package.json", 0, "@finos/morphir-mck must be public"],
	["packages/mck/package.json", null, "@finos/morphir-mck must be public"],
	["packages/mck/package.json", {}, "@finos/morphir-mck must be public"],
	["packages/mck/package.json", [], "@finos/morphir-mck must be public"],
	["packages/sdk/package.json", "false", "@finos/morphir-sdk must be public"],
	["packages/sdk/package.json", 0, "@finos/morphir-sdk must be public"],
	["packages/sdk/package.json", null, "@finos/morphir-sdk must be public"],
	["packages/sdk/package.json", {}, "@finos/morphir-sdk must be public"],
	["packages/sdk/package.json", [], "@finos/morphir-sdk must be public"],
] as const;

function manifest(name: string, privatePackage: boolean, version = "0.0.0"): string {
	const manifest: Record<string, unknown> = { name, version, private: privatePackage, type: "module" };
	if (name === "morphir-typescript") manifest.workspaces = ["packages/*"];
	return `${JSON.stringify(manifest, null, "\t")}\n`;
}

function lockfile(version = "0.0.0"): string {
	return `{
  "lockfileVersion": 2,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "morphir-typescript",
      "version": "${version}",
    },
    "packages/ir": {
      "name": "@finos/morphir-ir",
      "version": "${version}",
    },
    "packages/mck": {
      "name": "@finos/morphir-mck",
      "version": "${version}",
    },
    "packages/sdk": {
      "name": "@finos/morphir-sdk",
      "version": "${version}",
    },
  },
  "packages": {
    "@finos/morphir-ir": ["@finos/morphir-ir@workspace:packages/ir"],

    "@finos/morphir-mck": ["@finos/morphir-mck@workspace:packages/mck"],

    "@finos/morphir-sdk": ["@finos/morphir-sdk@workspace:packages/sdk"],
  },
}
`;
}

function changelog(eol = "\n"): string {
	return [
		"# Changelog",
		"",
		"All notable changes to this project will be documented in this file.",
		"",
		"## [Unreleased]",
		"",
		"### Added",
		"",
		"- First release.",
		"",
		"[Unreleased]: https://github.com/finos/morphir-typescript/compare/v0.0.0...HEAD",
		"",
	].join(eol);
}

async function fixture(options: { changelog?: string; lock?: string; versions?: readonly [string, string, string, string] } = {}): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "morphir-release-"));
	temporaryDirectories.push(root);
	await Bun.write(path.join(root, "package.json"), manifest("morphir-typescript", true, options.versions?.[0]));
	await Bun.write(path.join(root, "packages/ir/package.json"), manifest("@finos/morphir-ir", false, options.versions?.[1]));
	await Bun.write(path.join(root, "packages/mck/package.json"), manifest("@finos/morphir-mck", false, options.versions?.[2]));
	await Bun.write(path.join(root, "packages/sdk/package.json"), manifest("@finos/morphir-sdk", false, options.versions?.[3]));
	await Bun.write(path.join(root, "bun.lock"), options.lock ?? lockfile());
	await Bun.write(path.join(root, "CHANGELOG.md"), options.changelog ?? changelog());
	return root;
}

async function snapshot(root: string): Promise<Map<string, string>> {
	return new Map(
		await Promise.all(
			[...manifestPaths, "bun.lock", "CHANGELOG.md"].map(
				async (relativePath) => [relativePath, await readFile(path.join(root, relativePath), "utf8")] as const,
			),
		),
	);
}

async function expectRejectedWithoutWrites(root: string, operation: () => Promise<unknown>, message: string | RegExp): Promise<void> {
	const before = await snapshot(root);
	await expect(operation()).rejects.toThrow(message);
	expect(await snapshot(root)).toEqual(before);
}

async function changeJson(root: string, relativePath: string, change: (value: Record<string, unknown>) => void): Promise<void> {
	const absolutePath = path.join(root, relativePath);
	const value = Bun.JSONC.parse(await readFile(absolutePath, "utf8")) as Record<string, unknown>;
	change(value);
	await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function transientReleaseFiles(root: string): Promise<string[]> {
	const directories = ["", "packages/ir", "packages/mck", "packages/sdk"];
	return (
		await Promise.all(
			directories.map(async (directory) =>
				(await readdir(path.join(root, directory))).filter((name) => name.includes(".release-")).map((name) => path.join(directory, name)),
			),
		)
	).flat();
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("prepareSuiteRelease", () => {
	test("updates the three manifests, lockfile, and changelog", async () => {
		const root = await fixture();

		const version = await prepareSuiteRelease(root, "0.0.1", "2026-09-05");

		expect(version.text).toBe("0.0.1");
		for (const manifestPath of manifestPaths) {
			const parsed = JSON.parse(await readFile(path.join(root, manifestPath), "utf8"));
			expect(parsed.version).toBe("0.0.1");
		}
		const lock = Bun.JSONC.parse(await readFile(path.join(root, "bun.lock"), "utf8")) as { workspaces: Record<string, { version: string }> };
		expect(Object.values(lock.workspaces).map((workspace) => workspace.version)).toEqual(["0.0.1", "0.0.1", "0.0.1"]);
		expect(await readFile(path.join(root, "CHANGELOG.md"), "utf8")).toContain("## [0.0.1] - 2026-09-05");
	});

	test("changes only the three workspace version values in a Bun JSONC lockfile", async () => {
		const originalLock = lockfile();
		const root = await fixture({ lock: originalLock });

		await prepareSuiteRelease(root, "0.0.1", "2026-09-05");

		expect(await readFile(path.join(root, "bun.lock"), "utf8")).toBe(originalLock.replaceAll('"version": "0.0.0"', '"version": "0.0.1"'));
		const install = Bun.spawn([process.execPath, "install", "--frozen-lockfile"], { cwd: root, stdout: "pipe", stderr: "pipe" });
		expect(await install.exited).toBe(0);
	});

	test("rejects package version drift without changing files", async () => {
		const root = await fixture({ versions: ["0.0.0", "0.0.1", "0.0.0", "0.0.0"] });
		await expectRejectedWithoutWrites(root, () => prepareSuiteRelease(root, "0.0.2", "2026-09-05"), "suite package versions do not match");
	});

	test.each([
		["package.json", false, "root package must be private"],
		["packages/ir/package.json", true, "@finos/morphir-ir must be public"],
		["packages/mck/package.json", true, "@finos/morphir-mck must be public"],
		["packages/sdk/package.json", true, "@finos/morphir-sdk must be public"],
	] as const)("rejects invalid visibility in %s", async (relativePath, privatePackage, expectedMessage) => {
		const root = await fixture();
		await changeJson(root, relativePath, (value) => {
			value.private = privatePackage;
		});
		await expectRejectedWithoutWrites(root, () => prepareSuiteRelease(root, "0.0.1", "2026-09-05"), expectedMessage);
	});

	test.each(malformedVisibilityCases)("rejects malformed private value in %s during preparation", async (relativePath, privateValue, expectedMessage) => {
		const root = await fixture();
		await changeJson(root, relativePath, (value) => {
			value.private = privateValue;
		});
		await expectRejectedWithoutWrites(root, () => prepareSuiteRelease(root, "0.0.1", "2026-09-05"), expectedMessage);
	});

	test("accepts an absent private field for the public package", async () => {
		const root = await fixture();
		await changeJson(root, "packages/ir/package.json", (value) => {
			delete value.private;
		});

		await prepareSuiteRelease(root, "0.0.1", "2026-09-05");

		expect(JSON.parse(await readFile(path.join(root, "packages/ir/package.json"), "utf8"))).not.toHaveProperty("private");
	});

	test("rejects a package with the wrong name without changing files", async () => {
		const root = await fixture();
		await changeJson(root, "packages/ir/package.json", (value) => {
			value.name = "@finos/not-morphir-ir";
		});
		await expectRejectedWithoutWrites(root, () => prepareSuiteRelease(root, "0.0.1", "2026-09-05"), "must be named @finos/morphir-ir");
	});

	test.each([
		["0.0.0", "must be newer"],
		["invalid", "invalid stable semantic version"],
	] as const)("rejects target version %s without changing files", async (target, expectedMessage) => {
		const root = await fixture();
		await expectRejectedWithoutWrites(root, () => prepareSuiteRelease(root, target, "2026-09-05"), expectedMessage);
	});

	test("rejects an older target version without changing files", async () => {
		const root = await fixture({ versions: ["1.0.0", "1.0.0", "1.0.0"], lock: lockfile("1.0.0") });
		await expectRejectedWithoutWrites(root, () => prepareSuiteRelease(root, "0.9.0", "2026-09-05"), "must be newer");
	});

	test.each([
		[
			"a missing workspace",
			(lock: Record<string, unknown>) => {
				delete (lock.workspaces as Record<string, unknown>)["packages/ir"];
			},
			"workspace packages/ir",
		],
		[
			"a wrong workspace name",
			(lock: Record<string, unknown>) => {
				((lock.workspaces as Record<string, Record<string, unknown>>)["packages/ir"] as Record<string, unknown>).name = "wrong";
			},
			"wrong name",
		],
		[
			"a wrong workspace version",
			(lock: Record<string, unknown>) => {
				((lock.workspaces as Record<string, Record<string, unknown>>)["packages/ir"] as Record<string, unknown>).version = "9.9.9";
			},
			"wrong version",
		],
		[
			"a wrong workspace path",
			(lock: Record<string, unknown>) => {
				const workspaces = lock.workspaces as Record<string, unknown>;
				workspaces["packages/wrong"] = workspaces["packages/ir"];
				delete workspaces["packages/ir"];
			},
			"unexpected workspace packages/wrong",
		],
		[
			"an unexpected workspace",
			(lock: Record<string, unknown>) => {
				(lock.workspaces as Record<string, unknown>)["packages/extra"] = { name: "extra", version: "0.0.0" };
			},
			"unexpected workspace packages/extra",
		],
	] as const)("rejects bun.lock with %s without changing files", async (_caseName, mutateLock, expectedMessage) => {
		const root = await fixture();
		await changeJson(root, "bun.lock", mutateLock);
		await expectRejectedWithoutWrites(root, () => prepareSuiteRelease(root, "0.0.1", "2026-09-05"), expectedMessage);
	});

	test("rejects an invalid date without changing files", async () => {
		const root = await fixture();
		await expectRejectedWithoutWrites(root, () => prepareSuiteRelease(root, "0.0.1", "2026-02-30"), "invalid release date");
	});

	test("rejects a duplicate changelog release without changing files", async () => {
		const root = await fixture({
			changelog: changelog().replace("## [Unreleased]", "## [Unreleased]\n\n- Next.\n\n## [0.0.1] - 2026-09-01"),
		});
		await expectRejectedWithoutWrites(root, () => prepareSuiteRelease(root, "0.0.1", "2026-09-05"), "already contains release 0.0.1");
	});

	test("preserves CRLF line endings and visibility fields", async () => {
		const root = await fixture({ changelog: changelog("\r\n") });

		await prepareSuiteRelease(root, "0.0.1", "2026-09-05");

		const preparedChangelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
		expect(preparedChangelog.replaceAll("\r\n", "")).not.toContain("\n");
		expect(JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).private).toBe(true);
		expect(JSON.parse(await readFile(path.join(root, "packages/ir/package.json"), "utf8")).private).toBe(false);
		expect(JSON.parse(await readFile(path.join(root, "packages/mck/package.json"), "utf8")).private).toBe(false);
		expect(JSON.parse(await readFile(path.join(root, "packages/sdk/package.json"), "utf8")).private).toBe(false);
	});

	test("removes every staged file when a temporary write fails", async () => {
		const root = await fixture();
		const before = await snapshot(root);
		let writes = 0;
		const fileSystem = {
			writeFile: async (file: string, contents: string, options: { flag: "wx" }) => {
				writes += 1;
				await writeFile(file, contents, options);
				if (writes === 2) throw new Error("injected temporary write failure");
			},
			copyFile,
			rename,
			unlink,
		};

		await expect(prepareSuiteRelease(root, "0.0.1", "2026-09-05", { fileSystem })).rejects.toThrow("injected temporary write failure");

		expect(await snapshot(root)).toEqual(before);
		expect(await transientReleaseFiles(root)).toEqual([]);
	});

	test("rolls back replaced destinations when a later replacement fails", async () => {
		const root = await fixture();
		const before = await snapshot(root);
		const irManifestPath = path.join(root, "packages/ir/package.json");
		let destinationAtFailure: string | undefined;
		const fileSystem = {
			writeFile: async (file: string, contents: string, options: { flag: "wx" }) => writeFile(file, contents, options),
			copyFile,
			rename: async (from: string, to: string) => {
				if (from.endsWith(".tmp") && to === irManifestPath) {
					destinationAtFailure = await readFile(to, "utf8").catch(() => undefined);
					throw new Error("injected destination replacement failure");
				}
				await rename(from, to);
			},
			unlink,
		};

		await expect(prepareSuiteRelease(root, "0.0.1", "2026-09-05", { fileSystem })).rejects.toThrow("injected destination replacement failure");

		expect(destinationAtFailure).toBe(before.get("packages/ir/package.json"));
		expect(await snapshot(root)).toEqual(before);
		expect(await transientReleaseFiles(root)).toEqual([]);
	});

	test("reports a rollback failure and retains the affected backup", async () => {
		const root = await fixture();
		const rootManifestPath = path.join(root, "package.json");
		const irManifestPath = path.join(root, "packages/ir/package.json");
		const originalRootManifest = await readFile(rootManifestPath, "utf8");
		const fileSystem = {
			writeFile: async (file: string, contents: string, options: { flag: "wx" }) => writeFile(file, contents, options),
			copyFile,
			rename: async (from: string, to: string) => {
				if (from.endsWith(".tmp") && to === irManifestPath) throw new Error("injected replacement failure");
				if (from.endsWith(".backup") && to === rootManifestPath) throw new Error("injected rollback failure");
				await rename(from, to);
			},
			unlink,
		};

		let caught: unknown;
		try {
			await prepareSuiteRelease(root, "0.0.1", "2026-09-05", { fileSystem });
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(AggregateError);
		expect((caught as AggregateError).message).toContain("rollback also failed");
		const retained = (await transientReleaseFiles(root)).filter((file) => file.endsWith(".backup"));
		expect(retained).toHaveLength(1);
		expect(await readFile(path.join(root, retained[0] as string), "utf8")).toBe(originalRootManifest);
	});
});

describe("validateSuiteRelease", () => {
	test("accepts a prepared suite matching its tag", async () => {
		const root = await fixture();
		await prepareSuiteRelease(root, "0.0.1", "2026-09-05");

		const version = await validateSuiteRelease(root, "v0.0.1");

		expect(version.text).toBe("0.0.1");
	});

	test.each([
		["0.0.1", "invalid release tag"],
		["v0.0.2", "does not match suite version"],
		["v0.0.1-beta.1", "invalid release tag"],
	] as const)("rejects tag %s", async (tag, expectedMessage) => {
		const root = await fixture();
		await prepareSuiteRelease(root, "0.0.1", "2026-09-05");
		await expect(validateSuiteRelease(root, tag)).rejects.toThrow(expectedMessage);
	});

	test("rejects lockfile version drift", async () => {
		const root = await fixture();
		await prepareSuiteRelease(root, "0.0.1", "2026-09-05");
		await changeJson(root, "bun.lock", (lock) => {
			((lock.workspaces as Record<string, Record<string, unknown>>)["packages/mck"] as Record<string, unknown>).version = "0.0.0";
		});
		await expect(validateSuiteRelease(root, "v0.0.1")).rejects.toThrow("wrong version");
	});

	test("rejects invalid package visibility", async () => {
		const root = await fixture();
		await prepareSuiteRelease(root, "0.0.1", "2026-09-05");
		await changeJson(root, "packages/ir/package.json", (value) => {
			value.private = true;
		});
		await expect(validateSuiteRelease(root, "v0.0.1")).rejects.toThrow("@finos/morphir-ir must be public");
	});

	test.each(malformedVisibilityCases)("rejects malformed private value in %s during validation", async (relativePath, privateValue, expectedMessage) => {
		const root = await fixture();
		await prepareSuiteRelease(root, "0.0.1", "2026-09-05");
		await changeJson(root, relativePath, (value) => {
			value.private = privateValue;
		});
		await expect(validateSuiteRelease(root, "v0.0.1")).rejects.toThrow(expectedMessage);
	});

	test.each([
		["missing", changelog(), "not found in changelog"],
		["undated", changelog().replace("## [Unreleased]", "## [Unreleased]\n\n- Next.\n\n## [0.0.0]"), "is not dated"],
		[
			"empty",
			changelog().replace("## [Unreleased]", "## [Unreleased]\n\n- Next.\n\n## [0.0.0] - 2026-09-05").replace("### Added\n\n- First release.\n\n", ""),
			"is empty",
		],
	] as const)("rejects a %s release section", async (_caseName, releaseChangelog, expectedMessage) => {
		const root = await fixture({ changelog: releaseChangelog });
		await expect(validateSuiteRelease(root, "v0.0.0")).rejects.toThrow(expectedMessage);
	});
});

describe("release CLI", () => {
	test("prepares with the current UTC date by default", async () => {
		const root = await fixture();
		const output: string[] = [];

		await runReleaseCli(["prepare", "0.0.1"], { root, now: new Date("2026-09-05T23:59:59Z"), stdout: (line) => output.push(line) });

		expect(await readFile(path.join(root, "CHANGELOG.md"), "utf8")).toContain("## [0.0.1] - 2026-09-05");
		expect(output).toEqual(["Prepared suite release 0.0.1."]);
	});

	test("accepts one explicit release date", async () => {
		const root = await fixture();
		await runReleaseCli(["prepare", "0.0.1", "--date=2026-09-04"], { root, stdout: () => undefined });
		expect(await readFile(path.join(root, "CHANGELOG.md"), "utf8")).toContain("## [0.0.1] - 2026-09-04");
	});

	test.each([
		[[], "Usage:"],
		[["prepare"], "Usage:"],
		[["prepare", "0.0.1", "extra"], "unknown argument: extra"],
		[["prepare", "0.0.1", "--date=2026-09-05", "--date=2026-09-06"], "--date may only be specified once"],
		[["prepare", "0.0.1", "--when=2026-09-05"], "unknown argument"],
		[["validate", "v0.0.1", "extra"], "Usage:"],
		[["notes", "0.0.1"], "Usage:"],
		[["unknown"], "unknown release command"],
	] as const)("rejects invalid arguments %#", async (args, expectedMessage) => {
		const root = await fixture();
		await expect(runReleaseCli([...args], { root })).rejects.toThrow(expectedMessage);
	});

	test("validates a tag and writes release notes", async () => {
		const root = await fixture();
		await prepareSuiteRelease(root, "0.0.1", "2026-09-05");
		const output: string[] = [];

		await runReleaseCli(["validate", "v0.0.1"], { root, stdout: (line) => output.push(line) });
		await runReleaseCli(["notes", "0.0.1", "notes/release-notes.md"], { root, stdout: (line) => output.push(line) });

		expect(output).toEqual(["Validated suite release v0.0.1.", "Wrote release notes for 0.0.1 to notes/release-notes.md."]);
		expect(await readFile(path.join(root, "notes/release-notes.md"), "utf8")).toBe("### Added\n\n- First release.\n");
	});
});
