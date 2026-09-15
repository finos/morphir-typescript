// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// The seam between a serialization profile and the v4 readers and writers:
// both profiles produce and consume the same strict JsonValue tree, so
// everything above this interface is profile-blind. The document tree in
// layout/ takes a ProfileCodec and never learns which one it got.
import type { Diagnostic } from "../model/diagnostic.ts";
import type { Result } from "../model/result.ts";
import { type JsonValue, parseJson, writeJson } from "./json/value.ts";

export type ProfileName = "json" | "yaml";

export interface ProfileCodec {
	readonly name: ProfileName;
	readonly extension: ".json" | ".yaml";
	parse(text: string): Result<JsonValue, Diagnostic>;
	write(value: JsonValue): string;
}

export const JSON_PROFILE: ProfileCodec = { name: "json", extension: ".json", parse: parseJson, write: writeJson };
