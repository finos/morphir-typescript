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

	test("rejects an existing undated target release", () => {
		const markdown = "## [Unreleased]\n\n- Ready.\n\n## [1.0.0]\n\n- Draft release.\n";
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

	test("does not treat a fenced h2 as the end of Unreleased", () => {
		const markdown = "## [Unreleased]\n\n```markdown\n## Example heading\n```\n\n- Real release item.\n";
		const prepared = prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05");
		expect(prepared).toContain("## [1.0.0] - 2026-09-05\n\n```markdown\n## Example heading\n```\n\n- Real release item.");
	});

	test("does not accept an unordered list nested beneath an ordered item", () => {
		const markdown = "## [Unreleased]\n\n1. Ordered parent\n   - Nested unordered item\n";
		expect(() => prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05")).toThrow("Unreleased section has no top-level unordered list items");
	});

	test("treats an ordinary root h2 as the end of Unreleased", () => {
		const markdown = "## [Unreleased]\n\n## Other\n\n- Not a release item.\n";
		expect(() => prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05")).toThrow("Unreleased section has no top-level unordered list items");
	});

	test("rejects a changelog without the exact Unreleased heading", () => {
		const markdown = "# Changelog\n\n### [Unreleased]\n\n- Ready.\n";
		expect(() => prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05")).toThrow("changelog is missing ## [Unreleased]");
	});

	test.each(["##  [Unreleased]", "##\t[Unreleased]"])("rejects non-exact Unreleased heading spacing: %s", (heading) => {
		const markdown = `${heading}\n\n- Ready.\n`;
		expect(() => prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05")).toThrow("changelog is missing ## [Unreleased]");
	});

	test("preserves significant trailing spaces in the released Markdown", () => {
		const markdown = "## [Unreleased]\n\n- A line with a hard break.  \n";
		const prepared = prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05");
		expect(prepared).toContain("- A line with a hard break.  \n\n[Unreleased]:");
	});

	test("preserves fenced version-shaped link text and moves only root comparison links", () => {
		const markdown = `## [Unreleased]

- Document comparison-link syntax.

\`\`\`markdown
[0.9.0]: literal example
\`\`\`

## [0.9.0] - 2026-08-01

- Previous release.

[Unreleased]: https://github.com/finos/morphir-typescript/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/finos/morphir-typescript/releases/tag/v0.9.0
`;
		const prepared = prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05");
		expect(prepared).toContain("```markdown\n[0.9.0]: literal example\n```");
		expect(prepared.match(/^\[0\.9\.0\]: https:\/\/github\.com\/finos\/morphir-typescript\/releases\/tag\/v0\.9\.0$/gm)).toHaveLength(1);
	});

	test("ignores headings and definitions in root HTML literal blocks", () => {
		const markdown = `## [Unreleased]

<!--
## Comment heading
[8.0.0]: comment literal
-->
<pre>
## Pre heading
[8.0.0]: pre literal
</pre>
<script>
## Script heading
</script>
<style>
## Style heading
</style>
<textarea>
## Textarea heading
</textarea>
<div>
## Block-tag heading
[8.0.0]: block literal
</div>

- Real release item.
`;
		const prepared = prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05");
		expect(prepared).toContain("## [1.0.0] - 2026-09-05\n\n<!--\n## Comment heading");
		expect(prepared).toContain("<pre>\n## Pre heading\n[8.0.0]: pre literal\n</pre>");
		expect(prepared).toContain("<div>\n## Block-tag heading\n[8.0.0]: block literal\n</div>");
		expect(prepared).toContain("- Real release item.");
	});

	test("honors the shared CommonMark end condition for raw HTML tags", () => {
		const markdown = "## [Unreleased]\n\n<pre>\n## Literal heading\n</script>\n\n- Real release item.\n\n## [0.9.0] - 2026-08-01\n\n- Previous.\n";
		const prepared = prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05");
		expect(prepared).toContain("<pre>\n## Literal heading\n</script>\n\n- Real release item.");
		expect(prepared).toContain("[1.0.0]: https://github.com/finos/morphir-typescript/compare/v0.9.0...v1.0.0");
	});

	test("rewrites 1-to-3-space comparison definitions but preserves 4-space code", () => {
		const markdown = `## [Unreleased]

- Ready.

## [0.9.0] - 2026-08-01

- Previous.

    [8.0.0]: literal indented code

 [Unreleased]: https://github.com/finos/morphir-typescript/compare/v0.9.0...HEAD
  [0.9.0]: https://github.com/finos/morphir-typescript/releases/tag/v0.9.0
`;
		const prepared = prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05");
		expect(prepared).toContain("    [8.0.0]: literal indented code");
		expect(prepared.match(/^\s{2}\[0\.9\.0\]: https:\/\/github\.com\/finos\/morphir-typescript\/releases\/tag\/v0\.9\.0$/gm)).toHaveLength(1);
		expect(prepared).not.toContain(" [Unreleased]: https://github.com/finos/morphir-typescript/compare/v0.9.0...HEAD");
	});

	test("does not rewrite comparison-shaped text in a list", () => {
		const literal = "  [0.9.0]: https://github.com/finos/morphir-typescript/releases/tag/v0.9.0";
		const markdown = `## [Unreleased]

- Example syntax:
${literal}
- Real release item.
`;
		const prepared = prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05");
		expect(prepared).toContain(`- Example syntax:\n${literal}\n- Real release item.`);
	});

	test("removes complete multiline comparison definitions", () => {
		const markdown = `## [Unreleased]

- Ready.

## [0.9.0] - 2026-08-01

- Previous.

[Unreleased]:
  <https://github.com/finos/morphir-typescript/compare/v0.9.0...HEAD>
  "Stale Unreleased comparison"
[0.9.0]:
  <https://github.com/finos/morphir-typescript/releases/tag/v0.9.0>
  "First release"
`;
		const prepared = prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05");
		expect(prepared).not.toContain("Stale Unreleased comparison");
		expect(prepared.match(/First release/g)).toHaveLength(1);
		expect(prepared).toContain("[Unreleased]: https://github.com/finos/morphir-typescript/compare/v1.0.0...HEAD");
	});

	test("preserves a version-labeled repository issue definition", () => {
		const issueDefinition = "[0.9.0]: https://github.com/finos/morphir-typescript/issues/123";
		const markdown = `## [Unreleased]

- Ready.

## [0.9.0] - 2026-08-01

- Previous.

${issueDefinition}
`;
		const prepared = prepareChangelog(markdown, parseStableVersion("1.0.0"), "2026-09-05");
		expect(prepared).toContain(issueDefinition);
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

	test.each(["##  [1.0.0] - 2026-09-05", "##\t[1.0.0] - 2026-09-05"])("rejects non-exact dated heading spacing: %s", (heading) => {
		expect(() => extractReleaseNotes(`${heading}\n\n- Notes.\n`, parseStableVersion("1.0.0"))).toThrow("release 1.0.0 not found in changelog");
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

	test("does not select a release heading inside a code fence", () => {
		const markdown = "```markdown\n## [1.0.0] - 2026-09-05\n\n- Fenced example.\n```\n";
		expect(() => extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toThrow("release 1.0.0 not found in changelog");
	});

	test("does not truncate notes at a fenced h2", () => {
		const markdown = `## [1.0.0] - 2026-09-05

- Before the example.

\`\`\`markdown
## Example heading
\`\`\`

- After the example.

## [0.9.0] - 2026-08-01

- Older.
`;
		expect(extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toBe(`- Before the example.

\`\`\`markdown
## Example heading
\`\`\`

- After the example.
`);
	});

	test("stops at an ordinary root h2", () => {
		const markdown = `## [1.0.0] - 2026-09-05

- Release notes.

## Other

- Not release notes.
`;
		expect(extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toBe("- Release notes.\n");
	});

	test("preserves ordinary definitions and fenced literals while excluding comparison definitions", () => {
		const markdown = `## [1.0.0] - 2026-09-05

- See the docs.

[docs]: https://example.com/docs

\`\`\`markdown
[example]: literal definition
[1.0.0]: literal version definition
\`\`\`

[Unreleased]: https://github.com/finos/morphir-typescript/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/finos/morphir-typescript/releases/tag/v1.0.0
`;
		expect(extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toBe(`- See the docs.

[docs]: https://example.com/docs

\`\`\`markdown
[example]: literal definition
[1.0.0]: literal version definition
\`\`\`
`);
	});

	test("excludes complete multiline comparison definitions with angle-bracket destinations", () => {
		const markdown = `## [1.0.0] - 2026-09-05

- Release notes.

[Unreleased]:
  <https://github.com/finos/morphir-typescript/compare/v1.0.0...HEAD>
  "Unreleased comparison"
[1.0.0]:
  <https://github.com/finos/morphir-typescript/releases/tag/v1.0.0>
  "Release comparison"
`;
		expect(extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toBe("- Release notes.\n");
	});

	test("preserves a version-labeled repository issue definition", () => {
		const issueDefinition = "[1.0.0]: https://github.com/finos/morphir-typescript/issues/123";
		const markdown = `## [1.0.0] - 2026-09-05

- Release notes.

${issueDefinition}
`;
		expect(extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toBe(`- Release notes.\n\n${issueDefinition}\n`);
	});

	test("does not select a target heading from an HTML comment", () => {
		const markdown = "<!--\n## [1.0.0] - 2026-09-05\n\n- Comment literal.\n-->\n";
		expect(() => extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toThrow("release 1.0.0 not found in changelog");
	});

	test("preserves HTML literals while ignoring their headings and definitions", () => {
		const markdown = `## [1.0.0] - 2026-09-05

- Before HTML.

<!--
## Comment heading
[docs]: comment literal
-->
<pre>
## Pre heading
[docs]: pre literal
</pre>
<script>
## Script heading
</script>
<style>
## Style heading
</style>
<textarea>
## Textarea heading
</textarea>
<section>
## Block-tag heading
[docs]: block literal
</section>

- After HTML.

[docs]: https://example.com/docs
`;
		const notes = extractReleaseNotes(markdown, parseStableVersion("1.0.0"));
		expect(notes).toContain("<!--\n## Comment heading\n[docs]: comment literal\n-->");
		expect(notes).toContain("<pre>\n## Pre heading\n[docs]: pre literal\n</pre>");
		expect(notes).toContain("<section>\n## Block-tag heading\n[docs]: block literal\n</section>");
		expect(notes).toContain("- After HTML.");
		expect(notes).toContain("[docs]: https://example.com/docs");
	});

	test("preserves ordinary definitions regardless of valid root indentation", () => {
		const markdown = `## [1.0.0] - 2026-09-05

- Notes.

 [one]: https://example.com/one
  [two]: https://example.com/two
   [three]: https://example.com/three
    [literal]: indented code
`;
		expect(extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toBe(`- Notes.

 [one]: https://example.com/one
  [two]: https://example.com/two
   [three]: https://example.com/three
    [literal]: indented code
`);
	});

	test("does not remove comparison-shaped text from a list", () => {
		const literal = "  [1.0.0]: https://github.com/finos/morphir-typescript/releases/tag/v1.0.0";
		const markdown = `## [1.0.0] - 2026-09-05

- Example syntax:
${literal}
- Still release content.
`;
		expect(extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toContain(literal);
	});

	test("uses CommonMark semantics for lowercase declaration-like text", () => {
		const markdown = `## [1.0.0] - 2026-09-05

<!doctype
## [9.9.9] - 2026-09-05
>

- Real notes.
`;
		expect(extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toBe(`<!doctype
## [9.9.9] - 2026-09-05
>

- Real notes.
`);
	});

	test("uses CommonMark paragraph context for type-7 HTML blocks", () => {
		const markdown = `## [1.0.0] - 2026-09-05

Paragraph text.
<custom-element>
## [0.9.0] - 2026-08-01

- Older notes.
`;
		expect(extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toBe("Paragraph text.\n<custom-element>\n");
	});

	test("uses CommonMark tag parsing when an attribute contains a greater-than sign", () => {
		const markdown = `## [1.0.0] - 2026-09-05

<custom-element data-value="a > b">
## [9.9.9] - 2026-09-05
</custom-element>

- Real notes.
`;
		expect(extractReleaseNotes(markdown, parseStableVersion("1.0.0"))).toContain('<custom-element data-value="a > b">\n## [9.9.9] - 2026-09-05');
	});
});
