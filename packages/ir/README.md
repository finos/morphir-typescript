# @finos/morphir-ir

Morphir IR semantic types, pinned v4 types, JSON readers, and canonical writers. The package is ESM-only.

```sh
npm install @finos/morphir-ir
```

The package exports `@finos/morphir-ir`, `@finos/morphir-ir/model`, `@finos/morphir-ir/v4`, and `@finos/morphir-ir/codec/json`.

```ts
import { json } from "@finos/morphir-ir";

const source = `{ "formatVersion": 4, "distribution": { "Library": { "packageName": "example", "dependencies": {}, "def": { "modules": {} } } } }`;
const result = json.read(source);

if (!result.ok) {
	throw new Error(`${result.error.code} at ${result.error.cursor}: ${result.error.message}`);
}

console.log(json.write(result.value));
```

Copyright 2026 FINOS. Licensed under Apache-2.0.
