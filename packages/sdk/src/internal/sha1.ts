// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// SHA-1 (RFC 3174) in synchronous TypeScript, for the version 5 UUIDs of
// Morphir.SDK.UUID. WebCrypto's digest is asynchronous and `node:crypto` is
// not available in all runtimes, thus neither is used. SHA-1 is not safe for
// security functions; do not use this for them.

function rotateLeft(x: number, n: number): number {
	return (x << n) | (x >>> (32 - n));
}

// Returns the 20 bytes of the digest. Messages of 2^53 bits or more are not
// supported.
export function sha1(message: Uint8Array): Uint8Array {
	// Padding: a 1 bit, zeros, then the bit length as 64 bits big-endian, up to
	// a multiple of 64 bytes.
	const paddedLength = (((message.length + 8) >> 6) + 1) << 6;
	const padded = new Uint8Array(paddedLength);
	padded.set(message);
	padded[message.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(paddedLength - 8, Math.floor(message.length / 0x20000000));
	view.setUint32(paddedLength - 4, (message.length << 3) >>> 0);

	let h0 = 0x67452301;
	let h1 = 0xefcdab89;
	let h2 = 0x98badcfe;
	let h3 = 0x10325476;
	let h4 = 0xc3d2e1f0;
	const w = new Int32Array(80);

	for (let block = 0; block < paddedLength; block += 64) {
		for (let t = 0; t < 16; t++) w[t] = view.getInt32(block + t * 4);
		for (let t = 16; t < 80; t++) {
			w[t] = rotateLeft((w[t - 3] ?? 0) ^ (w[t - 8] ?? 0) ^ (w[t - 14] ?? 0) ^ (w[t - 16] ?? 0), 1);
		}
		let a = h0;
		let b = h1;
		let c = h2;
		let d = h3;
		let e = h4;
		for (let t = 0; t < 80; t++) {
			let f: number;
			let k: number;
			if (t < 20) {
				f = (b & c) | (~b & d);
				k = 0x5a827999;
			} else if (t < 40) {
				f = b ^ c ^ d;
				k = 0x6ed9eba1;
			} else if (t < 60) {
				f = (b & c) | (b & d) | (c & d);
				k = 0x8f1bbcdc;
			} else {
				f = b ^ c ^ d;
				k = 0xca62c1d6;
			}
			const temp = (rotateLeft(a, 5) + f + e + k + (w[t] ?? 0)) | 0;
			e = d;
			d = c;
			c = rotateLeft(b, 30);
			b = a;
			a = temp;
		}
		h0 = (h0 + a) | 0;
		h1 = (h1 + b) | 0;
		h2 = (h2 + c) | 0;
		h3 = (h3 + d) | 0;
		h4 = (h4 + e) | 0;
	}

	const digest = new Uint8Array(20);
	const out = new DataView(digest.buffer);
	out.setInt32(0, h0);
	out.setInt32(4, h1);
	out.setInt32(8, h2);
	out.setInt32(12, h3);
	out.setInt32(16, h4);
	return digest;
}
