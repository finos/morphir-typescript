#!/usr/bin/env node
// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
// Package MCK CLI. IR compatibility is owned by the released native Morphir CLI.
import { Command, Options, ValidationError } from "@effect/cli";
import { NodeContext } from "@effect/platform-node";
import { Effect, Option, Schema } from "effect";
import { bindingVersion } from "./binding-version.ts";
import { runPackageCommand } from "./package/cli.ts";
import { PACKAGE_CONTRACT } from "./package/contract.ts";
import { RESOLUTION_CONTRACT } from "./package/resolution/contract.ts";

const ROOT_USAGE = "usage: mck package run --kit <directory>; see `mck --help`";
const DEFAULT_TIMEOUT_MS = 30000;
const PositiveMilliseconds = Schema.Number.pipe(Schema.positive({ message: () => "--timeout must be a positive number of milliseconds" }));

// Give old invocations an actionable error, including their old help routes.
if (["check", "run", "coverage", "kit"].includes(process.argv[2] ?? "")) {
	console.error(
		"IR MCK commands moved to the released native Morphir CLI. Use morphir mck check, coverage, kit, or run --adapter mck-adapter-typescript. The npm mck command now supports only package run; see https://github.com/finos/morphir-typescript/blob/main/packages/mck/README.md",
	);
	process.exit(2);
}

const packageRun = Command.make(
	"run",
	{
		contract: Options.text("contract").pipe(
			Options.withDescription("Package contract revision to run."),
			Options.withSchema(Schema.Literal(PACKAGE_CONTRACT, RESOLUTION_CONTRACT)),
			Options.withDefault(PACKAGE_CONTRACT),
		),
		kit: Options.text("kit").pipe(Options.withDescription("The draft spec/package/mck corpus directory.")),
		adapter: Options.text("adapter").pipe(Options.optional, Options.map(Option.getOrUndefined)),
		adapterArgs: Options.text("adapter-arg").pipe(Options.withDescription("An argument for the package adapter; repeatable."), Options.repeated),
		report: Options.text("report").pipe(Options.optional, Options.map(Option.getOrUndefined)),
		timeoutMs: Options.integer("timeout").pipe(Options.withSchema(PositiveMilliseconds), Options.withDefault(DEFAULT_TIMEOUT_MS)),
	},
	handler(runPackageCommand),
).pipe(Command.withDescription("Run the draft package suite; every case is required."));

const packageCommand = Command.make("package", {}, usageError("usage: mck package run --kit <directory>; see `mck package --help`")).pipe(
	Command.withDescription("Run model package compatibility cases."),
	Command.withSubcommands([packageRun]),
);

const mck = Command.make("mck", {}, usageError(ROOT_USAGE)).pipe(
	Command.withDescription("Morphir package compatibility tooling. For IR, use morphir mck with an explicit adapter."),
	Command.withSubcommands([packageCommand]),
);

/**
 * Wraps a command's plain handler: the exit code it returns becomes the
 * process's, and anything it throws becomes the runner's `error:` line.
 */
function handler<A>(command: (args: A) => number | Promise<number>): (args: A) => Effect.Effect<void, Error> {
	return (args) =>
		Effect.tryPromise({
			try: async () => {
				process.exitCode = await command(args);
			},
			catch: (error) => (error instanceof Error ? error : new Error(String(error))),
		});
}

/** A parent command given no subcommand is a usage error, like any other. */
function usageError(usage: string): () => Effect.Effect<void> {
	return () =>
		Effect.sync(() => {
			console.error(usage);
			process.exitCode = 2;
		});
}

const cli = Command.run(mck, { name: "mck", version: bindingVersion() });

// @effect/cli prints a usage error before failing with it; a thrown error is
// ours to report. Both land on the exit codes the README documents.
const program = cli(process.argv).pipe(
	Effect.catchIf(ValidationError.isValidationError, () =>
		Effect.sync(() => {
			process.exitCode = 2;
		}),
	),
	Effect.catchAll((error) =>
		Effect.sync(() => {
			console.error(`error: ${error.message}`);
			process.exitCode = 1;
		}),
	),
	Effect.provide(NodeContext.layer),
);

await Effect.runPromise(program);
process.exit(process.exitCode ?? 0);
