// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { installCli, parseReleasePin, releaseTarget } from "./released-cli.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const root = () => {
	const value = mkdtempSync(path.join(tmpdir(), "morphir-cli-test-"));
	roots.push(value);
	mkdirSync(path.join(value, ".dev/bin"), { recursive: true });
	return value;
};
const version = "0.4.0-beta.3";

test("the production pin names the qualified beta.3 archives for all six targets", () => {
	const pin = parseReleasePin(JSON.parse(readFileSync(path.resolve(import.meta.dir, "../../.config/mck-cli.json"), "utf8")));
	expect(pin).toEqual({
		version,
		sha256: {
			"aarch64-apple-darwin": "af1206f8eaadd17b32b8c417f5e52ae53edce844bd10815371ce62fb92e7113c",
			"aarch64-pc-windows-msvc": "d920a63e5433511b9f88e6efb31126f1c91552332d54b2418ba44a7a3aa47c59",
			"aarch64-unknown-linux-gnu": "6f37afcc14a65438dc874626622f93c222afdd4b976b5cc9d5d7c7aebb87cae4",
			"x86_64-apple-darwin": "889a0b9b8bd96409481c95e5521d3d0a17277beac57e129697b5442f559f7ef0",
			"x86_64-pc-windows-msvc": "939d7ad0272dbbadc4d7594a3865816e419f38ef061399b3d4235c236b8cca23",
			"x86_64-unknown-linux-gnu": "f7e2dd500e6a9e812b4df1cc19e4d5fc3c577928b28aff90e6330971f15d0a55",
		},
	});
});

test("maps all six native release targets, including Windows ARM64", () => {
	for (const [os, triple] of [
		["linux", "unknown-linux-gnu"],
		["darwin", "apple-darwin"],
		["win32", "pc-windows-msvc"],
	] as const) {
		for (const [arch, prefix] of [
			["x64", "x86_64"],
			["arm64", "aarch64"],
		] as const) {
			const target = releaseTarget(os, arch);
			expect(target.triple).toBe(`${prefix}-${triple}`);
			expect(target.executable).toBe(os === "win32" ? "morphir.exe" : "morphir");
		}
	}
	expect(() => releaseTarget("freebsd", "x64")).toThrow();
});

test("refuses unsafe versions and incomplete or malformed production pins", () => {
	expect(() => parseReleasePin({ version: "../../bad", sha256: {} })).toThrow();
	expect(() => parseReleasePin({ version, sha256: {} })).toThrow();
	expect(() => parseReleasePin({ version, sha256: { "aarch64-apple-darwin": "not a hash" } })).toThrow();
});

test("verifies and atomically installs tar and Windows zip releases", async () => {
	for (const os of ["linux", "win32"]) {
		const directory = root();
		const target = releaseTarget(os, "arm64");
		const executable = new TextEncoder().encode("native cli bytes");
		const bytes =
			os === "win32"
				? zipSync({ [target.executable]: executable })
				: new Uint8Array(await new Bun.Archive({ morphir: executable }, { compress: "gzip" }).bytes());
		const requested: string[] = [];
		const cli = await installCli({
			root: directory,
			version,
			target,
			sha256: sha256(bytes),
			fetchBytes: async (url) => {
				requested.push(url);
				return bytes;
			},
		});
		expect(readFileSync(cli)).toEqual(Buffer.from(executable));
		expect(requested).toEqual([`https://github.com/finos/morphir/releases/download/v${version}/morphir-${version}-${target.triple}.${target.format}`]);
		expect(readdirSync(path.join(directory, ".dev/bin")).some((name) => name.includes(".download-"))).toBe(false);
		const cached = await installCli({
			root: directory,
			version,
			target,
			sha256: sha256(bytes),
			fetchBytes: async () => {
				throw new Error("cache must not fetch");
			},
		});
		expect(cached).toBe(cli);
		writeFileSync(cli, "corrupt cache");
		await expect(installCli({ root: directory, version, target, sha256: sha256(bytes) })).rejects.toThrow(/cache/);
	}
});

test("checksum mismatch and interrupted fetch never publish a cached CLI", async () => {
	for (const fetchBytes of [
		async () => new Uint8Array([1]),
		async () => {
			throw new Error("interrupted");
		},
	]) {
		const directory = root();
		await expect(installCli({ root: directory, version, sha256: "a".repeat(64), fetchBytes })).rejects.toThrow();
		expect(readdirSync(path.join(directory, ".dev/bin"))).toEqual([]);
	}
});

test("rejects an archive containing anything besides the CLI", async () => {
	const directory = root();
	const bytes = new Uint8Array(await new Bun.Archive({ morphir: "cli", unexpected: "extra" }, { compress: "gzip" }).bytes());
	const target = releaseTarget("linux", "x64");
	await expect(installCli({ root: directory, version, target, sha256: sha256(bytes), fetchBytes: async () => bytes })).rejects.toThrow("only its executable");
	expect(readdirSync(path.join(directory, ".dev/bin"))).toEqual([]);
});

test("a changed production pin cannot reuse a previously installed CLI", async () => {
	const directory = root();
	const target = releaseTarget("linux", "x64");
	const bytes = new Uint8Array(await new Bun.Archive({ morphir: "cli" }, { compress: "gzip" }).bytes());
	await installCli({ root: directory, version, target, sha256: sha256(bytes), fetchBytes: async () => bytes });
	await expect(
		installCli({
			root: directory,
			version,
			target,
			sha256: "b".repeat(64),
			fetchBytes: async () => {
				throw new Error("must not fetch");
			},
		}),
	).rejects.toThrow("cache");
});
