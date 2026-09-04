import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCorpus } from "./load.ts";

const dirs: string[] = [];
const temp = (): string => {
	const d = mkdtempSync(path.join(tmpdir(), "corpus-load-"));
	dirs.push(d);
	return d;
};
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { force: true, recursive: true }); });

const okCase = (topic: string, n: string) =>
	`## ${topic}-${n}: a case\n\`\`\`yaml canonical\na: 1\n\`\`\`\n`;

describe("loadCorpus", () => {
	test("loads every corpus file except README and reports no errors", async () => {
		const d = temp();
		writeFileSync(path.join(d, "README.md"), "# not a corpus file\n## types-0001: nope\n");
		writeFileSync(path.join(d, "types.md"), okCase("types", "0001"));
		writeFileSync(path.join(d, "values.md"), okCase("values", "0001"));
		mkdirSync(path.join(d, "documents"));
		const corpus = await loadCorpus(d);
		expect(corpus.errors).toEqual([]);
		expect(corpus.files.map((f) => path.basename(f))).toEqual(["types.md", "values.md"]);
		expect(corpus.cases.map((c) => c.id)).toEqual(["types-0001", "values-0001"]);
	});

	test("an id used in two files is an error", async () => {
		const d = temp();
		writeFileSync(path.join(d, "types.md"), okCase("types", "0001"));
		writeFileSync(path.join(d, "values.md"), okCase("types", "0001"));
		const corpus = await loadCorpus(d);
		expect(corpus.errors.map((e) => e.message).join("\n")).toMatch(/does not match file topic|duplicate case id "types-0001" across files/);
	});

	test("a directory with no corpus files is an error", async () => {
		const d = temp();
		const corpus = await loadCorpus(d);
		expect(corpus.errors[0]?.message).toMatch(/no corpus files/);
	});
});
