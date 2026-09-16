// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { isDeepStrictEqual } from "node:util";
import { readNodeChecked } from "../../../ir/src/versions/v4/index.ts";
import type { PackageLibrary, PackageRequest } from "./contract.ts";
import { object, strictJson, string } from "./json.ts";
import { canonicalizePackageDocument, normalizedPackageDigests, packageFileDigest } from "./metadata.ts";
import { compilePackageSchemas } from "./schemas.ts";

function compareStable(left: string, right: string): number {
	const a = left.split(".").map(BigInt);
	const b = right.split(".").map(BigInt);
	if (a.length !== 3 || b.length !== 3) throw new Error("expected stable version");
	for (let i = 0; i < 3; i++) {
		if ((a[i] as bigint) < (b[i] as bigint)) return -1;
		if ((a[i] as bigint) > (b[i] as bigint)) return 1;
	}
	return 0;
}
function keysEqual(a: object, b: object): boolean {
	return isDeepStrictEqual(Object.keys(a).sort(), Object.keys(b).sort());
}
function requireValid(condition: boolean): asserts condition {
	if (!condition) throw new Error("inconsistent Library set");
}

function verifyPayload(library: PackageLibrary, manifest: Record<string, unknown>): void {
	const content = object(manifest.content);
	const files = new Map(library.files.map((file) => [file.path, Buffer.from(file.hex, "hex")]));
	requireValid(files.size === library.files.length && keysEqual(content, Object.fromEntries(files)));
	for (const [name, digest] of Object.entries(content)) {
		const bytes = files.get(name);
		requireValid(bytes !== undefined && packageFileDigest(bytes) === digest);
	}
	const ir = object(manifest.ir);
	const payload = object(ir.payload);
	const bytes = files.get(string(payload.path));
	requireValid(bytes !== undefined);
	const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	const parsed = readNodeChecked("IRFile", text);
	requireValid(parsed.ok && parsed.value.warnings.length === 0);
	const distribution = object(object(strictJson(text)).distribution);
	const model = object(distribution.Library);
	requireValid(model.packageName === ir.packageName && keysEqual(object(model.dependencies), object(manifest.dependencies)));
	const modules = object(object(model.def).modules);
	for (const target of Object.values(object(manifest.exports)))
		requireValid(Object.hasOwn(modules, string(target)) && Object.hasOwn(object(modules[string(target)]), "Public"));
}

/** Checks a supplied closed Library set, not resolution, trust, or API compatibility. */
export function verifyLibrarySet(request: Extract<PackageRequest, { op: "verify-library-set" }>): boolean {
	// Compile outside rejection handling: a broken schema is never a valid negative case.
	const validators = compilePackageSchemas(request.schemas);
	try {
		canonicalizePackageDocument(request.lock);
		const lock = object(strictJson(request.lock));
		requireValid(validators.lock(lock) === true);
		const nodes = object(lock.nodes);
		requireValid(Object.hasOwn(nodes, string(lock.root)) && Object.keys(nodes).length === request.libraries.length);
		const manifests = request.libraries.map((library) => {
			canonicalizePackageDocument(library.manifest);
			const manifest = object(strictJson(library.manifest));
			requireValid(validators.manifest(manifest) === true);
			verifyPayload(library, manifest);
			return { manifest, digests: normalizedPackageDigests(library.manifest) };
		});
		const selected = new Set<number>();
		for (const nodeValue of Object.values(nodes)) {
			const node = object(nodeValue);
			const release = object(node.release);
			const matches = manifests
				.map((entry, index) => ({ ...entry, index }))
				.filter(({ manifest }) => manifest.packagePath === release.packagePath && manifest.version === release.version);
			requireValid(matches.length === 1);
			const match = matches[0];
			requireValid(match !== undefined && !selected.has(match.index));
			selected.add(match.index);
			const { manifest, digests } = match;
			requireValid(
				node.irPackageName === object(manifest.ir).packageName &&
					node.manifestDigest === digests.manifestDigest &&
					node.contentDigest === digests.packageContentDigest,
			);
			const dependencies = object(manifest.dependencies);
			const bindings = object(node.bindings);
			requireValid(keysEqual(dependencies, bindings));
			for (const [name, value] of Object.entries(dependencies)) {
				const requirement = object(value);
				const range = object(requirement.versionRange);
				const targetId = string(bindings[name]);
				requireValid(Object.hasOwn(nodes, targetId));
				const target = object(nodes[targetId]);
				const targetRelease = object(target.release);
				requireValid(target.irPackageName === name && targetRelease.packagePath === requirement.packagePath);
				const minimum = string(range.minimumInclusive);
				const maximum = string(range.maximumExclusive);
				const version = string(targetRelease.version);
				requireValid(compareStable(minimum, maximum) < 0 && compareStable(version, minimum) >= 0 && compareStable(version, maximum) < 0);
			}
		}
		return true;
	} catch {
		return false;
	}
}
