// packages/ir/src/versions/v4/read-values.ts
//
// Stub. Annotations carry values, so read-types.ts already needs this import;
// the real literal, pattern and value readers land in the next task and
// replace this file wholesale.
import { type Ctx, fail } from "../../codec/json/cursor.ts";
import type { JsonValue } from "../../codec/json/value.ts";
import type { Diagnostic } from "../../model/diagnostic.ts";
import type { Result } from "../../model/result.ts";
import type { Value } from "../../model/values.ts";
import type { TA, VA } from "./attributes.ts";

export function readValue(ctx: Ctx, _v: JsonValue): Result<Value<TA, VA>, Diagnostic> {
	return fail(ctx, "unknown_node", "values arrive in the next task");
}
