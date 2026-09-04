//
// Line-oriented tokenizer for MCK case-file markdown. The kit grammar needs
// only four block kinds (front matter, ATX headings, fenced code, prose), so
// this is deliberately not a general markdown parser and has no dependencies.
//
// Rules:
// - Front matter is a leading `---` line through the next `---` line.
// - A fence opens with three or more backticks at column 0 and closes with a
//   line of at least as many backticks and nothing else. Inside a fence every
//   line is body text, headings included.
// - A heading is `#` x1..6, a space, and text, outside fences.
// - Consecutive non-blank lines outside fences form one prose block.

export type Block =
	| { readonly kind: "frontMatter"; readonly text: string; readonly line: number }
	| { readonly kind: "heading"; readonly level: number; readonly text: string; readonly line: number }
	| { readonly kind: "fence"; readonly info: string; readonly body: string; readonly line: number; readonly closed: boolean }
	| { readonly kind: "prose"; readonly text: string; readonly line: number };

const FENCE_OPEN = /^(`{3,})(.*)$/;
const HEADING = /^(#{1,6}) (.+?)\s*$/;

export function tokenize(source: string): readonly Block[] {
	const withoutBom = source.startsWith("﻿") ? source.slice(1) : source;
	const lines = withoutBom.split(/\r?\n/);
	// A trailing newline yields a final empty element; drop it so line counts match editors.
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

	const blocks: Block[] = [];
	let index = 0;

	if (lines[0] === "---") {
		const end = lines.indexOf("---", 1);
		const stop = end === -1 ? lines.length : end;
		blocks.push({ kind: "frontMatter", text: lines.slice(1, stop).join("\n"), line: 1 });
		index = stop + 1;
	}

	let prose: { readonly line: number; readonly lines: string[] } | null = null;
	const flushProse = (): void => {
		if (prose !== null) {
			blocks.push({ kind: "prose", text: prose.lines.join("\n"), line: prose.line });
			prose = null;
		}
	};

	while (index < lines.length) {
		const line = lines[index] ?? "";
		const fence = FENCE_OPEN.exec(line);
		if (fence !== null) {
			flushProse();
			const ticks = fence[1] ?? "";
			const info = (fence[2] ?? "").trim();
			const start = index;
			const body: string[] = [];
			index += 1;
			let closed = false;
			while (index < lines.length) {
				const candidate = lines[index] ?? "";
				if (/^`+\s*$/.test(candidate) && candidate.trim().length >= ticks.length) {
					closed = true;
					index += 1;
					break;
				}
				body.push(candidate);
				index += 1;
			}
			blocks.push({ kind: "fence", info, body: body.map((l) => `${l}\n`).join(""), line: start + 1, closed });
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading !== null) {
			flushProse();
			blocks.push({
				kind: "heading",
				level: (heading[1] ?? "#").length,
				text: heading[2] ?? "",
				line: index + 1,
			});
			index += 1;
			continue;
		}

		if (line.trim() === "") {
			flushProse();
			index += 1;
			continue;
		}

		if (prose === null) prose = { line: index + 1, lines: [] };
		prose.lines.push(line);
		index += 1;
	}
	flushProse();
	return blocks;
}
