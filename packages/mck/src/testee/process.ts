// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// A Testee over a child process speaking JSON lines (S5.3). One request in
// flight at a time; ids increase by one; any deviation is a ProtocolError,
// after which the driver stops talking to this adapter.
import { type ChildProcess, spawn } from "node:child_process";
import { readLines } from "../lines.ts";
import { ProtocolError, parseCapabilities, parseDecodeResponse, parseEnvelope, parseWriteTreeResponse } from "./protocol.ts";
import type { DecodeRequest, DecodeResponse, ReadTreeRequest, Request, Testee, WriteTreeRequest, WriteTreeResponse } from "./testee.ts";

const STDERR_LIMIT = 4096;
// How long, after the child's "exit" event wins the race against reading its
// next line, to keep listening for a line that was already written to
// stdout before the process exited. Node/Bun deliver "exit" and a pipe's
// final "data" in either order, so a conforming adapter that answers and
// then exits promptly must not be reported as having failed to answer.
const EXIT_GRACE_MS = 1000;
// How long close() waits for the child to exit on its own (after writing
// "exit" and closing stdin) before it gives up and kills the process.
const CLOSE_GRACE_MS = 5000;

export interface ProcessOptions {
	readonly timeoutMs: number;
	/** Test-only hook: called once with the child's exit code (or null on a signal) when it exits. */
	readonly onExit?: (code: number | null) => void;
}

type NextLine = IteratorResult<string>;

export function processTestee(command: readonly string[], options: ProcessOptions): Testee {
	const [exe, ...args] = command;
	if (exe === undefined) throw new ProtocolError("adapter command is empty");
	const child: ChildProcess = spawn(exe, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
	// Without a listener, a failed spawn (e.g. the executable does not exist)
	// is an unhandled "error" event; Node/Bun then also logs it as a
	// diagnostic on top of whatever ProtocolError the stream failure below
	// produces. Capturing it here keeps that one failure to the single,
	// readable message this Testee reports.
	let spawnError: Error | null = null;
	child.on("error", (err) => {
		spawnError = err;
	});
	// Likewise for stdin: writing to (or ending) a pipe whose reader already
	// died raises EPIPE/ERR_STREAM_DESTROYED asynchronously; without a
	// listener that is an uncaught exception rather than something this
	// Testee can turn into a ProtocolError.
	let stdinError: Error | null = null;
	child.stdin?.on("error", (err) => {
		stdinError = err;
	});
	function writeStdin(text: string): void {
		try {
			child.stdin?.write(text);
		} catch (err) {
			stdinError = err instanceof Error ? err : new Error(String(err));
		}
	}
	let stderr = "";
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (chunk: string) => {
		if (stderr.length < STDERR_LIMIT) stderr = (stderr + chunk).slice(0, STDERR_LIMIT);
	});
	let exit: { code: number | null; signal: string | null } | null = null;
	const exited = new Promise<void>((resolve) => {
		child.on("exit", (code, signal) => {
			exit = { code, signal };
			options.onExit?.(code);
			resolve();
		});
	});
	const lines = readLines(child.stdout as NodeJS.ReadableStream)[Symbol.asyncIterator]();
	let nextId = 1;
	let broken: ProtocolError | null = null;

	function exitMessage(): string {
		return exit === null ? "adapter closed stdout" : `adapter exited with code ${exit.code ?? exit.signal}${stderr ? `; stderr: ${stderr}` : ""}`;
	}

	async function exchange(body: Request): Promise<unknown> {
		if (broken !== null) throw broken;
		if (spawnError !== null) {
			broken = new ProtocolError(`failed to start adapter: ${spawnError.message}`);
			throw broken;
		}
		const id = nextId++;
		writeStdin(`${JSON.stringify({ id, ...body })}\n`);
		const stdinFailure: Error | null = stdinError;
		if (stdinFailure !== null) {
			broken = new ProtocolError(`adapter stdin closed: ${stdinFailure.message}`);
			throw broken;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<"timeout">((resolve) => {
			timer = setTimeout(() => resolve("timeout"), options.timeoutMs);
		});
		const lineDone = lines.next();
		// Every path below that gives up on `lineDone` abandons a promise that is
		// still pending: the read outlives this exchange and can still reject
		// later (close() kills the child, and a destroyed stdout rejects the
		// pending read). Nothing awaits it by then, so without a catch that
		// rejection surfaces as an unhandled rejection and can fail an unrelated
		// test or crash the driver. Attaching a no-op catch marks it handled
		// without changing what this exchange reports.
		const abandonLineRead = (): void => {
			void lineDone.catch(() => {});
		};
		const exitDone = exited.then(() => "exit" as const);
		try {
			const first = await Promise.race([lineDone, exitDone, timeout]);
			if (first === "timeout") {
				abandonLineRead();
				throw new ProtocolError(`adapter timed out after ${options.timeoutMs} ms waiting for id ${id}`);
			}
			let next: NextLine;
			if (first === "exit") {
				// The child's "exit" event arrived before we saw its next stdout
				// line. That does not yet mean it failed to answer: give the same
				// `lineDone` read (not a fresh one — the iterator can only be
				// advanced once per call) a bounded further moment in case the
				// answer was already in flight when the process exited.
				let graceTimer: ReturnType<typeof setTimeout> | undefined;
				const grace = new Promise<"grace-timeout">((resolve) => {
					graceTimer = setTimeout(() => resolve("grace-timeout"), EXIT_GRACE_MS);
				});
				try {
					const raced = await Promise.race([lineDone, grace]);
					if (raced === "grace-timeout") {
						abandonLineRead();
						throw new ProtocolError(exitMessage());
					}
					next = raced;
				} finally {
					clearTimeout(graceTimer);
				}
			} else {
				next = first;
			}
			if (next.done) {
				// The stream can end slightly before the child's own "exit" event is
				// delivered (observed on Windows); give that event a bounded moment
				// to land so the exit code and captured stderr make it into the
				// message instead of racing to the less informative "closed stdout".
				if (exit === null) {
					let doneTimer: ReturnType<typeof setTimeout> | undefined;
					try {
						await Promise.race([
							exited,
							new Promise<void>((resolve) => {
								doneTimer = setTimeout(resolve, EXIT_GRACE_MS);
							}),
						]);
					} finally {
						clearTimeout(doneTimer);
					}
				}
				throw new ProtocolError(exitMessage());
			}
			const env = parseEnvelope(next.value);
			if (env.id !== id) throw new ProtocolError(`expected id ${id}, got ${env.id}`);
			return env.body;
		} catch (error) {
			broken = error instanceof ProtocolError ? error : new ProtocolError(String(error));
			throw broken;
		} finally {
			clearTimeout(timer);
		}
	}

	return {
		capabilities: async () => parseCapabilities(await exchange({ op: "capabilities" })),
		decode: async (req: DecodeRequest): Promise<DecodeResponse> => parseDecodeResponse(await exchange(req)),
		readTree: async (req: ReadTreeRequest): Promise<DecodeResponse> => parseDecodeResponse(await exchange(req)),
		writeTree: async (req: WriteTreeRequest): Promise<WriteTreeResponse> => parseWriteTreeResponse(await exchange(req)),
		close: async () => {
			if (broken === null && exit === null) writeStdin(`${JSON.stringify({ id: nextId++, op: "exit" })}\n`);
			try {
				child.stdin?.end();
			} catch {
				// The child may already be gone; child.stdin's own "error" listener
				// (above) has already absorbed the async form of this failure.
			}
			let closeTimer: ReturnType<typeof setTimeout> | undefined;
			const closeTimeout = new Promise<void>((resolve) => {
				closeTimer = setTimeout(resolve, CLOSE_GRACE_MS);
			});
			try {
				await Promise.race([exited, closeTimeout]);
			} finally {
				clearTimeout(closeTimer);
			}
			if (exit === null) child.kill();
		},
	};
}
