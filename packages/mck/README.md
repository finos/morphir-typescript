# @finos/morphir-mck

Package implementation helpers and the TypeScript IR and package adapters. The package is ESM-only and requires Node 24 or later.

```sh
npm install -g @finos/morphir-mck
```

The install provides `mck-adapter-typescript`, the TypeScript implementation's JSON-lines adapter. Install the native Morphir CLI separately to run compatibility suites.

## Migrating IR consumers

IR compatibility now runs through the released native [Morphir CLI](https://github.com/finos/morphir/releases). Install that CLI separately; the npm command does not download it or forward commands. Use an explicit adapter:

```sh
morphir mck kit vendor --source embedded --dest ./mck-kit
morphir mck check ./mck-kit
morphir mck coverage --kit ./mck-kit
morphir mck schema check --kit ./mck-kit
morphir mck run --kit ./mck-kit --adapter mck-adapter-typescript --report ir-report.json
printf '{"cases":[]}\n' > allowed-failing.json
morphir mck report check ir-report.json allowed-failing.json --kit ./mck-kit
```

For a local npm install, pass `--adapter node --adapter-arg /absolute/path/to/node_modules/@finos/morphir-mck/dist/adapter.js`. The adapter protocol remains version 1, with `protocol.schema.json` and `protocol.example.json` shipped in the package. Native reports use the consolidated `2.0.0-draft.1` contract, not the retired TypeScript IR report format.

The npm `mck` executable has been removed. The library no longer exports IR or package runner, comparison, coverage, corpus loader, embedded-kit, kit-version, report-summary, or subprocess-client APIs. Use `morphir mck` for IR operations and `morphir mck package run` for draft package compatibility. The implementation APIs, resolver, adapter/protocol codecs and draft.3 local-registry helpers remain available. `bindingVersion()` is the package-version helper.

Future GitHub releases contain five `mck-adapter-typescript-VERSION-OS-ARCH` executables and the two npm tarballs. They no longer build standalone `mck-VERSION-OS-ARCH` drivers. Historical release assets remain unchanged.

The package no longer ships an IR kit or `kit.lock.json`. Source CI uses the native managed snapshot at `vendor/morphir-mck` and the checksum-pinned CLI in `.config/mck-cli.json`. The installed Node 24 adapter is tested by that CLI before its npm artifact is promoted. IR codec regression fixtures retain the old canonical YAML cases independently of the runner.

Copyright 2026 FINOS. Licensed under Apache-2.0.

## Experimental package suite

Draft.3 local Library definitions can be inspected through the library API:

```ts
import { inspectLocalRegistryRepository, admitLocalRegistryRepository } from "@finos/morphir-mck";

const summary = inspectLocalRegistryRepository("/path/to/finos/morphir");
// { kind: "definition-summary", caseCount, boundAssetCount, pendingAssetCount, errors }
const admission = admitLocalRegistryRepository("/path/to/finos/morphir");
if (admission.kind === "kit-error") throw new Error(admission.errors.join("\n"));
// admission.value contains constructed cases and the executable corpus contentHash.
```

Definition inspection permits declared pending assets and returns no compatibility
report, pass count or executable hash. Full admission validates every asset and complete
expectation before returning an executable kit. Pending assets are kit errors.
Both functions also have `FromFiles` variants taking a map of repository-relative
slash-separated paths to exact bytes, including `spec/package/mck/...` and local schemas.
Filesystem loading expects a trusted static repository checkout and rejects path escapes.
This admission API does not execute a testee, restore packages, verify signatures or
claim runtime compatibility. Draft.1, draft.2 and IR v1 execution remain separate.

The explicit integration check requires the parent source and fails if it is absent:

```sh
bun packages/mck/test/support/local-registry-parent-integration.ts --source /path/to/finos/morphir
```

Internal draft.3 decoders validate raw locks, canonical records and statement payloads,
and explicit trust policies. They preserve exact TUF integer lexemes and keep DSSE's
JSON domain separate from Morphir metadata. Policy helpers match complete namespace
components and select the most specific publisher rule without fallback.
These modules are not public package exports. A decoded value proves neither signatures
nor authorization; no authenticated restore or qualified filesystem provider is supplied.

The decoder integration check compares fixed rejection diagnostics and the signed
fixture's document shapes. It does not execute pending scenarios or produce a
compatibility report:

```sh
bun packages/mck/test/support/local-registry-decode-parent-integration.ts --source /path/to/finos/morphir
```

The internal `restore-filesystem-assurance` preflight profile, version `0.1.0-draft.1`,
guards a callback with explicit trusted-host `portable` or `hardened` selection.
Unqualified providers and unavailable modes return rejection before the callback;
malformed inputs throw. Successful selection supplies a copied, deeply immutable context.
Callback failures propagate without retry or downgrade.

Provider qualification metadata records identity, mode, environment, assumptions and
evidence references. Parsing it does not verify evidence or qualify a provider. The
selected receipt is neither authentication success nor a compatibility result and cannot
authorize another invocation. Callers must provide trusted host policy on each invocation.
No real provider or platform is qualified here.

`package-restore-assurance-protocol.schema.json` and
`package-restore-assurance-report.schema.json` describe the closed request and preflight
receipt. They are source-only internal contracts, not published adapter transports or
additions to the existing executable package protocols. Full portable execution, its
complete required-case set, authentication, durable state and platform qualification
remain separate work. The following check compares six parent-owned synthetic expectations
without executing or relabeling any draft.3 case:

```sh
bun packages/mck/test/support/local-registry-assurance-parent-integration.ts --source /path/to/finos/morphir
```

`morphir mck package run --contract 0.1.0-draft.1 --kit /path/to/finos/morphir/spec/package/mck --adapter mck-adapter-typescript --adapter-arg --suite --adapter-arg package --report package.json`
runs the draft package corpus owned by finos/morphir. Supply the package corpus and adapter explicitly.

Use an executable implementation with:

```shell
morphir mck package run --contract 0.1.0-draft.1 --kit /path/to/spec/package/mck \
  --adapter mck-adapter-typescript --adapter-arg --suite --adapter-arg package \
  --report package-adapter.json
```

The package protocol is `suite: "package"`, `contractVersion: "0.1.0-draft.1"`.
It does not extend IR protocol or report version 1. The default adapter still speaks IR v1.
See `package-protocol.schema.json` and `package-report.schema.json` for wire shapes.
Requests and responses use the existing JSON-lines envelope with incrementing positive `id` values.
`capabilities` returns implementation name, version and supported operations; `exit` ends the process
without a response. Protocol or infrastructure errors terminate the reference adapter with a nonzero exit.
Only a valid operation result can satisfy an expected rejection.

Omitting `--contract` preserves `0.1.0-draft.1`. Select Library resolution explicitly:

```shell
morphir mck package run --contract 0.1.0-draft.2 --kit /path/to/spec/package/mck \
  --adapter mck-adapter-typescript --adapter-arg --suite --adapter-arg package \
  --adapter-arg --contract --adapter-arg 0.1.0-draft.2 \
  --report package-resolution.json
```

Draft.2 has the single `resolve-library` operation and requires the `flat-library` profile.
Its raw string input preserves malformed JSON and duplicate keys as domain cases. Its installed
wire and report schemas are `package-resolution-protocol.schema.json` and
`package-resolution-report.schema.json`. Unknown contracts fail before corpus loading. Invoking
the adapter without package arguments still selects the unchanged IR v1 protocol.

| Operation | Input | Result |
| --- | --- | --- |
| `normalize` | Raw metadata JSON | Canonical text and fixed-domain manifest/content digests, or `invalid-document` |
| `hash-bytes` | Lowercase hexadecimal bytes | Exact-byte SHA-256 digest |
| `validate` | Raw JSON, artifact `manifest` or `lock`, schema bundle | Structural acceptance boolean |
| `verify-library-set` | Raw lock JSON, Library manifests and payload byte maps, schema bundle | Closed-set integrity boolean |

Schema bundles come from the parent corpus and contain `manifest` and `lock` JSON Schemas.
Native validators can implement the artifact contract directly; the TypeScript reference uses Ajv draft 2020-12.
Invalid schemas and unresolved references are kit errors, not rejected artifacts. The reference never reads
fixture files itself; all input bytes arrive through the same operation interface used by executable adapters.

Library-set verification checks exact content membership and bytes, metadata normalization, lock digests,
release identities, binding targets, stable-version intervals, v4 codec acceptance, IR package/dependency names,
and public export targets. It does not implement version selection, public-specification compatibility,
trust, archive extraction, or installation. A successful run is evidence for this bounded draft only.

`resolveLibrary` is the validated draft.2 boundary. The exported low-level search and update
functions require a value already returned by `parseResolutionInput`; raw or otherwise
unvalidated JSON-shaped values are outside their contract.

All loaded cases are required by the native runner. A missing capability, failed comparison, kit/adapter error,
or empty corpus causes a nonzero exit. Reports include testee capabilities and a hash of every consumed schema,
case and fixture. Record checkout commits separately when comparing development runs.

Library consumers can call `referencePackageTestee()` and `referenceResolutionTestee()` as direct TypeScript
implementations, or use the lower-level metadata, library, resolver and protocol helpers exported from the root.
`PackageTestee` and `ResolutionTestee` describe those implementation boundaries. The former `loadPackageKit`,
`loadResolutionKit`, `runPackageKit`, `runResolutionKit`, `packageExitCode`, `processPackageTestee`,
`processResolutionTestee`, `formatSummary` and `summarize` APIs have no TypeScript replacement: use the native
CLI to load corpora, manage adapter processes, compare expectations and write reports.
