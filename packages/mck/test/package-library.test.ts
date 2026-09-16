// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import type { PackageRequest } from "../src/package/contract.ts";
import { normalizedPackageDigests, packageFileDigest } from "../src/package/metadata.ts";
import { referencePackageTestee } from "../src/package/reference.ts";

type LibraryRequest = Extract<PackageRequest, { op: "verify-library-set" }>;

// Unit fixtures use consistent hashes to reach the semantic check under test.
// Fixed normalization/digest expectations live in the parent corpus, not here.
function libraryRequest(minimum = "1.0.0", maximum = "2.0.0", selected = "1.2.0", exported = "decision", visibility = "Public"): LibraryRequest {
	const libraries = ["provider", "consumer"].map((name) => {
		const dependencies = name === "consumer" ? { "sample/provider": { modules: {} } } : {};
		const ir = JSON.stringify({
			formatVersion: 4,
			distribution: { Library: { packageName: `sample/${name}`, dependencies, def: { modules: { decision: { [visibility]: { types: {}, values: {} } } } } } },
		});
		const manifest = JSON.stringify({
			formatVersion: "0.1.0-draft.1",
			kind: "Library",
			packagePath: `example.com/${name}`,
			version: name === "provider" ? selected : "1.0.0",
			ir: { packageName: `sample/${name}`, formatVersion: "4", payload: { path: "ir.json", mediaType: "application/json", profile: "classic" } },
			content: { "ir.json": packageFileDigest(Buffer.from(ir)) },
			exports: { decision: exported },
			dependencies:
				name === "consumer"
					? { "sample/provider": { packagePath: "example.com/provider", versionRange: { minimumInclusive: minimum, maximumExclusive: maximum } } }
					: {},
		});
		return { manifest, files: [{ path: "ir.json", hex: Buffer.from(ir).toString("hex") }] };
	});
	const nodes = Object.fromEntries(
		libraries.map((library, i) => {
			const manifest = JSON.parse(library.manifest);
			const digests = normalizedPackageDigests(library.manifest);
			return [
				`n${i}`,
				{
					release: { packagePath: manifest.packagePath, version: manifest.version },
					irPackageName: manifest.ir.packageName,
					manifestDigest: digests.manifestDigest,
					contentDigest: digests.packageContentDigest,
					bindings: i === 0 ? {} : { "sample/provider": "n0" },
				},
			];
		}),
	);
	return {
		op: "verify-library-set",
		lock: JSON.stringify({ root: "n1", nodes }),
		libraries,
		schemas: { manifest: { type: "object" }, lock: { type: "object" } },
	};
}

test("closed Library set accepts matching IR, payloads and bindings", async () => {
	expect(await referencePackageTestee().execute(libraryRequest())).toEqual({ ok: true, valid: true });
});
test.each([
	["1.0.0", "2.0.0", "2.0.0"],
	["1.0.0", "2.0.0", "0.9.0"],
	["2.0.0", "1.0.0", "1.2.0"],
	["1.0.0", "1.0.0", "1.0.0"],
])("stable interval rejects %s..%s selecting %s despite matching hashes", async (minimum, maximum, selected) => {
	expect(await referencePackageTestee().execute(libraryRequest(minimum, maximum, selected))).toEqual({ ok: true, valid: false });
});
test("stable versions compare beyond Number precision", async () => {
	expect(await referencePackageTestee().execute(libraryRequest("9007199254740992.0.0", "9007199254740994.0.0", "9007199254740993.0.0"))).toEqual({
		ok: true,
		valid: true,
	});
});
test("exports must name existing public modules", async () => {
	expect(await referencePackageTestee().execute(libraryRequest("1.0.0", "2.0.0", "1.2.0", "absent"))).toEqual({ ok: true, valid: false });
	expect(await referencePackageTestee().execute(libraryRequest("1.0.0", "2.0.0", "1.2.0", "decision", "Private"))).toEqual({ ok: true, valid: false });
});
test("undeclared and duplicate payload entries fail", async () => {
	const request = libraryRequest();
	const first = request.libraries[0];
	if (!first) throw new Error("missing unit fixture");
	for (const extra of [{ path: "extra.json", hex: "" }, first.files[0]]) {
		if (!extra) throw new Error("missing unit payload");
		expect(
			await referencePackageTestee().execute({ ...request, libraries: [{ ...first, files: [...first.files, extra] }, ...request.libraries.slice(1)] }),
		).toEqual({ ok: true, valid: false });
	}
});
