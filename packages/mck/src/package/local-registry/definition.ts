// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { array, object } from "../json.ts";
import { type CorpusSource, corpus, fileMapSource, repositorySource } from "./corpus.ts";
import { validateDefinitions } from "./semantics.ts";

export interface DefinitionSummary {
	readonly kind: "definition-summary";
	readonly caseCount: number;
	readonly boundAssetCount: number;
	readonly pendingAssetCount: number;
	readonly errors: readonly string[];
}
export function inspectLocalRegistry(source: CorpusSource): DefinitionSummary {
	try {
		const loaded = corpus(source);
		validateDefinitions(loaded);
		const assets = array(loaded.index.assets).map(object);
		return {
			kind: "definition-summary",
			caseCount: loaded.cases.length,
			boundAssetCount: assets.filter((asset) => asset.kind === "bound").length,
			pendingAssetCount: assets.filter((asset) => asset.kind === "pending").length,
			errors: [],
		};
	} catch (error) {
		return { kind: "definition-summary", caseCount: 0, boundAssetCount: 0, pendingAssetCount: 0, errors: [String(error)] };
	}
}
export const inspectLocalRegistryFromFiles = (files: ReadonlyMap<string, Uint8Array>): DefinitionSummary => inspectLocalRegistry(fileMapSource(files));
export function inspectLocalRegistryRepository(root: string): DefinitionSummary {
	return inspectLocalRegistry((name) => repositorySource(root)(name));
}
