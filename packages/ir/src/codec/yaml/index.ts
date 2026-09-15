// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The YAML profile: reader (parse.ts) and canonical writer (write.ts).
import type { ProfileCodec } from "../profile.ts";
import { parseYaml } from "./parse.ts";
import { writeYaml } from "./write.ts";

export { parseYaml } from "./parse.ts";
export { writeYaml } from "./write.ts";

export const YAML_PROFILE: ProfileCodec = { name: "yaml", extension: ".yaml", parse: parseYaml, write: writeYaml };
