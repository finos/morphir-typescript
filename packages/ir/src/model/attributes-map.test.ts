// packages/ir/src/model/attributes-map.test.ts
// Verifies mapAttributes visits every node and stripAttributes yields nulls.
// Run with: bun test packages/ir/src/model/attributes-map.test.ts
import { expect, test } from "bun:test";
import { mapValue, mapValueDefinition, stripAttributes } from "./attributes-map.ts";
import { FQName, Name } from "./names.ts";
import type { Type } from "./types.ts";
import type { Value, ValueDefinition } from "./values.ts";

const name = (s: string): Name => { const r = Name.parse(s); if (!r.ok) throw new Error(s); return r.value; };
const fq = (s: string): FQName => { const r = FQName.parse(s); if (!r.ok) throw new Error(s); return r.value; };

test("mapValue rewrites nested type and value attributes", () => {
	const int: Type<string> = { kind: "Reference", attributes: "t", fqname: fq("morphir/SDK:basics#int"), args: [] };
	const v: Value<string, string> = {
		kind: "IfThenElse", attributes: "v",
		condition: { kind: "Literal", attributes: "v", literal: { kind: "BoolLiteral", value: true } },
		then: { kind: "Hole", attributes: "v", reason: { kind: "UnresolvedReference", target: fq("a/b:c#d") }, expectedType: int },
		else: { kind: "Lambda", attributes: "v", pattern: { kind: "AsPattern", attributes: "v", pattern: { kind: "WildcardPattern", attributes: "v" }, name: name("x") }, body: { kind: "Variable", attributes: "v", name: name("x") } },
	};
	const mapped = mapValue(v, { onType: (a) => a.length, onValue: (a) => `${a}!` });
	expect(mapped.attributes).toBe("v!");
	if (mapped.kind === "IfThenElse" && mapped.then.kind === "Hole") expect(mapped.then.expectedType?.attributes).toBe(1);
	const stripped = stripAttributes.value(v);
	expect(stripped.attributes).toBeNull();
	if (stripped.kind === "IfThenElse" && stripped.else.kind === "Lambda") expect(stripped.else.pattern.attributes).toBeNull();
});

test("an ExternalBody's fallback body is mapped and its bindings are copied", () => {
	// Decision 0008: the bindings are plain strings, so the only thing in this
	// body an attribute rewrite can reach is the fallback.
	const int: Type<string> = { kind: "Reference", attributes: "t", fqname: fq("morphir/SDK:basics#int"), args: [] };
	const d: ValueDefinition<string, string> = {
		kind: "ExternalBody",
		inputTypes: [{ name: name("x"), type: int }],
		outputType: int,
		externals: [{ targetPlatform: "erlang", externalName: "math:abs" }, { targetPlatform: "javascript", externalName: "Math.abs" }],
		body: { kind: "Variable", attributes: "v", name: name("x") },
	};
	const mapped = mapValueDefinition(d, { onType: (a) => a.length, onValue: (a) => `${a}!` });
	expect(mapped.kind).toBe("ExternalBody");
	if (mapped.kind !== "ExternalBody") return;
	expect(mapped.body?.attributes).toBe("v!");
	expect(mapped.outputType.attributes).toBe(1);
	expect(mapped.externals).toEqual(d.externals);
	// The null branch is the one an external with no fallback takes.
	const noBody = mapValueDefinition({ ...d, body: null }, { onType: (a) => a.length, onValue: (a) => `${a}!` });
	expect(noBody.kind === "ExternalBody" && noBody.body).toBeNull();
});
