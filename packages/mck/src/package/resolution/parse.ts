// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { parseJsonWithDuplicateKeys } from "../../../../ir/src/codec/json/value.ts";
import type { ResolutionParseResult, Violation } from "./model.ts";
import { orderViolationsCanonical } from "./order.ts";
import { validateLockIdentities, validateLockShape, validateOuterIdentities, validateOuterShape } from "./validate.ts";
import { makeInput } from "./wire.ts";

export { resolutionInputToWire } from "./wire.ts";

function invalid(code: "invalid-input" | "invalid-lock", violations: readonly Violation[]): ResolutionParseResult {
	return { ok: false, diagnostic: { code, violations: orderViolationsCanonical(violations) } };
}

/** Validates phases 1 through 5 only. Later lock and candidate checks belong to the resolver. */
export function parseResolutionInput(text: string): ResolutionParseResult {
	if (text.startsWith("\uFEFF")) return invalid("invalid-input", [{ pointer: "", rule: "malformed-json" }]);
	const parsed = parseJsonWithDuplicateKeys(text);
	if (!parsed.ok) {
		if (parsed.error.code === "nesting_too_deep") throw new Error(parsed.error.message);
		return invalid("invalid-input", [{ pointer: "", rule: "malformed-json" }]);
	}
	if (parsed.value.duplicateKeys.length > 0)
		return invalid(
			"invalid-input",
			parsed.value.duplicateKeys.map((pointer) => ({ pointer, rule: "duplicate-key" })),
		);
	const outer = validateOuterShape(parsed.value.document);
	if (outer.violations.length > 0) return invalid("invalid-input", outer.violations);
	if (outer.root === undefined || outer.mode === undefined) throw new Error("outer validation completed without a recognized resolution mode");
	const identityViolations = validateOuterIdentities(outer.root, outer.mode);
	if (identityViolations.length > 0) return invalid("invalid-input", identityViolations);
	if (outer.mode === "initial") return { ok: true, value: makeInput(outer.root, outer.mode) };
	const lock = validateLockShape(outer.root);
	if (lock.violations.length > 0) return invalid("invalid-lock", lock.violations);
	if (lock.lock === undefined) throw new Error("lock validation completed without a lock");
	const lockIdentityViolations = validateLockIdentities(lock.lock);
	if (lockIdentityViolations.length > 0) return invalid("invalid-lock", lockIdentityViolations);
	return { ok: true, value: makeInput(outer.root, outer.mode, lock.lock) };
}
