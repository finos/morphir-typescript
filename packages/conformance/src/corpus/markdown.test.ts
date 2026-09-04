//
// Tests for the corpus markdown tokenizer. Run with: bun test src/corpus/markdown.test.ts
import { describe, expect, test } from "bun:test";
import { tokenize } from "./markdown.ts";

describe("tokenize", () => {
	test("splits front matter, headings, fences, and prose", () => {
		const source = [
			"---",
			"corpus: ir-v4-encoding",
			"---",
			"# Title",
			"",
			"## types-0001: Something {node=Type}",
			"Some prose.",
			"```yaml canonical",
			"Unit: {}",
			"```",
		].join("\n");
		const blocks = tokenize(source);
		expect(blocks).toEqual([
			{ kind: "frontMatter", text: "corpus: ir-v4-encoding", line: 1 },
			{ kind: "heading", level: 1, text: "Title", line: 4 },
			{ kind: "heading", level: 2, text: "types-0001: Something {node=Type}", line: 6 },
			{ kind: "prose", text: "Some prose.", line: 7 },
			{ kind: "fence", info: "yaml canonical", body: "Unit: {}\n", line: 8, closed: true },
		]);
	});

	test("a four-backtick fence may contain three-backtick fences", () => {
		const source = ["````markdown", "```yaml canonical", "x: 1", "```", "````"].join("\n");
		const blocks = tokenize(source);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toEqual({
			kind: "fence",
			info: "markdown",
			body: "```yaml canonical\nx: 1\n```\n",
			line: 1,
			closed: true,
		});
	});

	test("headings inside a fence are body text", () => {
		const source = ["```text", "## not-a-case-0001: nope", "```"].join("\n");
		const blocks = tokenize(source);
		expect(blocks.map((b) => b.kind)).toEqual(["fence"]);
	});

	test("an unterminated fence is reported as a fence running to end of file", () => {
		const blocks = tokenize("```yaml canonical\na: 1\n");
		expect(blocks[0]).toEqual({ kind: "fence", info: "yaml canonical", body: "a: 1\n", line: 1, closed: false });
	});

	test("blank lines separate prose blocks and are not emitted", () => {
		const blocks = tokenize("one\n\ntwo\n");
		expect(blocks).toEqual([
			{ kind: "prose", text: "one", line: 1 },
			{ kind: "prose", text: "two", line: 3 },
		]);
	});

	test("a leading UTF-8 BOM is stripped before splitting", () => {
		const blocks = tokenize("﻿## x");
		expect(blocks).toEqual([{ kind: "heading", level: 2, text: "x", line: 1 }]);
	});
});
