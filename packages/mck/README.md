# @finos/morphir-mck

The Morphir Compatibility Kit driver. The IR kit is a set of Markdown case files whose fenced blocks state what every Morphir binding must decode, reject, and write back; this package runs those cases against a binding and writes a conformance report. A copy of the IR kit ships inside the package, so an IR run needs no checkout. The experimental package suite uses a separately supplied corpus. The package is ESM-only and runs on Node 20 or later.

```sh
npm install -g @finos/morphir-mck
```

The install provides two binaries: `mck`, the driver, and `mck-adapter-typescript`, the reference adapter that puts the TypeScript binding behind the adapter protocol.

Run the embedded kit against the built-in TypeScript binding:

```sh
mck run --report report.json
```

Run it against any other binding by naming an executable that speaks the adapter protocol on stdin and stdout:

```sh
mck run --adapter my-binding-adapter --adapter-arg --profile=json --report report.json
```

`mck run` exits 0 when every record passes, 1 when a record fails or the kit itself does not parse, and 2 on a usage error. `--strict` also fails the run on skipped records. `--kit <dir>` runs a checkout's `spec/ir/mck` instead of the embedded copy, and `--only <regex>` narrows the run to matching case ids.

The driver checks JSON, YAML, and document-tree fences alike: a YAML fence round-trips through the binding's YAML codec the same way a JSON fence does, and a `file` set of fences checks the binding's document-tree reader and writer against a whole directory of files. A set marked `mode=read` only exercises the read half: for input a canonical writer never reproduces itself, such as a `$meta` member the kit carries for a read-only case. Run against the embedded kit, `mck run` currently reports:

```text
722 pass, 0 fail, 0 kit-error, 8 skipped
skipped versions-0001 fence 0 [current]: version 3 not in capabilities
skipped versions-0001 fence 0 [pinned]: version 3 not in capabilities
skipped versions-0006 fence 0 [current]: version 3 not in capabilities
skipped versions-0006 fence 0 [pinned]: version 3 not in capabilities
skipped versions-0007 fence 0 [current]: version 3 not in capabilities
skipped versions-0007 fence 0 [pinned]: version 3 not in capabilities
skipped versions-0008 fence 0 [current]: version 3 not in capabilities
skipped versions-0008 fence 0 [pinned]: version 3 not in capabilities
```

The eight skips are the kit's version-3 fences, which the TypeScript binding's capabilities do not name; a binding that declares version 3 answers them.

Report which vocabulary entries — variants and member spellings — no case exercises:

```sh
mck coverage
```

Show which kit the embedded copy is pinned to, and whether it still matches its lock file:

```sh
mck kit status --remote
```

A report validates against [`spec/ir/mck/report.schema.json`](https://github.com/finos/morphir/blob/main/spec/ir/mck/report.schema.json) in finos/morphir, which also ships as `kit/spec/ir/mck/report.schema.json` inside this package. An adapter validates against [`packages/mck/protocol.schema.json`](https://github.com/finos/morphir-typescript/blob/main/packages/mck/protocol.schema.json) in finos/morphir-typescript, which ships as `protocol.schema.json` beside this file along with a worked exchange in `protocol.example.json`. The embedded kit's provenance — the commit it was vendored from and its content hash — is `kit.lock.json` beside this file.

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

`mck package run --contract 0.1.0-draft.1 --kit /path/to/finos/morphir/spec/package/mck --report package.json`
runs the draft package corpus owned by finos/morphir. The package corpus is not embedded;
the existing embedded kit and `kit.lock.json` still identify only the IR suite.

Use an executable implementation with:

```shell
mck package run --contract 0.1.0-draft.1 --kit /path/to/spec/package/mck \
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
mck package run --contract 0.1.0-draft.2 --kit /path/to/spec/package/mck \
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

All loaded cases are required. A missing capability, failed comparison, kit/adapter error, or empty corpus
causes a nonzero exit. Reports include testee capabilities and a hash of every consumed schema, case and fixture.
Record checkout commits separately when comparing development runs. In-process and process runs of the
TypeScript reference are one implementation, not two independent implementations.

For library consumers, import `loadPackageKit`, `runPackageKit`, `packageExitCode`, and either
`referencePackageTestee` or `processPackageTestee`. Other implementations implement `PackageTestee`.
`runPackageKit` consumes and closes the testee session before returning its report. Abnormal adapter
shutdown adds a kit-error record and prevents a successful exit.
The loader and driver do not derive expectations from reference operations. They share transport lifecycle,
summary formatting and corpus hashing with IR support, without introducing synthetic IR nodes or fields.
