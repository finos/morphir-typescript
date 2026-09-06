// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { extractReleaseNotes, prepareChangelog } from "./changelog.ts";
import { parseStableVersion } from "./version.ts";

describe("prepareChangelog", () => {
	test("prepares the first release and comparison links while preserving the release body", () => {
		const markdown = `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Ship the release model with **source formatting** intact.
`;

		expect(prepareChangelog(markdown, parseStableVersion("0.1.0"), "2026-09-05")).toBe(`# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.1.0] - 2026-09-05

### Added

- Ship the release model with **source formatting** intact.

[Unreleased]: https://github.com/finos/morphir-typescript/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/finos/morphir-typescript/releases/tag/v0.1.0
`);
	});

	test("prepares a later release with a compare link and preserves older links once", () => {
		const markdown = `# Changelog

## [Unreleased]

- Add the next feature.

## [0.1.0] - 2026-08-01

- First release.

[Unreleased]: https://github.com/finos/morphir-typescript/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/finos/morphir-typescript/releases/tag/v0.1.0
[0.1.0]: https://github.com/finos/morphir-typescript/releases/tag/v0.1.0
`;

		expect(prepareChangelog(markdown, parseStableVersion("0.2.0"), "2026-09-05")).toBe(`# Changelog

## [Unreleased]

## [0.2.0] - 2026-09-05

- Add the next feature.

## [0.1.0] - 2026-08-01

- First release.

[Unreleased]: https://github.com/finos/morphir-typescript/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/finos/morphir-typescript/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/finos/morphir-typescript/releases/tag/v0.1.0
`);
	});

	test.each(["2026-9-05", "2026-02-30"])("rejects invalid release date %s", (date) => {
		const markdown = "## [Unreleased]\n\n- Ready.\n";
		expect(() => prepareChangelog(markdown, parseStableVersion("1.0.0"), date)).toThrow(`invalid release date: ${date}`);
	});

	test("rejects an existing target release", () => {
		const markdown = "## [Unreleased]\n\n- Ready.\n\n## [1.0.0] - 2026-08-01\n\n- Already released.\n";
		expect(() => prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05")).toThrow("changelog already contains release 1.0.0");
	});

	test("rejects an empty Unreleased section", () => {
		const markdown = "## [Unreleased]\n\n## [0.1.0] - 2026-08-01\n\n- Previous release.\n";
		expect(() => prepareChangelog(markdown, parseStableVersion("0.2.0"), "2026-09-05")).toThrow("Unreleased section has no top-level unordered list items");
	});

	test("does not count a bullet-looking line in a code fence", () => {
		const markdown = "## [Unreleased]\n\n```text\n- fake item\n```\n";
		expect(() => prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05")).toThrow("Unreleased section has no top-level unordered list items");
	});

	test("rejects a changelog without the exact Unreleased heading", () => {
		const markdown = "# Changelog\n\n### [Unreleased]\n\n- Ready.\n";
		expect(() => prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05")).toThrow("changelog is missing ## [Unreleased]");
	});

	test("preserves significant trailing spaces in the released Markdown", () => {
		const markdown = "## [Unreleased]\n\n- A line with a hard break.  \n";
		const prepared = prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05");
		expect(prepared).toContain("- A line with a hard break.  \n\n[Unreleased]:");
	});
});

describe("extractReleaseNotes", () => {
	test("returns only the requested dated release body with one trailing newline", () => {
		const markdown = `# Changelog

## [Unreleased]

## [1.0.0] - 2026-09-05

### Added

- The **first** release.

[Unreleased]: https://github.com/finos/morphir-typescript/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/finos/morphir-typescript/releases/tag/v1.0.0
`;

		expect(extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toBe("### Added\n\n- The **first** release.\n");
	});

	test("rejects a missing release", () => {
		expect(() => extractReleaseNotes("## [Unreleased]\n", parseStableVersion("1.0.0"))).toThrow("release 1.0.0 not found in changelog");
	});

	test("rejects an undated release", () => {
		expect(() => extractReleaseNotes("## [1.0.0]\n\n- Notes.\n", parseStableVersion("1.0.0"))).toThrow("release 1.0.0 is not dated");
	});

	test("rejects an empty release", () => {
		const markdown = `## [1.0.0] - 2026-09-05

[Unreleased]: https://github.com/finos/morphir-typescript/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/finos/morphir-typescript/releases/tag/v1.0.0
`;
		expect(() => extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toThrow("release 1.0.0 is empty");
	});

	test("preserves significant spaces while trimming only surrounding blank lines", () => {
		const markdown = "## [1.0.0] - 2026-09-05\n\nFirst line.  \nSecond line.  \n\n## [0.9.0] - 2026-08-01\n\n- Older.\n";
		expect(extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toBe("First line.  \nSecond line.  \n");
	});
});
