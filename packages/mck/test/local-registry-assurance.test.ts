// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import protocolSchema from "../package-restore-assurance-protocol.schema.json";
import reportSchema from "../package-restore-assurance-report.schema.json";
import { type RestoreAssuranceContext, withRestoreAssurance } from "../src/package/local-registry/assurance.ts";
import {
	parseRestoreAssuranceProvider,
	parseRestoreAssuranceReceipt,
	parseRestoreAssuranceRequest,
	parseRestoreAssuranceSelection,
} from "../src/package/local-registry/assurance-protocol.ts";

const profile = "restore-filesystem-assurance";
const profileVersion = "0.1.0-draft.1";
const selection = (mode = "portable") => ({ profile, profileVersion, mode });
const identity = { id: "test-only-host-attestation", version: "test-version" };
const qualification = (mode = "portable") => ({
	mode,
	environment: {
		runtime: { name: "test-runtime", version: "1" },
		os: { name: "test-os", version: "1" },
		architecture: "test-architecture",
		filesystem: "test-filesystem",
		assumptions: ["test-only trusted local directories"],
	},
	evidence: ["test-only:qualification-reference"],
});
const provider = (...modes: string[]) => ({ identity: { ...identity }, qualification: { kind: "qualified", entries: modes.map(qualification) } });
const request = () => ({ selection: selection(), provider: provider("portable", "hardened") });
const selected = (mode = "portable") => ({
	kind: "selected",
	context: { selection: selection(mode), provider: { ...identity }, qualification: qualification(mode) },
});
const rejected = (reason = "provider-unqualified") => ({ kind: "rejected", selection: selection(), provider: { ...identity }, reason });
const validateRequest = new Ajv2020().compile(protocolSchema);
const validateReceipt = new Ajv2020().compile(reportSchema);

test.each(["portable", "hardened"])("explicit %s invokes package callback once with exact attestation", async (mode) => {
	let accesses = 0;
	const result = await withRestoreAssurance(selection(mode), provider("portable", "hardened"), (context) => {
		accesses++;
		expect<unknown>(context).toEqual(selected(mode).context);
		return "package-result";
	});
	expect(accesses).toBe(1);
	expect<unknown>(result).toEqual({ kind: "executed", receipt: selected(mode), value: "package-result" });
});

test.each(["portable", "hardened"])("unqualified provider rejects %s before package access", async (mode) => {
	let accesses = 0;
	const result = await withRestoreAssurance(selection(mode), { identity, qualification: { kind: "unqualified" } }, () => accesses++);
	expect<unknown>(result).toEqual({ kind: "rejected", receipt: { ...rejected(), selection: selection(mode) } });
	expect(accesses).toBe(0);
});

test.each([
	["portable", "hardened"],
	["hardened", "portable"],
])("%s qualification never implicitly authorizes %s", async (available, requested) => {
	let accesses = 0;
	const result = await withRestoreAssurance(selection(requested), provider(available), () => accesses++);
	expect<unknown>(result).toEqual({ kind: "rejected", receipt: { ...rejected("mode-unavailable"), selection: selection(requested) } });
	expect(accesses).toBe(0);
});

test.each(["Linux", "macOS", "Windows"])("OS name %s cannot imply hardened support", async (os) => {
	const entry = qualification();
	entry.environment.os.name = os;
	let accesses = 0;
	const result = await withRestoreAssurance(selection("hardened"), { identity, qualification: { kind: "qualified", entries: [entry] } }, () => accesses++);
	expect(result.kind).toBe("rejected");
	expect(accesses).toBe(0);
});

function assertDeepFrozen(value: unknown): void {
	if (value !== null && typeof value === "object") {
		expect(Object.isFrozen(value)).toBe(true);
		for (const child of Object.values(value)) assertDeepFrozen(child);
	}
}

test("callback receives a deeply frozen snapshot before asynchronous input mutation", async () => {
	const input = request();
	const expected = selected();
	let captured: RestoreAssuranceContext | undefined;
	let resume: (() => void) | undefined;
	const waiting = new Promise<void>((resolve) => {
		resume = resolve;
	});
	const execution = withRestoreAssurance(input.selection, input.provider, async (context) => {
		captured = context;
		assertDeepFrozen(context);
		expect(Reflect.set(context.selection, "mode", "hardened")).toBe(false);
		expect(Reflect.set(context.qualification.environment.runtime, "version", "changed")).toBe(false);
		await waiting;
		return 17;
	});
	input.selection.mode = "hardened";
	input.provider.identity.version = "changed";
	const entry = input.provider.qualification.entries[0];
	if (!entry) throw new Error("missing fixture entry");
	entry.environment.assumptions.push("changed");
	entry.environment.runtime.version = "changed";
	entry.evidence[0] = "changed";
	input.provider.qualification.entries.splice(0);
	resume?.();
	expect<unknown>(await execution).toEqual({ kind: "executed", receipt: expected, value: 17 });
	expect<unknown>(captured).toEqual(expected.context);
});

// Exception propagation proves callback control flow only, never persistence or restart durability.
test.each(["authentication", "observed-mutation", "lock", "flush", "state-commit"])(
	"%s failure propagates unchanged without retry or downgrade",
	async (stage) => {
		const failure = { stage };
		let accesses = 0;
		let captured: RestoreAssuranceContext | undefined;
		const execution = withRestoreAssurance(selection("hardened"), provider("portable", "hardened"), async (context) => {
			accesses++;
			captured = context;
			await Promise.resolve();
			throw failure;
		});
		await expect(execution).rejects.toBe(failure);
		expect(accesses).toBe(1);
		expect<unknown>(captured).toEqual(selected("hardened").context);
		assertDeepFrozen(captured);
	},
);

test("synchronous callback failure propagates unchanged without retry", async () => {
	const failure = new Error("callback failed");
	let accesses = 0;
	await expect(
		withRestoreAssurance(selection(), provider("portable"), () => {
			accesses++;
			throw failure;
		}),
	).rejects.toBe(failure);
	expect(accesses).toBe(1);
});

test("wire receipt is data and cannot authorize a later callback", async () => {
	const receipt = parseRestoreAssuranceReceipt(selected());
	let accesses = 0;
	await expect(withRestoreAssurance(receipt, provider("portable"), () => accesses++)).rejects.toThrow();
	const result = await withRestoreAssurance(selected().context.selection, { identity, qualification: { kind: "unqualified" } }, () => accesses++);
	expect(result.kind).toBe("rejected");
	expect(accesses).toBe(0);
});

test.each([request(), { selection: selection(), provider: { identity, qualification: { kind: "unqualified" } } }])(
	"request parser and schema roundtrip %j",
	(value) => {
		expect(validateRequest(value)).toBe(true);
		const parsed = parseRestoreAssuranceRequest(value);
		expect<unknown>(parsed).toEqual(value);
		expect<unknown>(parseRestoreAssuranceRequest(JSON.parse(JSON.stringify(parsed)))).toEqual(value);
		assertDeepFrozen(parsed);
	},
);

test.each([selected(), selected("hardened"), rejected(), rejected("mode-unavailable")])("receipt parser and schema roundtrip %j", (value) => {
	expect(validateReceipt(value)).toBe(true);
	const parsed = parseRestoreAssuranceReceipt(value);
	expect<unknown>(parsed).toEqual(value);
	expect<unknown>(parseRestoreAssuranceReceipt(JSON.parse(JSON.stringify(parsed)))).toEqual(value);
	assertDeepFrozen(parsed);
});

type Path = readonly (string | number)[];
function replaceAt(value: unknown, path: Path, replacement: unknown, remove = false): unknown {
	if (path.length === 0) return replacement;
	const copy = structuredClone(value);
	let current = copy as Record<string | number, unknown>;
	for (const key of path.slice(0, -1)) current = current[key] as Record<string | number, unknown>;
	const key = path.at(-1);
	if (key === undefined) throw new Error("missing mutation key");
	if (remove) delete current[key];
	else current[key] = replacement;
	return copy;
}

/** Every object is closed, every property required, every string nonempty. */
function malformedVariants(value: unknown, path: Path = []): { name: string; value: unknown }[] {
	const result: { name: string; value: unknown }[] = [];
	function visit(child: unknown, at: Path): void {
		if (Array.isArray(child)) {
			result.push({ name: `${at.join("/")} wrong array type`, value: replaceAt(value, at, {}) });
			child.forEach((element, index) => {
				visit(element, [...at, index]);
			});
		} else if (child !== null && typeof child === "object") {
			result.push({ name: `${at.join("/")} extra field`, value: replaceAt(value, at, { ...child, extra: true }) });
			result.push({ name: `${at.join("/")} null object`, value: replaceAt(value, at, null) });
			for (const [key, member] of Object.entries(child)) {
				result.push({ name: `${[...at, key].join("/")} missing`, value: replaceAt(value, [...at, key], undefined, true) });
				visit(member, [...at, key]);
			}
		} else if (typeof child === "string") {
			for (const replacement of ["", null, 1, true, [], {}])
				result.push({ name: `${at.join("/")} invalid string ${JSON.stringify(replacement)}`, value: replaceAt(value, at, replacement) });
		}
	}
	visit(value, path);
	return result;
}

const sparseStrings = ["test-only"];
sparseStrings.length = 2;
const invalidRequests = [
	...malformedVariants(request()),
	...malformedVariants({ selection: selection(), provider: { identity, qualification: { kind: "unqualified" } } }),
	...["profile", "profileVersion", "mode"].map((key) => ({ name: `unknown ${key}`, value: replaceAt(request(), ["selection", key], "future") })),
	{ name: "unknown qualification", value: replaceAt(request(), ["provider", "qualification", "kind"], "future") },
	{ name: "unknown qualified mode", value: replaceAt(request(), ["provider", "qualification", "entries", 0, "mode"], "future") },
	{ name: "empty entries", value: replaceAt(request(), ["provider", "qualification", "entries"], []) },
	{
		name: "duplicate modes with different evidence",
		value: {
			selection: selection(),
			provider: { identity, qualification: { kind: "qualified", entries: [qualification(), { ...qualification(), evidence: ["different"] }] } },
		},
	},
	{ name: "empty evidence", value: replaceAt(request(), ["provider", "qualification", "entries", 0, "evidence"], []) },
	{ name: "empty assumptions", value: replaceAt(request(), ["provider", "qualification", "entries", 0, "environment", "assumptions"], []) },
	{ name: "sparse evidence", value: replaceAt(request(), ["provider", "qualification", "entries", 0, "evidence"], sparseStrings) },
	{ name: "sparse assumptions", value: replaceAt(request(), ["provider", "qualification", "entries", 0, "environment", "assumptions"], sparseStrings) },
	{
		name: "unqualified entries",
		value: { selection: selection(), provider: { identity, qualification: { kind: "unqualified", entries: [qualification()] } } },
	},
];
test.each(invalidRequests)("request parser/schema reject $name before callback", async ({ value }) => {
	expect(validateRequest(value)).toBe(false);
	expect(() => parseRestoreAssuranceRequest(value)).toThrow();
	const input = value as { selection?: unknown; provider?: unknown } | null;
	let accesses = 0;
	// Envelope-only faults are handled by the request parser, not the two-input guard.
	if (input !== null && typeof input === "object" && Object.keys(input).every((key) => key === "selection" || key === "provider")) {
		await expect(withRestoreAssurance(input.selection, input.provider, () => accesses++)).rejects.toThrow();
		expect(accesses).toBe(0);
	}
});

const invalidReceipts = [
	...malformedVariants(selected()),
	...malformedVariants(rejected()),
	{ name: "mismatched mode", value: replaceAt(selected(), ["context", "qualification", "mode"], "hardened") },
	{ name: "unknown kind", value: { ...selected(), kind: "graph-ready" } },
	{ name: "unknown rejection", value: rejected("authentication-failed") },
	{ name: "empty evidence", value: replaceAt(selected(), ["context", "qualification", "evidence"], []) },
	{ name: "empty assumptions", value: replaceAt(selected(), ["context", "qualification", "environment", "assumptions"], []) },
	{ name: "sparse evidence", value: replaceAt(selected(), ["context", "qualification", "evidence"], sparseStrings) },
	{ name: "sparse assumptions", value: replaceAt(selected(), ["context", "qualification", "environment", "assumptions"], sparseStrings) },
];
test.each(invalidReceipts)("receipt parser/schema reject $name", ({ value }) => {
	expect(validateReceipt(value)).toBe(false);
	expect(() => parseRestoreAssuranceReceipt(value)).toThrow();
});

test("standalone parsers clone data without inferring qualification or verifying evidence", () => {
	const input = provider("portable");
	const parsed = parseRestoreAssuranceProvider(input);
	expect<unknown>(parsed).toEqual(input);
	expect(parsed).not.toBe(input);
	assertDeepFrozen(parsed);
	expect<unknown>(parseRestoreAssuranceSelection(selection())).toEqual(selection());
});
