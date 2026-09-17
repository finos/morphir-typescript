// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { admitExactCaseForTesting, admitLocalRegistryRepository } from "../../src/package/local-registry/admission.ts";
import { repositorySource } from "../../src/package/local-registry/corpus.ts";
import { inspectLocalRegistryRepository } from "../../src/package/local-registry/definition.ts";

const args = process.argv.slice(2);
assert(args.length === 2 && args[0] === "--source" && args[1] && !args[1].startsWith("--"), "Expected explicit --source <parent-root>");
const summary = inspectLocalRegistryRepository(args[1]);
assert.deepEqual(summary, { kind: "definition-summary", caseCount: 54, boundAssetCount: 6, pendingAssetCount: 121, errors: [] });
const admission = admitLocalRegistryRepository(args[1]);
assert.equal(admission.kind, "kit-error");
assert(!("contentHash" in admission) && !("value" in admission));
const exact = admitExactCaseForTesting(repositorySource(args[1]), "local-registry.wire.valid-two-node");
assert.equal(exact.kind, "admitted", JSON.stringify(exact));
assert(!("contentHash" in exact) && !("report" in exact));
console.log(JSON.stringify(summary));
