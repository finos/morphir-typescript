// packages/ir/src/versions/v4/expanded.ts
//
// The one rule every expanded wrapper payload follows, shared by the type and
// value readers: check the member set, then read the optional attributes out
// of it.
//
// Decision 0005 gave every wrapper an expanded spelling whose payload carries
// an "attributes" member beside the rest. "attrs" is the Rust encoder's
// spelling of that member, accepted with a legacy_spelling warning for the
// one-release window of decision 0006 and never written; a payload carrying
// both spells one slot twice and is refused at the key the author can delete.
//
// The two readers differ only in which attribute reader they hand over, so
// that is the parameter — which is also why this lives beside them rather
// than in the codec layer, where the v4 wire names do not belong.
import { type Ctx, at, expectObject, fail, members, warn } from "../../codec/json/cursor.ts";
import type { JsonValue } from "../../codec/json/value.ts";
import type { Diagnostic } from "../../model/diagnostic.ts";
import { type Result, ok } from "../../model/result.ts";

export interface ExpandedPayload<A> {
	readonly m: ReadonlyMap<string, JsonValue>;
	readonly a: A;
}

export function expandedPayload<A>(
	ctx: Ctx,
	v: JsonValue,
	required: readonly string[],
	optional: readonly string[],
	readAttributes: (ctx: Ctx, v: JsonValue | undefined) => Result<A, Diagnostic>,
): Result<ExpandedPayload<A>, Diagnostic> {
	const o = expectObject(ctx, v);
	if (!o.ok) return o;
	const m = members(ctx, o.value, required, ["attributes", "attrs", ...optional]);
	if (!m.ok) return m;
	const canonical = m.value.get("attributes");
	const legacy = m.value.get("attrs");
	if (canonical !== undefined && legacy !== undefined) {
		return fail(at(ctx, "attrs"), "unknown_member", '"attrs" duplicates "attributes"', o.value);
	}
	if (legacy !== undefined) warn(at(ctx, "attrs"), '"attrs" is the legacy spelling of "attributes"', o.value);
	// A payload with neither spelling still reads its (absent) attributes, and
	// the cursor for that read names the canonical member.
	const a = readAttributes(at(ctx, legacy !== undefined ? "attrs" : "attributes"), canonical ?? legacy);
	return a.ok ? ok({ m: m.value, a: a.value }) : a;
}
