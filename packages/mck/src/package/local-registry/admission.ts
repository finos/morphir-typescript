// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { contentHash } from "../../kit/hash.ts";
import { array, object, string } from "../json.ts";
import { type CorpusSource, corpus, fileMapSource, repositorySource } from "./corpus.ts";
import { validateDefinitions } from "./semantics.ts";

export type Admission<T> = { readonly kind: "admitted"; readonly value: T } | { readonly kind: "kit-error"; readonly errors: readonly string[] };
class ExecutableCase {
	readonly kind = "admitted-local-registry-case";
	readonly id: string;
	readonly #definition: Record<string, unknown>;
	readonly #assets: ReadonlyMap<string, Uint8Array>;
	readonly #expectations: ReadonlyMap<string, unknown>;
	readonly #observations: unknown;
	private constructor(
		definition: Record<string, unknown>,
		assets: ReadonlyMap<string, Uint8Array>,
		expectations: ReadonlyMap<string, unknown>,
		observations: unknown,
	) {
		this.id = string(definition.id);
		this.#definition = structuredClone(definition);
		this.#assets = new Map([...assets].map(([id, bytes]) => [id, new Uint8Array(bytes)]));
		this.#expectations = structuredClone(expectations);
		this.#observations = structuredClone(observations);
		Object.freeze(this);
	}
	/** Defensive copies preserve admission invariants when handed to a future controller. */
	definition(): Readonly<Record<string, unknown>> {
		return structuredClone(this.#definition);
	}
	assetBytes(id: string): Uint8Array {
		const bytes = this.#assets.get(id);
		if (!bytes) throw new Error(`asset outside admitted closure ${id}`);
		return new Uint8Array(bytes);
	}
	expectations(): ReadonlyMap<string, unknown> {
		return structuredClone(this.#expectations);
	}
	/** Final scenario snapshot is separate from the unrestricted operation-ID namespace. */
	observations(): unknown {
		return structuredClone(this.#observations);
	}
	static construct(definition: Record<string, unknown>, validated: ReturnType<typeof validateDefinitions>): ExecutableCase {
		const assets = new Map<string, Uint8Array>();
		const visit = (value: unknown): void => {
			if (value === null || typeof value !== "object") return;
			if (Array.isArray(value)) {
				value.forEach(visit);
				return;
			}
			const entry = object(value);
			if (entry.asset !== undefined) {
				const id = string(entry.asset);
				if (!assets.has(id)) {
					const bytes = validated.bytesById.get(id);
					if (!bytes) throw new Error(`pending asset ${id}`);
					assets.set(id, bytes);
					visit(validated.documents.get(id));
				}
			}
			for (const [key, child] of Object.entries(entry)) if (key !== "assertions") visit(child);
		};
		visit(definition);
		const expectations = new Map<string, unknown>();
		for (const operation of definition.kind === "parse" ? [definition] : array(definition.operations).map(object)) {
			const expected = object(operation.expected);
			expectations.set(
				string(operation.id),
				expected.kind === "terminated"
					? { kind: "terminated", checkpoint: expected.checkpoint }
					: expected.kind === "inline"
						? expected.result
						: validated.documents.get(string(expected.asset)),
			);
		}
		const observations = definition.kind === "scenario" ? validated.documents.get(string(object(definition.expectedObservations).asset)) : undefined;
		return new ExecutableCase(definition, assets, expectations, observations);
	}
}
export type LocalRegistryCase = ExecutableCase;
class ExecutableKit {
	readonly kind = "executable-local-registry-kit";
	private constructor(
		readonly contentHash: string,
		readonly cases: readonly ExecutableCase[],
	) {
		Object.freeze(cases);
		Object.freeze(this);
	}
	static admit(source: CorpusSource): ExecutableKit {
		const loaded = corpus(source);
		const validated = validateDefinitions(loaded);
		for (const asset of array(loaded.index.assets).map(object)) if (asset.kind === "pending") throw new Error(`pending asset ${String(asset.id)}`);
		return new ExecutableKit(
			contentHash(loaded.consumed),
			loaded.cases.map((entry) => ExecutableCase.construct(entry, validated)),
		);
	}
}
export type LocalRegistryKit = ExecutableKit;
export function admitLocalRegistry(source: CorpusSource): Admission<LocalRegistryKit> {
	try {
		return { kind: "admitted", value: ExecutableKit.admit(source) };
	} catch (error) {
		return { kind: "kit-error", errors: [String(error)] };
	}
}
export const admitLocalRegistryFromFiles = (files: ReadonlyMap<string, Uint8Array>) => admitLocalRegistry(fileMapSource(files));
export const admitLocalRegistryRepository = (root: string) => admitLocalRegistry((name) => repositorySource(root)(name));

/** Internal admission probe. No kit hash, report, subset compatibility claim or root export. */
export function admitExactCaseForTesting(source: CorpusSource, id: string): Admission<LocalRegistryCase> {
	try {
		const loaded = corpus(source);
		const validated = validateDefinitions(loaded);
		const entry = loaded.cases.find((entry) => entry.id === id);
		if (!entry) throw new Error(`unknown case ${id}`);
		return { kind: "admitted", value: ExecutableCase.construct(entry, validated) };
	} catch (error) {
		return { kind: "kit-error", errors: [String(error)] };
	}
}
