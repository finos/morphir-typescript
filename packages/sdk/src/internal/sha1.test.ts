// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { sha1 } from "./sha1.ts";

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function digest(text: string): string {
	return hex(sha1(new TextEncoder().encode(text)));
}

describe("sha1", () => {
	// RFC 3174, section 7.3.
	test("RFC 3174 TEST1", () => {
		expect(digest("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
	});
	test("RFC 3174 TEST2", () => {
		expect(digest("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1");
	});
	test("RFC 3174 TEST3: one million times 'a'", () => {
		expect(digest("a".repeat(1000000))).toBe("34aa973cd4c4daa4f61eeb2bdbad27316534016f");
	});
	test("RFC 3174 TEST4", () => {
		expect(digest("0123456701234567012345670123456701234567012345670123456701234567".repeat(10))).toBe("dea356a2cddd90c7a7ecedc5ebb563934f460452");
	});
	test("the empty message", () => {
		expect(digest("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
	});
	test("a well-known sentence", () => {
		expect(digest("The quick brown fox jumps over the lazy dog")).toBe("2fd4e1c67a2d28fced849ee1bb76e7391b93eb12");
	});
	test("message lengths around the padding boundaries", () => {
		expect(digest("a".repeat(55))).toBe("c1c8bbdc22796e28c0e15163d20899b65621d65a");
		expect(digest("a".repeat(56))).toBe("c2db330f6083854c99d4b5bfb6e8f29f201be699");
		expect(digest("a".repeat(63))).toBe("03f09f5b158a7a8cdad920bddc29b81c18a551f5");
		expect(digest("a".repeat(64))).toBe("0098ba824b5c16427bd7a1122a5a442a25ec644d");
		expect(digest("a".repeat(65))).toBe("11655326c708d70319be2610e8a57d9a5b959d3b");
	});
	test("the digest has 20 bytes and the input is not changed", () => {
		const input = new Uint8Array([1, 2, 3]);
		expect(sha1(input).length).toBe(20);
		expect(Array.from(input)).toEqual([1, 2, 3]);
	});
});
