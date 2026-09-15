// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Splits a readable byte stream into text lines on "\n", stripping a
// trailing "\r" so CRLF and LF inputs both yield the same lines. The final
// chunk before the stream ends is yielded even when it carries no trailing
// newline, so a well-behaved writer that forgets the last "\n" is not
// silently dropped.
export async function* readLines(stream: NodeJS.ReadableStream): AsyncIterable<string> {
	let buffer = "";
	for await (const chunk of stream) {
		buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
		let index = buffer.indexOf("\n");
		while (index !== -1) {
			let line = buffer.slice(0, index);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			yield line;
			buffer = buffer.slice(index + 1);
			index = buffer.indexOf("\n");
		}
	}
	if (buffer.length > 0) yield buffer;
}
