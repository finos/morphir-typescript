// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The document tree, as a pure function between a distribution and a map of
// logical paths to text. Nothing here reaches a filesystem: the Node adapter
// lives behind its own subpath (`./layout/node`) so a browser never pulls it
// in, and everything below is the same in both.
export { classify, fromPhysical, type LogicalPath, MANIFEST, type PathKind, toPhysical } from "./paths.ts";
export { type DocumentTree, readTree } from "./read-tree.ts";
export { sha256Hex } from "./sha256.ts";
export { FILE_STEM, type StemResult, stemFor } from "./stems.ts";
export { type TreePolicy, writeTree } from "./write-tree.ts";
