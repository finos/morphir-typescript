// packages/ir/src/codec/json/value.ts
//
// A strict JSON value layer. JSON.parse cannot reject duplicate members or
// preserve number lexemes, and both are required by the v4 JSON profile, so
// this is a small hand-written RFC 8259 parser and a canonical one-line writer.
import { type Json, type JsonNumber, type JsonObject, isJsonNumber, isJsonObject } from "../../model/attributes.ts";
import { type Diagnostic, diagnostic } from "../../model/diagnostic.ts";
import { type Result, err, ok } from "../../model/result.ts";

// The value tree is declared in the model, because an opaque attribute payload
// is one of these trees carried through unread. There is one tree, not two that
// happen to match, so a payload can never be mistaken for a codec value or the
// other way round.
export type { Json, JsonNumber, JsonObject };
export type JsonValue = Json;

export function jsonNumber(text: string): JsonNumber { return { kind: "number", text }; }
export function jsonObject(entries: readonly (readonly [string, JsonValue])[]): JsonObject {
	return { kind: "object", members: new Map(entries) };
}
export function isObject(v: JsonValue): v is JsonObject { return isJsonObject(v); }
export function isNumber(v: JsonValue): v is JsonNumber { return isJsonNumber(v); }
export function isInteger(n: JsonNumber): boolean { return !/[.eE]/.test(n.text); }

export interface JsonLocation { readonly line: number; readonly column: number }

// Where a value started in the source. JsonValue stays a plain structural type
// — a reader can build one by hand, and two trees that mean the same thing
// still compare equal — so the location lives beside the tree in a side table
// keyed by identity. Only the composite values and numbers have an identity to
// key on; strings, booleans and null are shared primitives and report null.
const locations = new WeakMap<object, JsonLocation>();

export function locationOf(v: JsonValue): JsonLocation | null {
	return typeof v === "object" && v !== null ? locations.get(v) ?? null : null;
}

const NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/;

// A reader must return a diagnostic rather than exhaust the stack, and this
// parser descends recursively, so nesting is bounded here. 1000 is far past
// anything a compiler emits and far short of the engine's limit.
export const MAX_DEPTH = 1000;

class Parser {
	private pos = 0;
	private line = 1;
	private col = 1;
	constructor(private readonly text: string) {}

	private fail(message: string): Diagnostic {
		return diagnostic("invalid_json", "syntax", "", message, { line: this.line, column: this.col });
	}
	private tooDeep(cursor: string): Diagnostic {
		return diagnostic("nesting_too_deep", "syntax", cursor || "/", `nesting deeper than ${MAX_DEPTH} is not accepted`, { line: this.line, column: this.col });
	}
	private peek(): string { return this.text[this.pos] ?? ""; }
	private advance(n: number): void {
		for (let i = 0; i < n; i += 1) {
			if (this.text[this.pos] === "\n") { this.line += 1; this.col = 1; } else { this.col += 1; }
			this.pos += 1;
		}
	}
	private ws(): void { while (/[ \t\n\r]/.test(this.peek())) this.advance(1); }
	private here(): JsonLocation { return { line: this.line, column: this.col }; }
	private located<T extends object>(node: T, at: JsonLocation): T {
		locations.set(node, at);
		return node;
	}

	parseDocument(): Result<JsonValue, Diagnostic> {
		this.ws();
		const v = this.parseValue("", 0);
		if (!v.ok) return v;
		this.ws();
		if (this.pos !== this.text.length) return err(this.fail("trailing content after the JSON value"));
		return v;
	}

	private parseValue(cursor: string, depth: number): Result<JsonValue, Diagnostic> {
		const c = this.peek();
		if (c === "{") return this.parseObject(cursor, depth);
		if (c === "[") return this.parseArray(cursor, depth);
		if (c === '"') return this.parseString();
		if (this.text.startsWith("true", this.pos)) { this.advance(4); return ok(true); }
		if (this.text.startsWith("false", this.pos)) { this.advance(5); return ok(false); }
		if (this.text.startsWith("null", this.pos)) { this.advance(4); return ok(null); }
		const m = NUMBER.exec(this.text.slice(this.pos));
		if (m !== null) {
			const start = this.here();
			this.advance(m[0].length);
			return ok(this.located(jsonNumber(m[0]), start));
		}
		return err(this.fail(c === "" ? "unexpected end of input" : `unexpected character "${c}"`));
	}

	private parseObject(cursor: string, depth: number): Result<JsonValue, Diagnostic> {
		if (depth >= MAX_DEPTH) return err(this.tooDeep(cursor));
		const start = this.here();
		this.advance(1);
		const members = new Map<string, JsonValue>();
		// The node is created before its members are read so the location is
		// recorded against the identity the caller will see.
		const node = this.located<JsonObject>({ kind: "object", members }, start);
		this.ws();
		if (this.peek() === "}") { this.advance(1); return ok(node); }
		for (;;) {
			this.ws();
			if (this.peek() !== '"') return err(this.fail("expected a member name"));
			const key = this.parseString();
			if (!key.ok) return key;
			const name = key.value as string;
			this.ws();
			if (this.peek() !== ":") return err(this.fail('expected ":"'));
			this.advance(1);
			this.ws();
			const value = this.parseValue(`${cursor}/${name}`, depth + 1);
			if (!value.ok) return value;
			if (members.has(name)) {
				return err(diagnostic("duplicate_member", "syntax", `${cursor}/${name}`, `duplicate member "${name}"`, { line: this.line, column: this.col }));
			}
			members.set(name, value.value);
			this.ws();
			if (this.peek() === ",") { this.advance(1); continue; }
			if (this.peek() === "}") { this.advance(1); return ok(node); }
			return err(this.fail('expected "," or "}"'));
		}
	}

	private parseArray(cursor: string, depth: number): Result<JsonValue, Diagnostic> {
		if (depth >= MAX_DEPTH) return err(this.tooDeep(cursor));
		const start = this.here();
		this.advance(1);
		const items = this.located<JsonValue[]>([], start);
		this.ws();
		if (this.peek() === "]") { this.advance(1); return ok(items); }
		for (;;) {
			this.ws();
			const v = this.parseValue(`${cursor}/${items.length}`, depth + 1);
			if (!v.ok) return v;
			items.push(v.value);
			this.ws();
			if (this.peek() === ",") { this.advance(1); continue; }
			if (this.peek() === "]") { this.advance(1); return ok(items); }
			return err(this.fail('expected "," or "]"'));
		}
	}

	private parseString(): Result<JsonValue, Diagnostic> {
		this.advance(1);
		let out = "";
		for (;;) {
			const c = this.peek();
			if (c === "") return err(this.fail("unterminated string"));
			if (c === '"') { this.advance(1); return ok(out); }
			if (c === "\\") {
				const e = this.text[this.pos + 1] ?? "";
				const simple: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
				if (e in simple) { out += simple[e]; this.advance(2); continue; }
				if (e === "u") {
					const hex = this.text.slice(this.pos + 2, this.pos + 6);
					if (!/^[0-9a-fA-F]{4}$/.test(hex)) return err(this.fail("invalid \\u escape"));
					out += String.fromCharCode(Number.parseInt(hex, 16));
					this.advance(6);
					continue;
				}
				return err(this.fail(`invalid escape "\\${e}"`));
			}
			if (c < " ") return err(this.fail("control character in string"));
			out += c;
			this.advance(1);
		}
	}
}

export function parseJson(text: string): Result<JsonValue, Diagnostic> {
	return new Parser(text.startsWith("\uFEFF") ? text.slice(1) : text).parseDocument();
}

function writeString(s: string): string {
	return `"${s.replace(/[\\"\u0000-\u001f]/g, (ch) => {
		switch (ch) {
			case '"': return '\\"'; case "\\": return "\\\\"; case "\n": return "\\n"; case "\r": return "\\r";
			case "\t": return "\\t"; case "\b": return "\\b"; case "\f": return "\\f";
			default: return `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
		}
	})}"`;
}

export function writeJson(value: JsonValue): string {
	if (value === null) return "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "string") return writeString(value);
	if (isNumber(value)) return value.text;
	if (isObject(value)) {
		const entries = [...value.members.entries()];
		return entries.length === 0 ? "{}" : `{ ${entries.map(([k, v]) => `${writeString(k)}: ${writeJson(v)}`).join(", ")} }`;
	}
	return value.length === 0 ? "[]" : `[${value.map(writeJson).join(", ")}]`;
}
