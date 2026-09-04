// packages/ir/src/model/attributes.ts
//
// The opaque payload attributes carry, and nothing else. The model is generic
// over its attributes (Type<A>, Value<TA, VA>) and stays that way: the records
// a wire format pins them to live in that version's module, not here.

// The one number shape the package has: a lexeme, not a double. The JSON
// codec's JsonNumber is this type, so a payload number that crosses into the
// model keeps the spelling its source used and can be written back byte for
// byte. `text` is the RFC 8259 number token exactly as it was read.
export interface JsonNumber { readonly kind: "number"; readonly text: string }

// The opaque payload carried by v1-to-v3 attributes and by the v4 constraints
// and extensions maps: read but never interpreted, so numbers stay lexemes.
export type Json = null | boolean | JsonNumber | string | readonly Json[] | { readonly [key: string]: Json };

// A Json object member set is unconstrained, so a payload spelled exactly
// {"kind": "number", "text": "..."} is indistinguishable from a lexeme; it is
// read back as the number it imitates.
export function isJsonNumber(j: Json): j is JsonNumber {
	if (j === null || typeof j !== "object" || Array.isArray(j)) return false;
	const keys = Object.keys(j);
	return keys.length === 2 && keys.includes("kind") && keys.includes("text")
		&& (j as { readonly [key: string]: Json })["kind"] === "number"
		&& typeof (j as { readonly [key: string]: Json })["text"] === "string";
}

