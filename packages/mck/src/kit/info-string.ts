//
// Grammar of a data fence's info string: `<language> <role> [key=value ...]`.
// Every token is validated; an unknown word is an error rather than ignored, so
// a typo in a role cannot silently turn a case into prose.

export type Language = "yaml" | "json" | "text";
export type Role = "canonical" | "accepted" | "rejected" | "file";

export interface FenceInfo {
	readonly language: Language;
	readonly role: Role;
	readonly keys: Readonly<Record<string, string>>;
}

export interface InfoError {
	readonly message: string;
}

const LANGUAGES: ReadonlySet<string> = new Set(["yaml", "json", "text"]);
const ROLES: ReadonlySet<string> = new Set(["canonical", "accepted", "rejected", "file"]);
const KEYS: Readonly<Record<Role, ReadonlySet<string>>> = {
	canonical: new Set(),
	// warning=<code>: the reader must accept the spelling and report exactly
	// that warning (decision 0006's compatibility window).
	accepted: new Set(["warning"]),
	rejected: new Set(["diagnostic", "expect"]),
	// mode=read: the set holds input a canonical writer never reproduces (a
	// `$meta` member, say), so only the read half of the tree comparison runs
	// for it. It is all-or-nothing per set, which `case.ts` enforces.
	file: new Set(["path", "set", "mode"]),
};

export function isInfoError(value: FenceInfo | InfoError): value is InfoError {
	return "message" in value;
}

/** The set a `file` fence belongs to; fences that name none share the anonymous set. */
export function setOf(info: FenceInfo): string {
	return info.keys.set ?? "";
}

/**
 * How a set is named in a message. The anonymous set has no name to show, and
 * both the parser and the driver have to render it the same way or the same set
 * reads as two in a report.
 */
export function setLabel(name: string): string {
	return name === "" ? "(unnamed)" : name;
}

export function parseInfoString(info: string): FenceInfo | InfoError {
	const tokens = info
		.trim()
		.split(/\s+/)
		.filter((t) => t.length > 0);
	const [language, role, ...rest] = tokens;
	if (language === undefined || role === undefined) {
		return { message: `not a data fence: "${info}"` };
	}
	if (!LANGUAGES.has(language)) return { message: `unknown language "${language}"` };
	if (!ROLES.has(role)) return { message: `unknown role "${role}"` };
	const typedRole = role as Role;

	const keys: Record<string, string> = {};
	for (const token of rest) {
		const eq = token.indexOf("=");
		if (eq <= 0) return { message: `malformed key "${token}", expected key=value` };
		const key = token.slice(0, eq);
		const value = token.slice(eq + 1);
		if (!KEYS[typedRole].has(key)) return { message: `unknown key "${key}" for role ${typedRole}` };
		if (key in keys) return { message: `duplicate key "${key}"` };
		keys[key] = value;
	}

	if (typedRole === "rejected") {
		const count = ("diagnostic" in keys ? 1 : 0) + ("expect" in keys ? 1 : 0);
		if (count !== 1) return { message: "rejected needs exactly one of diagnostic or expect" };
	}
	if (typedRole === "file") {
		if (!("path" in keys)) return { message: "file needs path" };
		if ("mode" in keys && keys.mode !== "read") return { message: "mode must be read" };
	}

	return { language: language as Language, role: typedRole, keys };
}
