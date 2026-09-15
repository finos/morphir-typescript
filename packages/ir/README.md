# @finos/morphir-ir

Morphir IR semantic types, pinned v4 types, JSON readers, and canonical writers. The package is ESM-only.

```sh
npm install @finos/morphir-ir
```

The package exports `@finos/morphir-ir`, `@finos/morphir-ir/model`, `@finos/morphir-ir/v4`, `@finos/morphir-ir/codec/json`, `@finos/morphir-ir/codec/yaml`, `@finos/morphir-ir/layout`, and `@finos/morphir-ir/layout/node`.

```ts
import { json } from "@finos/morphir-ir";

const source = `{ "formatVersion": 4, "distribution": { "Library": { "packageName": "example", "dependencies": {}, "def": { "modules": {} } } } }`;
const result = json.read(source);

if (!result.ok) {
	throw new Error(`${result.error.code} at ${result.error.cursor}: ${result.error.message}`);
}

console.log(json.write(result.value));
```

`@finos/morphir-ir/codec/yaml` reads and writes the same distribution as the YAML profile:

```ts
import { parseYaml } from "@finos/morphir-ir/codec/yaml";

const result = parseYaml("formatVersion: 4\n");
if (!result.ok) {
	throw new Error(`${result.error.code}: ${result.error.message}`);
}
```

`@finos/morphir-ir/layout` lays a distribution out as a document tree — a map of logical paths to text — and reads one back; `@finos/morphir-ir/layout/node` is the same tree read from, or written to, a real directory:

```ts
import { YAML_PROFILE } from "@finos/morphir-ir/codec/yaml";
import { readTreeFromDirectory } from "@finos/morphir-ir/layout/node";

const result = await readTreeFromDirectory("./my-distribution", YAML_PROFILE);
if (!result.ok) {
	throw new Error(`${result.error.code} at ${result.error.cursor}: ${result.error.message}`);
}
```

Copyright 2026 FINOS. Licensed under Apache-2.0.
