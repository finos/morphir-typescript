// packages/ir/src/model/attributes-map.ts
//
// mapAttributes rewrites every attribute in a tree; stripAttributes is the
// instantiation the kit compares on (all attributes become null).
import type { Distribution, IRFile, PackageDefinition, PackageSpecification } from "./distribution.ts";
import type { AccessControlled, Documented, ModuleDefinition, ModuleSpecification } from "./modules.ts";
import type { Name } from "./names.ts";
import type { Annotation, Constructor, Incompleteness, Type, TypeDefinition, TypeSpecification } from "./types.ts";
import type { Pattern, Value, ValueDefinition, ValueSpecification } from "./values.ts";

export interface AttributeMapper<TA, VA, TB, VB> {
	readonly onType: (a: TA) => TB;
	readonly onValue: (a: VA) => VB;
}

// The named entry point the spec gives this operation: rewrite every attribute
// in a whole file. The per-node helpers below are the same walk stopped at a
// smaller root.
export function mapAttributes<TA, VA, TB, VB>(f: IRFile<TA, VA>, onType: (a: TA) => TB, onValue: (a: VA) => VB): IRFile<TB, VB> {
	return mapIRFile(f, { onType, onValue });
}

export function mapType<TA, TB>(t: Type<TA>, f: (a: TA) => TB): Type<TB> {
	switch (t.kind) {
		case "Variable": return { kind: "Variable", attributes: f(t.attributes), name: t.name };
		case "Reference": return { kind: "Reference", attributes: f(t.attributes), fqname: t.fqname, args: t.args.map((a) => mapType(a, f)) };
		case "Tuple": return { kind: "Tuple", attributes: f(t.attributes), elements: t.elements.map((e) => mapType(e, f)) };
		case "Record": return { kind: "Record", attributes: f(t.attributes), fields: t.fields.map((x) => ({ name: x.name, type: mapType(x.type, f) })) };
		case "ExtensibleRecord": return { kind: "ExtensibleRecord", attributes: f(t.attributes), variable: t.variable, fields: t.fields.map((x) => ({ name: x.name, type: mapType(x.type, f) })) };
		case "Function": return { kind: "Function", attributes: f(t.attributes), argumentType: mapType(t.argumentType, f), returnType: mapType(t.returnType, f) };
		case "Unit": return { kind: "Unit", attributes: f(t.attributes) };
		default: { const _: never = t; return _; }
	}
}

function mapConstructors<TA, TB>(cs: readonly Constructor<TA>[], f: (a: TA) => TB): readonly Constructor<TB>[] {
	return cs.map((c) => ({ name: c.name, args: c.args.map((a) => ({ name: a.name, type: mapType(a.type, f) })) }));
}

function mapIncompleteness<TA, TB>(i: Incompleteness<TA>, f: (a: TA) => TB): Incompleteness<TB> {
	return i.kind === "Draft" ? i : { kind: "Hole", reason: i.reason, partialBody: i.partialBody === null ? null : mapType(i.partialBody, f) };
}

export function mapPattern<VA, VB>(p: Pattern<VA>, f: (a: VA) => VB): Pattern<VB> {
	switch (p.kind) {
		case "WildcardPattern": return { kind: p.kind, attributes: f(p.attributes) };
		case "AsPattern": return { kind: p.kind, attributes: f(p.attributes), pattern: mapPattern(p.pattern, f), name: p.name };
		case "TuplePattern": return { kind: p.kind, attributes: f(p.attributes), patterns: p.patterns.map((x) => mapPattern(x, f)) };
		case "ConstructorPattern": return { kind: p.kind, attributes: f(p.attributes), fqname: p.fqname, patterns: p.patterns.map((x) => mapPattern(x, f)) };
		case "EmptyListPattern": return { kind: p.kind, attributes: f(p.attributes) };
		case "HeadTailPattern": return { kind: p.kind, attributes: f(p.attributes), head: mapPattern(p.head, f), tail: mapPattern(p.tail, f) };
		case "LiteralPattern": return { kind: p.kind, attributes: f(p.attributes), literal: p.literal };
		case "UnitPattern": return { kind: p.kind, attributes: f(p.attributes) };
		default: { const _: never = p; return _; }
	}
}

export function mapValue<TA, VA, TB, VB>(v: Value<TA, VA>, m: AttributeMapper<TA, VA, TB, VB>): Value<TB, VB> {
	const va = m.onValue(v.attributes);
	const val = (x: Value<TA, VA>): Value<TB, VB> => mapValue(x, m);
	const def = (d: ValueDefinition<TA, VA>): ValueDefinition<TB, VB> => mapValueDefinition(d, m);
	switch (v.kind) {
		case "Literal": return { kind: v.kind, attributes: va, literal: v.literal };
		case "Constructor": return { kind: v.kind, attributes: va, fqname: v.fqname };
		case "Tuple": return { kind: v.kind, attributes: va, elements: v.elements.map(val) };
		case "List": return { kind: v.kind, attributes: va, items: v.items.map(val) };
		case "Record": return { kind: v.kind, attributes: va, fields: v.fields.map((x) => ({ name: x.name, value: val(x.value) })) };
		case "Variable": return { kind: v.kind, attributes: va, name: v.name };
		case "Reference": return { kind: v.kind, attributes: va, fqname: v.fqname };
		case "Field": return { kind: v.kind, attributes: va, target: val(v.target), name: v.name };
		case "FieldFunction": return { kind: v.kind, attributes: va, name: v.name };
		case "Apply": return { kind: v.kind, attributes: va, function: val(v.function), argument: val(v.argument) };
		case "Lambda": return { kind: v.kind, attributes: va, pattern: mapPattern(v.pattern, m.onValue), body: val(v.body) };
		case "LetDefinition": return { kind: v.kind, attributes: va, name: v.name, definition: def(v.definition), in: val(v.in) };
		case "LetRecursion": return { kind: v.kind, attributes: va, definitions: v.definitions.map((b) => ({ name: b.name, definition: def(b.definition) })), in: val(v.in) };
		case "Destructure": return { kind: v.kind, attributes: va, pattern: mapPattern(v.pattern, m.onValue), value: val(v.value), in: val(v.in) };
		case "IfThenElse": return { kind: v.kind, attributes: va, condition: val(v.condition), then: val(v.then), else: val(v.else) };
		case "PatternMatch": return { kind: v.kind, attributes: va, value: val(v.value), cases: v.cases.map((c) => ({ pattern: mapPattern(c.pattern, m.onValue), body: val(c.body) })) };
		case "UpdateRecord": return { kind: v.kind, attributes: va, target: val(v.target), fields: v.fields.map((x) => ({ name: x.name, value: val(x.value) })) };
		case "Unit": return { kind: v.kind, attributes: va };
		case "Hole": return { kind: v.kind, attributes: va, reason: v.reason, expectedType: v.expectedType === null ? null : mapType(v.expectedType, m.onType) };
		case "Native": return { kind: v.kind, attributes: va, fqname: v.fqname, nativeInfo: v.nativeInfo };
		case "External": return { kind: v.kind, attributes: va, externalName: v.externalName, targetPlatform: v.targetPlatform };
		default: { const _: never = v; return _; }
	}
}

function mapInputs<TA, TB>(inputs: readonly { readonly name: Name; readonly type: Type<TA> }[], f: (a: TA) => TB) {
	return inputs.map((i) => ({ name: i.name, type: mapType(i.type, f) }));
}

export function mapValueDefinition<TA, VA, TB, VB>(d: ValueDefinition<TA, VA>, m: AttributeMapper<TA, VA, TB, VB>): ValueDefinition<TB, VB> {
	const t = m.onType;
	switch (d.kind) {
		case "ExpressionBody": return { kind: d.kind, inputTypes: mapInputs(d.inputTypes, t), outputType: mapType(d.outputType, t), body: mapValue(d.body, m) };
		case "NativeBody": return { kind: d.kind, inputTypes: mapInputs(d.inputTypes, t), outputType: mapType(d.outputType, t), nativeInfo: d.nativeInfo };
		case "ExternalBody": return { kind: d.kind, inputTypes: mapInputs(d.inputTypes, t), outputType: mapType(d.outputType, t), externalName: d.externalName, targetPlatform: d.targetPlatform };
		case "IncompleteBody": return { kind: d.kind, inputTypes: mapInputs(d.inputTypes, t), outputType: d.outputType === null ? null : mapType(d.outputType, t), incompleteness: mapIncompleteness(d.incompleteness, t), partialBody: d.partialBody === null ? null : mapValue(d.partialBody, m) };
		default: { const _: never = d; return _; }
	}
}

function mapAnnotations<TA, VA, TB, VB>(as: readonly Annotation<TA, VA>[], m: AttributeMapper<TA, VA, TB, VB>): readonly Annotation<TB, VB>[] {
	return as.map((a) => a.kind === "Compact" ? a : {
		kind: "Structured", name: a.name,
		args: a.args.map((x) => x.kind === "Positional" ? { kind: "Positional", value: mapValue(x.value, m) } : { kind: "Named", name: x.name, value: mapValue(x.value, m) }),
	});
}

export function mapTypeSpecification<TA, VA, TB, VB>(s: TypeSpecification<TA, VA>, m: AttributeMapper<TA, VA, TB, VB>): TypeSpecification<TB, VB> {
	const t = m.onType;
	const annotations = mapAnnotations(s.annotations, m);
	switch (s.kind) {
		case "TypeAliasSpecification": return { kind: s.kind, annotations, typeParams: s.typeParams, typeExp: mapType(s.typeExp, t) };
		case "OpaqueTypeSpecification": return { kind: s.kind, annotations, typeParams: s.typeParams };
		case "CustomTypeSpecification": return { kind: s.kind, annotations, typeParams: s.typeParams, constructors: mapConstructors(s.constructors, t) };
		case "DerivedTypeSpecification": return { kind: s.kind, annotations, typeParams: s.typeParams, baseType: mapType(s.baseType, t), fromBaseType: s.fromBaseType, toBaseType: s.toBaseType };
		default: { const _: never = s; return _; }
	}
}

export function mapTypeDefinition<TA, TB>(d: TypeDefinition<TA>, f: (a: TA) => TB): TypeDefinition<TB> {
	switch (d.kind) {
		case "TypeAliasDefinition": return { kind: d.kind, typeParams: d.typeParams, typeExp: mapType(d.typeExp, f) };
		case "CustomTypeDefinition": return { kind: d.kind, typeParams: d.typeParams, constructorsAccess: d.constructorsAccess, constructors: mapConstructors(d.constructors, f) };
		case "IncompleteTypeDefinition": return { kind: d.kind, typeParams: d.typeParams, incompleteness: mapIncompleteness(d.incompleteness, f), partialTypeExp: d.partialTypeExp === null ? null : mapType(d.partialTypeExp, f) };
		default: { const _: never = d; return _; }
	}
}

export function mapValueSpecification<TA, VA, TB, VB>(s: ValueSpecification<TA, VA>, m: AttributeMapper<TA, VA, TB, VB>): ValueSpecification<TB, VB> {
	return { annotations: mapAnnotations(s.annotations, m), inputs: mapInputs(s.inputs, m.onType), output: mapType(s.output, m.onType) };
}

const documented = <T, U>(d: Documented<T>, f: (t: T) => U): Documented<U> => ({ doc: d.doc, value: f(d.value) });
const controlled = <T, U>(a: AccessControlled<T>, f: (t: T) => U): AccessControlled<U> => ({ access: a.access, value: f(a.value) });

export function mapModuleSpecification<TA, VA, TB, VB>(s: ModuleSpecification<TA, VA>, m: AttributeMapper<TA, VA, TB, VB>): ModuleSpecification<TB, VB> {
	return {
		annotations: mapAnnotations(s.annotations, m), doc: s.doc,
		types: s.types.map((x) => ({ name: x.name, value: documented(x.value, (v) => mapTypeSpecification(v, m)) })),
		values: s.values.map((x) => ({ name: x.name, value: documented(x.value, (v) => mapValueSpecification(v, m)) })),
	};
}

export function mapModuleDefinition<TA, VA, TB, VB>(d: ModuleDefinition<TA, VA>, m: AttributeMapper<TA, VA, TB, VB>): ModuleDefinition<TB, VB> {
	return {
		doc: d.doc,
		types: d.types.map((x) => ({ name: x.name, value: controlled(x.value, (c) => documented(c, (v) => mapTypeDefinition(v, m.onType))) })),
		values: d.values.map((x) => ({ name: x.name, value: controlled(x.value, (c) => documented(c, (v) => mapValueDefinition(v, m))) })),
	};
}

export function mapPackageSpecification<TA, VA, TB, VB>(p: PackageSpecification<TA, VA>, m: AttributeMapper<TA, VA, TB, VB>): PackageSpecification<TB, VB> {
	return { modules: p.modules.map((x) => ({ name: x.name, value: mapModuleSpecification(x.value, m) })) };
}
export function mapPackageDefinition<TA, VA, TB, VB>(p: PackageDefinition<TA, VA>, m: AttributeMapper<TA, VA, TB, VB>): PackageDefinition<TB, VB> {
	return { modules: p.modules.map((x) => ({ name: x.name, value: controlled(x.value, (v) => mapModuleDefinition(v, m)) })) };
}

export function mapDistribution<TA, VA, TB, VB>(d: Distribution<TA, VA>, m: AttributeMapper<TA, VA, TB, VB>): Distribution<TB, VB> {
	switch (d.kind) {
		case "Library": return { kind: d.kind, packageName: d.packageName, dependencies: d.dependencies.map((x) => ({ name: x.name, value: mapPackageSpecification(x.value, m) })), def: mapPackageDefinition(d.def, m) };
		case "Specs": return { kind: d.kind, packageName: d.packageName, dependencies: d.dependencies.map((x) => ({ name: x.name, value: mapPackageSpecification(x.value, m) })), spec: mapPackageSpecification(d.spec, m) };
		case "Application": return { kind: d.kind, packageName: d.packageName, dependencies: d.dependencies.map((x) => ({ name: x.name, value: mapPackageDefinition(x.value, m) })), def: mapPackageDefinition(d.def, m), entryPoints: d.entryPoints };
		default: { const _: never = d; return _; }
	}
}

export function mapIRFile<TA, VA, TB, VB>(f: IRFile<TA, VA>, m: AttributeMapper<TA, VA, TB, VB>): IRFile<TB, VB> {
	return { formatVersion: f.formatVersion, distribution: mapDistribution(f.distribution, m) };
}

const toNull: AttributeMapper<unknown, unknown, null, null> = { onType: () => null, onValue: () => null };
export const stripAttributes = {
	type: <TA>(t: Type<TA>): Type<null> => mapType(t, () => null),
	pattern: <VA>(p: Pattern<VA>): Pattern<null> => mapPattern(p, () => null),
	value: <TA, VA>(v: Value<TA, VA>): Value<null, null> => mapValue(v, toNull),
	valueDefinition: <TA, VA>(d: ValueDefinition<TA, VA>): ValueDefinition<null, null> => mapValueDefinition(d, toNull),
	typeSpecification: <TA, VA>(s: TypeSpecification<TA, VA>): TypeSpecification<null, null> => mapTypeSpecification(s, toNull),
	typeDefinition: <TA>(d: TypeDefinition<TA>): TypeDefinition<null> => mapTypeDefinition(d, () => null),
	valueSpecification: <TA, VA>(s: ValueSpecification<TA, VA>): ValueSpecification<null, null> => mapValueSpecification(s, toNull),
	distribution: <TA, VA>(d: Distribution<TA, VA>): Distribution<null, null> => mapDistribution(d, toNull),
	irFile: <TA, VA>(f: IRFile<TA, VA>): IRFile<null, null> => mapIRFile(f, toNull),
};
