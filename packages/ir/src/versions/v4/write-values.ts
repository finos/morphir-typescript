// packages/ir/src/versions/v4/write-values.ts
//
// Stub, the mirror of the read-values.ts stub. Structured annotation arguments
// are values, so write-types.ts already needs this import; the real value
// writer lands in the next task and replaces this file wholesale. Nothing can
// reach it yet, because the only route to a Value is readValue, which fails.
import { type JsonValue, jsonObject } from "../../codec/json/value.ts";
import type { Value } from "../../model/values.ts";
import type { TA, VA } from "./attributes.ts";

export function writeValue(_v: Value<TA, VA>): JsonValue {
	return jsonObject([]);
}
