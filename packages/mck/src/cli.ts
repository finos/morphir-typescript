#!/usr/bin/env node
// Command-line entry for @finos/morphir-mck, built on @effect/cli.
//
//   mck check <dir> [--json]
//   mck kit sync <repository-root> [--force]
//   mck kit status [--remote]
//   mck run [--kit <dir>] [--repo-root <dir>] [--adapter <exe> [--adapter-arg <arg>]...] [--report <file>] [--strict] [--only <regex>] [--timeout <ms>]
//   mck coverage [--kit <dir>] [--repo-root <dir>]
//   mck --version
//   mck --help, mck <command> --help
//
// finos/morphir-typescript#1 shipped `check`. #6 adds `kit sync` (vendor the
// parent repository's kit into packages/mck/kit) and `kit status` (prove the
// vendored copy still matches kit.lock.json), plus `run`, the driver
// itself, over the in-process TypeScript binding by default, or over
// `--adapter <exe>` (a child process speaking the JSON-lines protocol) when
// given; and `coverage` (see the kit README's coverage description), which
// reports every v4 vocabulary entry (a variant or a member spelling) that no
// kit case exercises.
//
// @effect/cli owns parsing, help, and the rendering of usage errors. The
// driver keeps the exit codes the README documents: 0 when the command
// succeeds, 1 when it fails or throws, 2 on a usage error. Each command's
// handler is a plain function from its parsed input to an exit code, so the
// Effect surface stays at this file's edges.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Args, Command, Options, ValidationError } from "@effect/cli";
import { NodeContext } from "@effect/platform-node";
import { Effect, Option, ParseResult, Schema } from "effect";
import { VOCABULARY } from "../../ir/src/versions/v4/index.ts";
import { coverageGaps, formatGap } from "./coverage/coverage.ts";
import { runKit as driveKit, exitCodeFor } from "./driver/run.ts";
import { driverVersion, kitVersion } from "./driver/version.ts";
import { embeddedKitCommit, embeddedKitFiles } from "./kit/embedded-source.ts";
import { loadKit, loadKitFromFiles } from "./kit/load.ts";
import { kitStatus, readLock, syncKit } from "./kit/sync.ts";
import { runPackageCommand } from "./package/cli.ts";
import { PACKAGE_CONTRACT } from "./package/contract.ts";
import { RESOLUTION_CONTRACT } from "./package/resolution/contract.ts";
import { formatSummary, writeReport } from "./report.ts";
import { inProcessTestee, resolveNode } from "./testee/in-process.ts";
import { processTestee } from "./testee/process.ts";

const ROOT_USAGE = "usage: mck <check | run | coverage | kit | package> [options]; see `mck --help`";
const KIT_USAGE = "usage: mck kit <sync | status> [options]; see `mck kit --help`";

function packageRoot(): string {
	// `import.meta.dirname` only exists from Node 20.11; `engines.node` is `>=20`.
	return process.env.MCK_PACKAGE_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

// ---------------------------------------------------------------------------
// check

interface CheckArgs {
	readonly dir: string;
	readonly json: boolean;
}

async function runCheck(args: CheckArgs): Promise<number> {
	const kit = await loadKit(path.resolve(args.dir));
	if (args.json) {
		console.log(
			JSON.stringify(
				{
					files: kit.files,
					cases: kit.cases.map((c) => c.id),
					errors: kit.errors,
				},
				null,
				"\t",
			),
		);
		return kit.errors.length === 0 ? 0 : 1;
	}
	for (const e of kit.errors) console.error(`${e.file}:${e.line}: ${e.message}`);
	console.log(`${kit.cases.length} case(s) in ${kit.files.length} file(s), ${kit.errors.length} error(s)`);
	return kit.errors.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// kit sync, kit status

/**
 * True when the package root holds no `kit.lock.json`. `bun build --compile`
 * bundles the sources under a virtual root (`B:/~BUN`) that contains only the
 * modules it bundled, so `kit.lock.json` and the `kit/` tree are not there: a
 * compiled binary carries the kit through `kit/embedded.ts` instead. The `kit`
 * subcommands read both, so they report the embedded kit rather than failing
 * with ENOENT on a path inside the virtual root.
 */
function compiledWithoutCheckout(): boolean {
	return !existsSync(path.join(packageRoot(), "kit.lock.json"));
}

interface KitSyncArgs {
	readonly repositoryRoot: string;
	readonly force: boolean;
}

async function runKitSync(args: KitSyncArgs): Promise<number> {
	if (compiledWithoutCheckout()) {
		console.error(`error: kit sync needs a source checkout of @finos/morphir-mck; this binary embeds the kit at finos/morphir ${embeddedKitCommit()}`);
		return 2;
	}
	const lock = await syncKit(packageRoot(), path.resolve(args.repositoryRoot), { force: args.force });
	console.log(`kit synced to ${lock.commit} (${countSyncedFiles(packageRoot())} files, ${lock.contentHash})`);
	return 0;
}

function countSyncedFiles(root: string): number {
	let count = 0;
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			const p = path.join(dir, entry);
			if (entry === "embedded.ts") continue;
			if (statSync(p).isDirectory()) walk(p);
			else count += 1;
		}
	};
	walk(path.join(root, "kit"));
	return count;
}

interface KitStatusArgs {
	readonly remote: boolean;
}

function runKitStatus(args: KitStatusArgs): number {
	const root = packageRoot();
	let commit: string;
	let code: number;
	if (compiledWithoutCheckout()) {
		commit = embeddedKitCommit();
		console.log(`embedded kit: finos/morphir ${commit} (compiled binary; lock file not available)`);
		code = 0;
	} else {
		const status = kitStatus(root);
		commit = readLock(root).commit;
		if (status.ok) {
			console.log(`kit matches kit.lock.json (${commit})`);
		} else {
			console.error(`kit differs from kit.lock.json: expected ${status.expected} actual ${status.actual}`);
		}
		code = status.ok ? 0 : 1;
	}
	if (args.remote) {
		try {
			const out = execFileSync("git", ["ls-remote", "https://github.com/finos/morphir", "refs/heads/main"], { encoding: "utf8" }).trim();
			const remote = out.split(/\s+/)[0] ?? "";
			const relation = remote === commit ? "same as" : "behind";
			console.log(`pinned ${commit} is ${relation} origin/main ${remote}`);
		} catch (error) {
			console.error(`could not reach origin/main: ${(error as Error).message}`);
		}
	}
	return code;
}

// ---------------------------------------------------------------------------
// run, coverage

// When `--kit` names a checkout's spec/ir/mck, the repository root three
// levels up is the natural default for resolving `text` fences that name
// other repository files (e.g. website/static/ir/examples/...).
function inferredRoot(kitDirectory: string): string | undefined {
	const normalized = kitDirectory.split(path.sep).join("/");
	return normalized.endsWith("spec/ir/mck") ? path.resolve(kitDirectory, "..", "..", "..") : undefined;
}

// The [--kit <dir>] [--repo-root <dir>] pair is shared by `run` and
// `coverage`; both resolve the same way (embedded kit by default, a checkout
// otherwise, with the repository root inferred from a spec/ir/mck path).
interface KitArgs {
	readonly kit: string | undefined;
	readonly repoRoot: string | undefined;
}

async function loadKitFor(args: KitArgs): ReturnType<typeof loadKit> {
	return args.kit === undefined
		? loadKitFromFiles(embeddedKitFiles())
		: loadKit(path.resolve(args.kit), args.repoRoot === undefined ? inferredRoot(path.resolve(args.kit)) : path.resolve(args.repoRoot));
}

async function runCoverage(args: KitArgs): Promise<number> {
	const kit = await loadKitFor(args);
	const gaps = coverageGaps(kit, VOCABULARY, resolveNode);
	if (gaps.length === 0) {
		console.log("coverage: every vocabulary entry has a case");
		return 0;
	}
	for (const g of gaps) console.log(formatGap(g));
	return 1;
}

const DEFAULT_TIMEOUT_MS = 30000;

interface RunArgs extends KitArgs {
	readonly adapter: string | undefined;
	readonly adapterArgs: readonly string[];
	readonly report: string | undefined;
	readonly strict: boolean;
	readonly only: RegExp | undefined;
	readonly timeoutMs: number;
}

async function runRun(args: RunArgs): Promise<number> {
	const kit = await loadKitFor(args);
	const kv = args.kit === undefined ? kitVersion(null) : kitVersion(path.resolve(args.kit));
	const testee = args.adapter === undefined ? inProcessTestee() : processTestee([args.adapter, ...args.adapterArgs], { timeoutMs: args.timeoutMs });
	try {
		const report = await driveKit(kit, testee, {
			strict: args.strict,
			only: args.only,
			driverVersion: driverVersion(),
			kitVersion: kv,
			// The header goes to stderr so a piped `--report -` or the summary on
			// stdout stays machine-readable.
			onHeader: (line) => console.error(line),
		});
		if (args.report !== undefined) writeReport(report, path.resolve(args.report));
		console.log(formatSummary(report));
		for (const r of report.records) {
			if (r.result === "pass") continue;
			const pathSuffix = r.path === undefined ? "" : ` [${r.path}]`;
			console.log(`${r.result} ${r.caseId} fence ${r.fenceIndex}${pathSuffix}: ${r.message ?? ""}`);
		}
		return exitCodeFor(report, args.strict);
	} finally {
		await testee.close();
	}
}

// ---------------------------------------------------------------------------
// Command line

/** A `--only` operand must compile as a JavaScript regular expression. */
const RegExpFromString = Schema.transformOrFail(Schema.String, Schema.instanceOf(RegExp), {
	strict: true,
	decode: (source, _, ast) =>
		ParseResult.try({
			try: () => new RegExp(source),
			catch: (error) => new ParseResult.Type(ast, source, `invalid --only regex: ${(error as Error).message}`),
		}),
	encode: (regex) => ParseResult.succeed(regex.source),
});

/** A `--timeout` operand is a positive number of milliseconds. */
const PositiveMilliseconds = Schema.Number.pipe(Schema.positive({ message: () => "--timeout must be a positive number of milliseconds" }));

const kitOption = Options.text("kit").pipe(
	Options.withDescription("Run a checkout's spec/ir/mck instead of the embedded kit."),
	Options.optional,
	Options.map(Option.getOrUndefined),
);
const repoRootOption = Options.text("repo-root").pipe(
	Options.withDescription("The repository root that `text` fences resolve against; inferred from a spec/ir/mck --kit path."),
	Options.optional,
	Options.map(Option.getOrUndefined),
);

const check = Command.make(
	"check",
	{
		dir: Args.text({ name: "dir" }).pipe(Args.withDescription("A kit directory to parse.")),
		json: Options.boolean("json").pipe(Options.withDescription("Print the files, case ids, and errors as JSON.")),
	},
	handler(runCheck),
).pipe(Command.withDescription("Parse a kit directory and report its cases and errors."));

const kitSync = Command.make(
	"sync",
	{
		repositoryRoot: Args.text({ name: "repository-root" }).pipe(Args.withDescription("A finos/morphir checkout to vendor the kit from.")),
		force: Options.boolean("force").pipe(Options.withDescription("Sync even when the checkout is older than the pinned commit.")),
	},
	handler(runKitSync),
).pipe(Command.withDescription("Vendor the parent repository's kit into this package."));

const kitStatusCommand = Command.make(
	"status",
	{ remote: Options.boolean("remote").pipe(Options.withDescription("Also compare the pinned commit with finos/morphir origin/main.")) },
	handler(runKitStatus),
).pipe(Command.withDescription("Prove the vendored kit still matches kit.lock.json."));

const kit = Command.make("kit", {}, usageError(KIT_USAGE)).pipe(
	Command.withDescription("Manage the vendored kit."),
	Command.withSubcommands([kitSync, kitStatusCommand]),
);

const run = Command.make(
	"run",
	{
		kit: kitOption,
		repoRoot: repoRootOption,
		adapter: Options.text("adapter").pipe(
			Options.withDescription("Run the kit through this adapter executable instead of the in-process TypeScript binding."),
			Options.optional,
			Options.map(Option.getOrUndefined),
		),
		adapterArgs: Options.text("adapter-arg").pipe(Options.withDescription("An argument for the adapter executable; repeatable."), Options.repeated),
		report: Options.text("report").pipe(
			Options.withDescription("Write the conformance report to this file."),
			Options.optional,
			Options.map(Option.getOrUndefined),
		),
		strict: Options.boolean("strict").pipe(Options.withDescription("Also fail the run on skipped records.")),
		only: Options.text("only").pipe(
			Options.withDescription("Run only the cases whose id matches this regular expression."),
			Options.withSchema(RegExpFromString),
			Options.optional,
			Options.map(Option.getOrUndefined),
		),
		timeoutMs: Options.integer("timeout").pipe(
			Options.withDescription("Milliseconds to wait for an adapter answer."),
			Options.withSchema(PositiveMilliseconds),
			Options.withDefault(DEFAULT_TIMEOUT_MS),
		),
	},
	handler(runRun),
).pipe(Command.withDescription("Run the kit against a binding and write a conformance report."));

const coverage = Command.make("coverage", { kit: kitOption, repoRoot: repoRootOption }, handler(runCoverage)).pipe(
	Command.withDescription("Report every v4 vocabulary entry that no kit case exercises."),
);

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
	Command.withDescription("The Morphir Compatibility Kit driver."),
	Command.withSubcommands([check, run, coverage, kit, packageCommand]),
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

const cli = Command.run(mck, { name: "mck", version: driverVersion() });

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
