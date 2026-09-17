// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { setSystemTime } from "bun:test";
import { posix } from "node:path";
import { Readable } from "node:stream";
import { TrustedMetadataStore } from "tuf-js/dist/store.js";

const roles = ["root", "timestamp", "snapshot", "targets"] as const;

// Test-only offline verifier. tuf-js is pinned because this internal API is not a public export.
// No fixture-authoring helper participates in verification.
export async function verifyFixtureTuf(files: ReadonlyMap<string, Uint8Array>, at: string): Promise<void> {
	const metadata = Object.fromEntries(roles.map((role) => [role, requiredFile(files, `registry/metadata/1.${role}.json`)])) as Record<
		(typeof roles)[number],
		Buffer
	>;
	checkMorphirProfile(metadata);
	const time = new Date(at);
	if (!Number.isFinite(time.getTime())) throw new Error("Invalid TUF verification time");
	let store: TrustedMetadataStore;
	// The constructor captures its reference time. Never leave the process clock mocked across await.
	setSystemTime(time);
	try {
		store = new TrustedMetadataStore(metadata.root);
	} finally {
		setSystemTime();
	}
	store.updateTimestamp(metadata.timestamp);
	store.updateSnapshot(metadata.snapshot, false);
	store.updateDelegatedTargets(metadata.targets, "targets", "root");
	if (!store.targets) throw new Error("TUF targets were not loaded");
	for (const [logicalPath, target] of Object.entries(store.targets.signed.targets)) {
		const directory = posix.dirname(logicalPath);
		const leaf = `${target.hashes.sha256}.${posix.basename(logicalPath)}`;
		const physicalPath = `registry/targets/${directory === "." ? "" : `${directory}/`}${leaf}`;
		await target.verify(Readable.from([requiredFile(files, physicalPath)]));
	}
}

function requiredFile(files: ReadonlyMap<string, Uint8Array>, path: string): Buffer {
	const value = files.get(path);
	if (!value) throw new Error(`Missing fixture file: ${path}`);
	return Buffer.from(value);
}

function profile(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Unsupported Morphir TUF profile: ${message}`);
}

function object(value: unknown): Record<string, unknown> {
	profile(value !== null && typeof value === "object" && !Array.isArray(value), "expected object");
	return value as Record<string, unknown>;
}

function positiveInteger(value: unknown): boolean {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function checkFileInfo(value: unknown, metadata: boolean): void {
	const info = object(value);
	profile(typeof info.length === "number" && Number.isSafeInteger(info.length) && info.length >= 0, "file length is required");
	const hashes = object(info.hashes);
	profile(typeof hashes.sha256 === "string" && /^[0-9a-f]{64}$/.test(hashes.sha256), "SHA-256 is required");
	if (metadata) profile(positiveInteger(info.version), "metadata link version must be positive");
}

function checkMorphirProfile(metadata: Record<(typeof roles)[number], Buffer>): void {
	const signed = Object.fromEntries(
		roles.map((role) => {
			const value = object(object(JSON.parse(metadata[role].toString("utf8"))).signed);
			profile(value._type === role, `expected ${role} role`);
			profile(value.spec_version === "1.0.36", "spec_version must be 1.0.36");
			profile(positiveInteger(value.version), "metadata version must be positive");
			return [role, value];
		}),
	) as Record<(typeof roles)[number], Record<string, unknown>>;
	profile(signed.root.consistent_snapshot === true, "consistent_snapshot must be true");
	const rootKeys = object(signed.root.keys);
	const rootRoles = object(signed.root.roles);
	const assignedPublicKeys = new Set<string>();
	for (const role of roles) {
		const definition = object(rootRoles[role]);
		profile(positiveInteger(definition.threshold), "role threshold must be positive");
		profile(Array.isArray(definition.keyids) && definition.keyids.length >= Number(definition.threshold), "insufficient role keys");
		for (const keyid of definition.keyids) {
			profile(typeof keyid === "string", "key ID must be a string");
			const key = object(rootKeys[keyid]);
			profile(key.keytype === "ed25519" && key.scheme === "ed25519", "role keys must be Ed25519");
			const publicKey = object(key.keyval).public;
			profile(typeof publicKey === "string" && /^[0-9a-f]{64}$/.test(publicKey), "invalid Ed25519 public key");
			profile(!assignedPublicKeys.has(publicKey), "role keys must be distinct");
			assignedPublicKeys.add(publicKey);
		}
	}
	for (const [role, child] of [
		["timestamp", "snapshot.json"],
		["snapshot", "targets.json"],
	] as const) {
		const meta = object(signed[role].meta);
		profile(Object.keys(meta).length === 1 && Object.hasOwn(meta, child), `${role} must link exactly ${child}`);
		checkFileInfo(meta[child], true);
	}
	for (const [path, info] of Object.entries(object(signed.targets.targets))) {
		profile(
			path.length > 0 && !path.startsWith("/") && !path.includes("\\") && path.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
			"invalid logical target path",
		);
		checkFileInfo(info, false);
	}
}
