# @finos/morphir-mck

The Morphir Compatibility Kit driver. The kit is a set of Markdown case files whose fenced blocks state what every Morphir binding must decode, reject, and write back; this package runs those cases against a binding and writes a conformance report. A copy of the kit ships inside the package, so a run needs no checkout. The package is ESM-only and runs on Node 20 or later.

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

`mck run` exits 0 when every record passes, 1 when a record fails or the kit itself does not parse, and 2 on a usage error. `--strict` also fails the run on warnings. `--kit <dir>` runs a checkout's `spec/ir/mck` instead of the embedded copy, and `--only <regex>` narrows the run to matching case ids.

Report which vocabulary entries — variants and member spellings — no case exercises:

```sh
mck coverage
```

Show which kit the embedded copy is pinned to, and whether it still matches its lock file:

```sh
mck kit status --remote
```

A report validates against [`spec/ir/mck/report.schema.json`](https://github.com/finos/morphir/blob/main/spec/ir/mck/report.schema.json) in finos/morphir, which also ships as `kit/spec/ir/mck/report.schema.json` inside this package. An adapter validates against [`packages/mck/protocol.schema.json`](https://github.com/finos/morphir-typescript/blob/main/packages/mck/protocol.schema.json) in finos/morphir-typescript. The embedded kit's provenance — the commit it was vendored from and its content hash — is `kit.lock.json` beside this file.

Copyright 2026 FINOS. Licensed under Apache-2.0.
