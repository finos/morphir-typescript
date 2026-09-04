//
// Tests for the corpus case parser. Run with: bun test src/corpus/case.test.ts
import { describe, expect, test } from "bun:test";
import { parseCorpusFile, topicOf } from "./case.ts";

const file = "spec/ir/corpus/types.md";

const good = [
	"# Types",
	"",
	"## types-0001: Unit type {node=Type version=4}",
	"Prose line.",
	"```yaml canonical",
	"Unit: {}",
	"```",
	"```json accepted",
	'{ "Unit": {} }',
	"```",
	"",
	"## types-0002: Undecided thing {node=Type status=pending}",
	"Why it is pending.",
	"```json rejected diagnostic=ambiguous_shorthand",
	"[1]",
	"```",
].join("\n");

describe("topicOf", () => {
	test("strips directory and extension", () => {
		expect(topicOf("spec/ir/corpus/patterns-and-literals.md")).toBe("patterns-and-literals");
		expect(topicOf("C:\\repo\\spec\\ir\\corpus\\types.md")).toBe("types");
	});
});

describe("parseCorpusFile", () => {
	test("parses cases, keys, prose, and fences", () => {
		const { cases, errors } = parseCorpusFile(file, good);
		expect(errors).toEqual([]);
		expect(cases).toHaveLength(2);
		const [first, second] = cases;
		expect(first).toMatchObject({
			id: "types-0001",
			topic: "types",
			number: 1,
			title: "Unit type",
			node: "Type",
			version: 4,
			status: "active",
			compare: "stripped",
			prose: ["Prose line."],
			file,
			line: 3,
		});
		expect(first?.fences.map((f) => [f.info.role, f.info.language, f.index])).toEqual([
			["canonical", "yaml", 0],
			["accepted", "json", 1],
		]);
		expect(second).toMatchObject({ id: "types-0002", status: "pending", version: null });
	});

	test.each([
		["## types-1: bad id", /malformed case id/],
		["## values-0001: wrong topic", /topic "values" does not match file topic "types"/],
		["## types-0001: dup\n```yaml canonical\na: 1\n```\n## types-0001: dup again\n```yaml canonical\na: 1\n```", /duplicate case id "types-0001"/],
		["## types-0001: keys {bogus=1}\n```yaml canonical\na: 1\n```", /unknown heading key "bogus"/],
		["## types-0001: keys {status=done}\n```yaml canonical\na: 1\n```", /status must be pending/],
		["## types-0001: keys {compare=text}\n```yaml canonical\na: 1\n```", /compare must be attributes/],
		["```yaml canonical\na: 1\n```", /data fence before the first case/],
		["## types-0001: two\n```yaml canonical\na: 1\n```\n```yaml canonical\na: 1\n```", /more than one canonical yaml fence/],
		["## types-0001: pending with data {status=pending}\n```yaml canonical\na: 1\n```", /pending case may not carry canonical/],
		["## types-0001: nothing\nprose only", /case has no data fences/],
		["## types-0001: bad fence\n```yaml canonical\na: 1\n```\n```yaml rejected\na: 1\n```", /rejected needs exactly one/],
		["## types-0001: open\n```yaml canonical\na: 1\n", /unterminated fence/],
		["## types-0001: accepted only\n```json accepted\n1\n```", /active case has no canonical fence/],
	])("reports: %s", (source, pattern) => {
		const { errors } = parseCorpusFile(file, source);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.map((e) => e.message).join("\n")).toMatch(pattern);
	});

	test("illustrative fences without a role are ignored", () => {
		const source = "## types-0001: ok\n```ts\nconst x = 1\n```\n```yaml canonical\na: 1\n```";
		const { cases, errors } = parseCorpusFile(file, source);
		expect(errors).toEqual([]);
		expect(cases[0]?.fences).toHaveLength(1);
	});

	test("a heading key block with no space before the brace parses", () => {
		const source = "## types-0001: Tight{node=Type compare=attributes}\n```yaml canonical\na: 1\n```";
		const { cases, errors } = parseCorpusFile(file, source);
		expect(errors).toEqual([]);
		expect(cases[0]).toMatchObject({ title: "Tight", node: "Type", compare: "attributes" });
	});

	test("a rejection-only active case is legal", () => {
		const source = "## types-0001: reject only\n```json rejected diagnostic=x\n1\n```";
		const { cases, errors } = parseCorpusFile(file, source);
		expect(errors).toEqual([]);
		expect(cases[0]?.status).toBe("active");
	});

	test("canonical count is per profile, not per language", () => {
		const withDupe = [
			"## types-0001: dupe profile",
			"```json canonical",
			'{ "a": 1 }',
			"```",
			"```text canonical",
			"x.json",
			"```",
		].join("\n");
		const { errors } = parseCorpusFile(file, withDupe);
		expect(errors.map((e) => e.message).join("\n")).toMatch(/more than one canonical json fence/);

		const withoutDupe = [
			"## types-0001: distinct profiles",
			"```yaml canonical",
			"a: 1",
			"```",
			"```text canonical",
			"x.json",
			"```",
		].join("\n");
		expect(parseCorpusFile(file, withoutDupe).errors).toEqual([]);
	});
});
