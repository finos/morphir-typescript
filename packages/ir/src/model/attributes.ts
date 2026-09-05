// packages/ir/src/model/attributes.ts
//
// The opaque payload attributes carry, and nothing else. The model is generic
// over its attributes (Type<A>, Value<TA, VA>) and stays that way: the records
// a wire format pins them to live in that version's module, not here.
//
// Json is the JSON codec's own value tree, kept opaque. The profile reads these
// payloads and never interprets them, so they cross the model exactly as they
// were parsed and are written back byte for byte: a number is the lexeme it was
// spelled with rather than a double, and an object is a tagged, ordered map
// rather than a plain record. The tag is what makes the tree unambiguous — a
// payload spelled {"kind": "number", "text": "hello"} parses into a JsonObject
// whose members map holds those two strings, so no payload can imitate a
// number, and the writer can never splice a non-numeric text into the output.

export interface JsonNumber { readonly kind: "number"; readonly text: string }
export interface JsonObject { readonly kind: "object"; readonly members: ReadonlyMap<string, Json> }
export type Json = null | boolean | string | JsonNumber | readonly Json[] | JsonObject;

export function isJsonNumber(j: Json): j is JsonNumber {
	return typeof j === "object" && j !== null && !Array.isArray(j) && (j as JsonNumber).kind === "number";
}
export function isJsonObject(j: Json): j is JsonObject {
	return typeof j === "object" && j !== null && !Array.isArray(j) && (j as JsonObject).kind === "object";
}
