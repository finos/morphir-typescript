// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { object, string } from "../json.ts";
import { type Corpus, decode, fixturePath } from "./corpus.ts";
import { validateResult } from "./result-semantics.ts";
import { validateScenario } from "./scenario-semantics.ts";
import { calendar, equal, records, tree, unique } from "./validation.ts";

function pointer(value: unknown, path: string): unknown {
	if (path === "") return value;
	let current = value;
	for (const token of path.slice(1).split("/")) {
		const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
		if (current === null || typeof current !== "object" || !Object.hasOwn(current, key) || (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/.test(key)))
			throw new Error(`missing assertion pointer ${path}`);
		current = Reflect.get(current, key);
	}
	return current;
}
function assertions(value: unknown, complete?: unknown): void {
	const entries = records(value);
	unique(
		entries.map((entry) => entry.pointer),
		"assertion pointer",
	);
	for (const left of entries) {
		const at = string(left.pointer);
		for (const right of entries) {
			const below = string(right.pointer);
			if (below !== at && below.startsWith(`${at}/`)) equal(pointer(left.equals, below.slice(at.length)), right.equals, "contradictory assertions");
		}
		if (complete !== undefined) equal(pointer(complete, at), left.equals, `assertion ${at}`);
	}
}
export function validateDefinitions(loaded: Corpus) {
	const assets = records(loaded.index.assets);
	unique(
		assets.map((asset) => asset.id),
		"asset ID",
	);
	unique(
		loaded.cases.map((entry) => entry.id),
		"case ID",
	);
	const byId = new Map(assets.map((asset) => [string(asset.id), asset]));
	const documents = new Map<string, unknown>();
	const bytesById = new Map<string, Uint8Array>();
	const visiting = new Set<string>();
	const paths = new Set(loaded.paths);
	for (const asset of assets.filter((asset) => asset.kind === "bound")) {
		const name = fixturePath(asset.path);
		if (paths.has(name)) throw new Error(`duplicate logical asset path ${name}`);
		paths.add(name);
	}
	const reference = (id: unknown, type: string): unknown => {
		const name = string(id);
		const asset = byId.get(name);
		if (!asset) throw new Error(`unknown asset reference ${name}`);
		if (asset.type !== type) throw new Error(`wrong asset type ${name}: expected ${type}`);
		if (asset.kind === "pending") return undefined;
		if (visiting.has(name)) throw new Error(`cyclic asset reference ${name}`);
		if (documents.has(name) || bytesById.has(name)) return documents.get(name);
		visiting.add(name);
		const bytes = loaded.read(fixturePath(asset.path));
		if (String(bytes.byteLength) !== asset.length) throw new Error(`asset length mismatch ${name}`);
		if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== asset.sha256) throw new Error(`asset digest mismatch ${name}`);
		if (type !== "bytes") {
			const value = decode(bytes);
			loaded.validate(type[0]?.toUpperCase() + type.slice(1), value);
			calendar(value);
			if (type === "tree") tree(value);
			if (type === "result") validateResult(value);
			if (type === "configuration") {
				const configuration = object(value);
				const bindings = records(configuration.bindings);
				const roots = records(configuration.bootstrapRoots);
				unique(
					bindings.map((binding) => binding.alias),
					"configuration alias",
				);
				unique(
					roots.map((root) => [root.identity, root.version]),
					"bootstrap identity/version",
				);
				for (const binding of bindings)
					if (!roots.some((root) => root.identity === binding.identity)) throw new Error("configuration identity has no bootstrap bytes");
			}
			walk(value);
			documents.set(name, value);
		}
		bytesById.set(name, bytes);
		visiting.delete(name);
		return documents.get(name);
	};
	const walk = (value: unknown, key = ""): void => {
		if (value === null || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const child of value) walk(child, key);
			return;
		}
		const entry = object(value);
		if (Object.hasOwn(entry, "asset")) {
			const type =
				key === "expectedObservations"
					? "observations"
					: key === "expected"
						? "result"
						: key === "configuration"
							? "configuration"
							: ["tree", "cache", "bundle", "proposal"].includes(key)
								? "tree"
								: "bytes";
			const complete = reference(entry.asset, type);
			if (entry.assertions !== undefined) assertions(entry.assertions, complete);
		}
		for (const [name, child] of Object.entries(entry)) if (name !== "assertions") walk(child, name);
	};
	for (const asset of assets) reference(asset.id, string(asset.type));
	for (const entry of loaded.cases) {
		calendar(entry);
		walk(entry);
		const operations = entry.kind === "parse" ? [entry] : records(entry.operations);
		for (const operation of operations) {
			const expected = object(operation.expected);
			const complete = expected.kind === "inline" ? expected.result : expected.kind === "asset" ? documents.get(string(expected.asset)) : undefined;
			if (complete !== undefined) {
				loaded.validate("Result", complete);
				validateResult(complete, entry.kind === "parse" ? undefined : operation, entry.kind === "parse");
			}
		}
		if (entry.kind === "scenario") validateScenario(entry, documents, bytesById);
	}
	return { assets: byId, documents, bytesById };
}
