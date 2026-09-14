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

export interface ProcessOptions {
	readonly timeoutMs: number;
}

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
	let stderr = "";
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (chunk: string) => {
		if (stderr.length < STDERR_LIMIT) stderr = (stderr + chunk).slice(0, STDERR_LIMIT);
	});
	let exit: { code: number | null; signal: string | null } | null = null;
	const exited = new Promise<void>((resolve) => {
		child.on("exit", (code, signal) => {
			exit = { code, signal };
			resolve();
		});
	});
	const lines = readLines(child.stdout as NodeJS.ReadableStream)[Symbol.asyncIterator]();
	let nextId = 1;
	let broken: ProtocolError | null = null;

	async function exchange(body: Request): Promise<unknown> {
		if (broken !== null) throw broken;
		if (spawnError !== null) {
			broken = new ProtocolError(`failed to start adapter: ${spawnError.message}`);
			throw broken;
		}
		const id = nextId++;
		child.stdin?.write(`${JSON.stringify({ id, ...body })}\n`);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new ProtocolError(`adapter timed out after ${options.timeoutMs} ms waiting for id ${id}`)), options.timeoutMs);
		});
		try {
			const next = await Promise.race([lines.next(), exited.then(() => ({ done: true as const, value: undefined })), timeout]);
			if (next.done) {
				// stdout can end slightly before the child's own "exit" event is
				// delivered (observed on Windows); give that event a bounded moment
				// to land so the exit code and captured stderr make it into the
				// message instead of racing to the less informative "closed stdout".
				if (exit === null) await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1000))]);
				throw new ProtocolError(
					exit === null ? "adapter closed stdout" : `adapter exited with code ${exit.code ?? exit.signal}${stderr ? `; stderr: ${stderr}` : ""}`,
				);
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
			if (broken === null && exit === null) child.stdin?.write(`${JSON.stringify({ id: nextId++, op: "exit" })}\n`);
			child.stdin?.end();
			await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
			if (exit === null) child.kill();
		},
	};
}
