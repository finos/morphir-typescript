// packages/ir/src/model/names.ts
//
// Name, Path, PackageName, ModuleName, QName and FQName as branded newtypes.
// A name is a list of segments; each segment is a word or an initialism
// (decision 0001). The brand is unreachable outside this module, so the only
// way to obtain a Name is through a parse function that validated it.
import { type Diagnostic, diagnostic } from "./diagnostic.ts";
import { type Result, err, ok } from "./result.ts";

export interface Segment {
	readonly kind: "word" | "initialism";
	readonly text: string;
}

declare const nameBrand: unique symbol;
export interface Name { readonly [nameBrand]: "Name"; readonly segments: readonly Segment[] }
export interface Path { readonly [nameBrand]: "Path"; readonly names: readonly Name[] }
export interface PackageName { readonly [nameBrand]: "PackageName"; readonly path: Path }
export interface ModuleName { readonly [nameBrand]: "ModuleName"; readonly path: Path }
export interface QName { readonly [nameBrand]: "QName"; readonly module: ModuleName; readonly local: Name }
export interface FQName {
	readonly [nameBrand]: "FQName";
	readonly package: PackageName;
	readonly module: ModuleName;
	readonly local: Name;
}

export type NameStyle = "uppercase" | "doubledHyphen";
export const CANONICAL_STYLE: NameStyle = "uppercase";

export const RESERVED_DEVICE_STEMS: ReadonlySet<string> = new Set([
	"con", "prn", "aux", "nul",
	"com0", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
	"lpt0", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

const UPPERCASE_STYLE = /^([a-z0-9]+|[A-Z0-9]+)(-([a-z0-9]+|[A-Z0-9]+))*$/;
const DOUBLED_HYPHEN_STYLE = /^(--)?[a-z0-9]+(--?[a-z0-9]+)*$/;
const LEGACY_WORD = /^[a-z0-9]+$/;

const brand = <T>(value: object): T => value as T;

function invalid(code: "invalid_name" | "invalid_path" | "invalid_fqname", text: string): Diagnostic {
	return diagnostic(code, "normalization", "", `not a canonical ${code.slice(8)}: "${text}"`);
}

function parseSegments(text: string): readonly Segment[] | null {
	if (UPPERCASE_STYLE.test(text)) {
		return text.split("-").map((s) => ({
			kind: /[A-Z]/.test(s) ? "initialism" : "word",
			text: s.toLowerCase(),
		}));
	}
	if (DOUBLED_HYPHEN_STYLE.test(text)) {
		const segments: Segment[] = [];
		// Tokenize: a "--" marks the following segment as an initialism.
		let rest = text;
		let first = true;
		while (rest.length > 0) {
			let initialism = false;
			if (rest.startsWith("--")) { initialism = true; rest = rest.slice(2); }
			else if (!first && rest.startsWith("-")) { rest = rest.slice(1); }
			const m = /^[a-z0-9]+/.exec(rest);
			if (m === null) return null;
			segments.push({ kind: initialism ? "initialism" : "word", text: m[0] });
			rest = rest.slice(m[0].length);
			first = false;
		}
		return segments;
	}
	return null;
}

function renderSegments(segments: readonly Segment[], style: NameStyle): string {
	if (style === "uppercase") {
		return segments.map((s) => (s.kind === "initialism" ? s.text.toUpperCase() : s.text)).join("-");
	}
	// Doubled-hyphen style: an initialism is always preceded by "--" (whether
	// it is the first segment or not); a non-initial word is preceded by a
	// single "-" separator; the first word carries no prefix at all.
	return segments
		.map((s, i) => (s.kind === "initialism" ? `--${s.text}` : `${i === 0 ? "" : "-"}${s.text}`))
		.join("");
}

export const Name = {
	parse(text: string): Result<Name, Diagnostic> {
		const segments = parseSegments(text);
		return segments === null ? err(invalid("invalid_name", text)) : ok(Name.fromSegments(segments));
	},
	fromLegacyArray(words: readonly string[]): Result<Name, Diagnostic> {
		if (words.length === 0 || words.some((w) => !LEGACY_WORD.test(w))) {
			return err(invalid("invalid_name", JSON.stringify(words)));
		}
		const segments: Segment[] = [];
		let i = 0;
		while (i < words.length) {
			let j = i;
			while (j < words.length && (words[j] ?? "").length === 1 && /[a-z]/.test(words[j] ?? "")) j += 1;
			if (j - i >= 2) {
				segments.push({ kind: "initialism", text: words.slice(i, j).join("") });
				i = j;
			} else {
				segments.push({ kind: "word", text: words[i] ?? "" });
				i += 1;
			}
		}
		return ok(Name.fromSegments(segments));
	},
	fromSegments(segments: readonly Segment[]): Name {
		return brand<Name>({ segments: segments.map((s) => ({ kind: s.kind, text: s.text.toLowerCase() })) });
	},
	canonical(name: Name, style: NameStyle = CANONICAL_STYLE): string {
		return renderSegments(name.segments, style);
	},
	legacyArray(name: Name): readonly string[] {
		return name.segments.flatMap((s) => (s.kind === "initialism" ? [...s.text] : [s.text]));
	},
	fileStem(name: Name): string {
		const stem = name.segments.map((s) => (s.kind === "initialism" ? `_${s.text}` : s.text)).join("-");
		return RESERVED_DEVICE_STEMS.has(stem) ? `${stem}_` : stem;
	},
	equals(a: Name, b: Name): boolean {
		return a.segments.length === b.segments.length
			&& a.segments.every((s, i) => s.kind === b.segments[i]?.kind && s.text === b.segments[i]?.text);
	},
};

export const Path = {
	parse(text: string): Result<Path, Diagnostic> {
		if (text.length === 0) return err(invalid("invalid_path", text));
		const names: Name[] = [];
		for (const part of text.split("/")) {
			const r = Name.parse(part);
			if (!r.ok) return err(invalid("invalid_path", text));
			names.push(r.value);
		}
		return ok(Path.fromNames(names));
	},
	fromLegacyArray(words: readonly (readonly string[])[]): Result<Path, Diagnostic> {
		if (words.length === 0) return err(invalid("invalid_path", "[]"));
		const names: Name[] = [];
		for (const w of words) {
			const r = Name.fromLegacyArray(w);
			if (!r.ok) return err(invalid("invalid_path", JSON.stringify(words)));
			names.push(r.value);
		}
		return ok(Path.fromNames(names));
	},
	fromNames(names: readonly Name[]): Path {
		return brand<Path>({ names: [...names] });
	},
	canonical(path: Path, style: NameStyle = CANONICAL_STYLE): string {
		return path.names.map((n) => Name.canonical(n, style)).join("/");
	},
	escaped(path: Path): string {
		return path.names.map((n) => Name.fileStem(n)).join("/");
	},
	equals(a: Path, b: Path): boolean {
		return a.names.length === b.names.length && a.names.every((n, i) => Name.equals(n, b.names[i] as Name));
	},
};

export const PackageName = {
	of(path: Path): PackageName { return brand<PackageName>({ path }); },
	parse(text: string): Result<PackageName, Diagnostic> {
		const r = Path.parse(text);
		return r.ok ? ok(PackageName.of(r.value)) : r;
	},
	canonical(p: PackageName, style: NameStyle = CANONICAL_STYLE): string { return Path.canonical(p.path, style); },
	equals(a: PackageName, b: PackageName): boolean { return Path.equals(a.path, b.path); },
};

export const ModuleName = {
	of(path: Path): ModuleName { return brand<ModuleName>({ path }); },
	parse(text: string): Result<ModuleName, Diagnostic> {
		const r = Path.parse(text);
		return r.ok ? ok(ModuleName.of(r.value)) : r;
	},
	canonical(m: ModuleName, style: NameStyle = CANONICAL_STYLE): string { return Path.canonical(m.path, style); },
	equals(a: ModuleName, b: ModuleName): boolean { return Path.equals(a.path, b.path); },
};

export const QName = {
	of(module: ModuleName, local: Name): QName { return brand<QName>({ module, local }); },
	canonical(q: QName, style: NameStyle = CANONICAL_STYLE): string {
		return `${ModuleName.canonical(q.module, style)}#${Name.canonical(q.local, style)}`;
	},
};

export const FQName = {
	parse(text: string): Result<FQName, Diagnostic> {
		const colon = text.indexOf(":");
		const hash = text.lastIndexOf("#");
		if (colon <= 0 || hash <= colon + 1 || hash === text.length - 1) return err(invalid("invalid_fqname", text));
		const pkg = PackageName.parse(text.slice(0, colon));
		const mod = ModuleName.parse(text.slice(colon + 1, hash));
		const local = Name.parse(text.slice(hash + 1));
		if (!pkg.ok || !mod.ok || !local.ok) return err(invalid("invalid_fqname", text));
		return ok(FQName.of(pkg.value, mod.value, local.value));
	},
	of(pkg: PackageName, mod: ModuleName, local: Name): FQName {
		return brand<FQName>({ package: pkg, module: mod, local });
	},
	canonical(fq: FQName, style: NameStyle = CANONICAL_STYLE): string {
		return `${PackageName.canonical(fq.package, style)}:${ModuleName.canonical(fq.module, style)}#${Name.canonical(fq.local, style)}`;
	},
	equals(a: FQName, b: FQName): boolean {
		return PackageName.equals(a.package, b.package) && ModuleName.equals(a.module, b.module) && Name.equals(a.local, b.local);
	},
};
