// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { verifyFixtureTuf } from "./support/package-signed-fixture-tuf.ts";
import { fixtureKey, signFixtureTuf, tufKeyId, tufPublicKey } from "./support/package-signing.ts";

const roles = ["root", "timestamp", "snapshot", "targets"] as const;
type Role = (typeof roles)[number];
const at = "2026-01-01T00:00:00Z";
const expires = "2027-01-01T00:00:00Z";
const keys = Object.fromEntries(roles.map((role) => [role, fixtureKey(`offline-tuf-test:${role}`)])) as Record<Role, ReturnType<typeof fixtureKey>>;
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const metadataPath = (role: Role) => `registry/metadata/1.${role}.json`;
const targetBytes = Buffer.from("a signed fixture target\n");
const targetPath = `registry/targets/example/${hash(targetBytes)}.release.json`;
const info = (data: Uint8Array) => ({ length: data.byteLength, hashes: { sha256: hash(data) } });
type Edit = (signed: Record<string, unknown>) => void;

function readMetadata(files: ReadonlyMap<string, Uint8Array>, role: Role): Uint8Array {
	const data = files.get(metadataPath(role));
	if (!data) throw new Error(`Test metadata missing: ${role}`);
	return data;
}

// Deliberately independent of the fixture generator: only the signing primitive is shared.
function fixture(edits: Partial<Record<Role, Edit>> = {}) {
	const files = new Map<string, Uint8Array>([[targetPath, targetBytes]]);
	function put(role: Role, fields: object) {
		const signed: Record<string, unknown> = { _type: role, spec_version: "1.0.36", version: 1, expires, ...fields };
		edits[role]?.(signed);
		const data = bytes(signFixtureTuf(signed, keys[role]));
		files.set(metadataPath(role), data);
		return data;
	}
	put("root", {
		consistent_snapshot: true,
		keys: Object.fromEntries(roles.map((role) => [tufKeyId(keys[role]), tufPublicKey(keys[role])])),
		roles: Object.fromEntries(roles.map((role) => [role, { keyids: [tufKeyId(keys[role])], threshold: 1 }])),
	});
	const targets = put("targets", { targets: { "example/release.json": info(targetBytes) } });
	const snapshot = put("snapshot", { meta: { "targets.json": { version: 1, ...info(targets) } } });
	put("timestamp", { meta: { "snapshot.json": { version: 1, ...info(snapshot) } } });
	return files;
}

// Repair parent hash links after mutations so signature checks, not hash checks, reject them.
function relink(files: Map<string, Uint8Array>) {
	for (const [parent, child] of [
		["snapshot", "targets"],
		["timestamp", "snapshot"],
	] as const) {
		const envelope = JSON.parse(Buffer.from(readMetadata(files, parent)).toString());
		envelope.signed.meta[`${child}.json`] = { version: 1, ...info(readMetadata(files, child)) };
		files.set(metadataPath(parent), bytes(signFixtureTuf(envelope.signed, keys[parent])));
	}
}

describe("offline fixture TUF verification", () => {
	test("accepts an independently authored, signed repository and restores the real clock", async () => {
		const before = Date.now();
		const verification = verifyFixtureTuf(fixture(), at);
		expect(Date.now()).toBeGreaterThanOrEqual(before);
		await expect(verification).resolves.toBeUndefined();
	});

	for (const role of roles) {
		for (const corruption of ["missing", "tampered"] as const) {
			test(`rejects ${corruption} ${role} signatures`, async () => {
				const files = fixture();
				const envelope = JSON.parse(Buffer.from(readMetadata(files, role)).toString());
				envelope.signatures = corruption === "missing" ? [] : [{ keyid: tufKeyId(keys[role]), sig: "00".repeat(64) }];
				files.set(metadataPath(role), bytes(envelope));
				if (role === "targets") relink(files);
				if (role === "snapshot") {
					const timestamp = JSON.parse(Buffer.from(readMetadata(files, "timestamp")).toString());
					timestamp.signed.meta["snapshot.json"] = { version: 1, ...info(readMetadata(files, "snapshot")) };
					files.set(metadataPath("timestamp"), bytes(signFixtureTuf(timestamp.signed, keys.timestamp)));
				}
				await expect(verifyFixtureTuf(files, at)).rejects.toThrow(`${role} was signed by 0/1 keys`);
			});
		}
	}

	test("rejects altered snapshot bytes against the timestamp hash", async () => {
		const files = fixture();
		files.set(metadataPath("snapshot"), Buffer.concat([readMetadata(files, "snapshot"), Buffer.from(" ")]));
		await expect(verifyFixtureTuf(files, at)).rejects.toThrow(/length|hash/i);
	});

	test("rejects altered target bytes", async () => {
		const files = fixture();
		files.set(targetPath, Buffer.from("b signed fixture target\n"));
		await expect(verifyFixtureTuf(files, at)).rejects.toThrow(/hash/i);
	});

	test("expires the timestamp at its exact expiration boundary", async () => {
		const files = fixture({
			timestamp: (signed) => {
				signed.expires = at;
			},
		});
		await expect(verifyFixtureTuf(files, "2025-12-31T23:59:59.999Z")).resolves.toBeUndefined();
		await expect(verifyFixtureTuf(files, at)).rejects.toThrow(/timestamp.*expired/i);
	});

	for (const role of ["snapshot", "targets"] as const) {
		test(`rejects signed ${role} version mismatch with valid parent hash links`, async () => {
			const files = fixture({
				[role]: (signed: Record<string, unknown>) => {
					signed.version = 2;
				},
			});
			await expect(verifyFixtureTuf(files, at)).rejects.toThrow(/version/i);
		});
	}

	for (const [name, edits] of [
		[
			"unsupported spec version",
			{
				targets: (signed) => {
					signed.spec_version = "1.0.35";
				},
			},
		],
		[
			"non-consistent snapshots",
			{
				root: (signed) => {
					signed.consistent_snapshot = false;
				},
			},
		],
		[
			"shared role keys",
			{
				root: (signed) => {
					signed.roles = Object.fromEntries(roles.map((role) => [role, { keyids: [tufKeyId(keys.root)], threshold: 1 }]));
				},
			},
		],
		[
			"missing snapshot hash",
			{
				timestamp: (signed) => {
					signed.meta = { "snapshot.json": { version: 1, length: 1 } };
				},
			},
		],
		[
			"additional snapshot entries",
			{
				snapshot: (signed) => {
					signed.meta = { ...(signed.meta as object), "other.json": { version: 1, length: 1, hashes: { sha256: "00".repeat(32) } } };
				},
			},
		],
	] satisfies [string, Partial<Record<Role, Edit>>][]) {
		test(`rejects Morphir profile violation: ${name}`, async () => {
			await expect(verifyFixtureTuf(fixture(edits), at)).rejects.toThrow(/profile/i);
		});
	}
});
