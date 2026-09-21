# Frozen IR codec regressions

These inputs preserve implementation regression coverage when the TypeScript IR
MCK runner was retired. Both JSON files record the exact source commit in `source`.
The cases came from finos/morphir commit
`2bab57ea23fe85c6f9cc434b32e61f29ca14190c`, previously vendored by this package.

`yaml-regressions.json` retains the YAML fences and their canonical JSON twins,
plus the complete YAML document. The tests assert 98 paired canonical cases,
121 canonical/file YAML idempotence fences and nine rejected YAML inputs.

`layout-regressions.json` retains every document-tree YAML file set and canonical,
all 12 distribution JSON canonicals and the complete JSON example used by the
layout tests. The existing layout assertions and corpus inventory remain intact.

These are fixed codec test inputs, not a compatibility kit or a kit parser.
Current conformance is checked by native `morphir mck` against the managed
snapshot in `vendor/morphir-mck`. Deliberate codec expectation changes should be
reviewed with the source specification and native compatibility results.
