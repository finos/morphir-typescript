//
// Turns one corpus markdown file into cases. An H2 opens a case; its fences are
// the data; everything else under it is prose. Every structural rule from the
// corpus README is enforced here and reported as a CorpusError with a line, so
// the check command can print `file:line: message`.
import { type FenceInfo, isInfoError, parseInfoString } from "./info-string.ts";
import { type Block, tokenize } from "./markdown.ts";

export interface CorpusFence {
	readonly info: FenceInfo;
	readonly body: string;
	readonly line: number;
	readonly index: number;
}

export interface CorpusCase {
	readonly id: string;
	readonly topic: string;
	readonly number: number;
	readonly title: string;
	readonly node: string | null;
	readonly version: number | null;
	readonly status: "active" | "pending";
	readonly compare: "stripped" | "attributes";
	readonly prose: readonly string[];
	readonly fences: readonly CorpusFence[];
	readonly file: string;
	readonly line: number;
}

export interface CorpusError {
	readonly file: string;
	readonly line: number;
	readonly message: string;
}

export interface ParsedFile {
	readonly cases: readonly CorpusCase[];
	readonly errors: readonly CorpusError[];
}

const HEADING = /^([a-z][a-z0-9-]*)-(\d{4}): (.+?)(?:\s+\{([^}]*)\})?\s*$/;
const HEADING_KEYS: ReadonlySet<string> = new Set(["node", "version", "status", "compare"]);

export function topicOf(file: string): string {
	const base = file.split(/[\\/]/).pop() ?? file;
	return base.replace(/\.md$/, "");
}

interface Draft {
	id: string;
	topic: string;
	number: number;
	title: string;
	node: string | null;
	version: number | null;
	status: "active" | "pending";
	compare: "stripped" | "attributes";
	prose: string[];
	fences: CorpusFence[];
	file: string;
	line: number;
}

export function parseCorpusFile(file: string, source: string): ParsedFile {
	const fileTopic = topicOf(file);
	const errors: CorpusError[] = [];
	const cases: CorpusCase[] = [];
	const seen = new Set<string>();
	let draft: Draft | null = null;

	const fail = (line: number, message: string): void => {
		errors.push({ file, line, message });
	};

	const finish = (): void => {
		const current = draft;
		if (current === null) return;
		const canonicals = new Map<string, number>();
		for (const fence of current.fences) {
			if (fence.info.role === "canonical") {
				const count = (canonicals.get(fence.info.language) ?? 0) + 1;
				canonicals.set(fence.info.language, count);
				if (count === 2) fail(fence.line, `more than one canonical ${fence.info.language} fence in ${current.id}`);
			}
		}
		if (current.status === "pending") {
			const bad = current.fences.find((f) => f.info.role !== "rejected");
			if (bad !== undefined) fail(bad.line, `pending case may not carry canonical, accepted, or file fences (${current.id})`);
		} else if (canonicals.size === 0) {
			fail(current.line, `active case has no canonical fence (${current.id})`);
		}
		cases.push({ ...current, prose: [...current.prose], fences: [...current.fences] });
		draft = null;
	};

	const openCase = (block: Extract<Block, { kind: "heading" }>): void => {
		finish();
		const match = HEADING.exec(block.text);
		if (match === null) {
			fail(block.line, `malformed case id in heading "${block.text}"; expected "<topic>-<NNNN>: <title>"`);
			return;
		}
		const topic = match[1] ?? "";
		const number = Number.parseInt(match[2] ?? "0", 10);
		const title = match[3] ?? "";
		const id = `${topic}-${match[2]}`;
		if (topic !== fileTopic) fail(block.line, `topic "${topic}" does not match file topic "${fileTopic}"`);
		if (seen.has(id)) fail(block.line, `duplicate case id "${id}"`);
		seen.add(id);

		const next: Draft = {
			id, topic, number, title,
			node: null, version: null, status: "active", compare: "stripped",
			prose: [], fences: [], file, line: block.line,
		};
		for (const token of (match[4] ?? "").trim().split(/\s+/).filter((t) => t.length > 0)) {
			const eq = token.indexOf("=");
			const key = eq > 0 ? token.slice(0, eq) : token;
			const value = eq > 0 ? token.slice(eq + 1) : "";
			if (!HEADING_KEYS.has(key)) { fail(block.line, `unknown heading key "${key}"`); continue; }
			if (key === "node") next.node = value;
			if (key === "version") {
				const v = Number.parseInt(value, 10);
				if (Number.isNaN(v)) fail(block.line, `version must be an integer, got "${value}"`);
				else next.version = v;
			}
			if (key === "status") {
				if (value === "pending") next.status = "pending";
				else fail(block.line, `status must be pending, got "${value}"`);
			}
			if (key === "compare") {
				if (value === "attributes") next.compare = "attributes";
				else fail(block.line, `compare must be attributes, got "${value}"`);
			}
		}
		draft = next;
	};

	// Handling a block is factored into its own closure (rather than inlined in
	// the loop below) because reads of `draft` inside a nested function use its
	// declared type; inlined in the loop body, some TypeScript versions narrow
	// `draft` to `null` across loop iterations despite the mutations in
	// `openCase`/`finish`, which are also closures.
	const handleBlock = (block: Block): void => {
		switch (block.kind) {
			case "frontMatter":
				break;
			case "heading":
				if (block.level === 2) {
					openCase(block);
				} else if (block.level > 2 && draft !== null) {
					draft.prose.push(block.text);
				}
				break;
			case "prose":
				if (draft !== null) draft.prose.push(block.text);
				break;
			case "fence": {
				const info = parseInfoString(block.info);
				if (isInfoError(info)) {
					if (!info.message.startsWith("not a data fence")) fail(block.line, info.message);
					break;
				}
				if (draft === null) { fail(block.line, "data fence before the first case"); break; }
				draft.fences.push({ info, body: block.body, line: block.line, index: draft.fences.length });
				break;
			}
		}
	};

	for (const block of tokenize(source)) handleBlock(block);
	finish();
	return { cases, errors };
}
