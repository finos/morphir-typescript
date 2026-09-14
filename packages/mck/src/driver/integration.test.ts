// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Proves the adapter protocol end to end: running the embedded kit through
// processTestee(["bun", adapter.ts]) must produce the same report as running
// it in-process, once the two fields that legitimately differ between runs
// (durationMs, startedAt) are stripped.
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { embeddedKitFiles } from "../kit/embedded-source.ts";
import { loadKitFromFiles } from "../kit/load.ts";
import type { Report, ReportRecord } from "../report.ts";
import { inProcessTestee } from "../testee/in-process.ts";
import { processTestee } from "../testee/process.ts";
import { runKit } from "./run.ts";
import { driverVersion, kitVersion } from "./version.ts";

const adapter = path.join(import.meta.dir, "..", "adapter.ts");

function strip(report: Report): unknown {
	const { startedAt, records, ...rest } = report;
	return { ...rest, records: records.map(({ durationMs, ...r }: ReportRecord) => r) };
}

describe("adapter integration", () => {
	test("the process testee over mck-adapter-typescript agrees with the in-process testee", async () => {
		const kit = await loadKitFromFiles(embeddedKitFiles());
		const options = { strict: false, driverVersion: driverVersion(), kitVersion: kitVersion(null) };

		const inProcess = await runKit(kit, inProcessTestee(), options);

		const adapterTestee = processTestee(["bun", adapter], { timeoutMs: 30000 });
		let viaAdapter: Report;
		try {
			viaAdapter = await runKit(kit, adapterTestee, options);
		} finally {
			await adapterTestee.close();
		}

		expect(strip(viaAdapter)).toEqual(strip(inProcess));
		expect(inProcess.binding).toBe("morphir-typescript");
		expect(viaAdapter.binding).toBe("morphir-typescript");
		expect(inProcess.records.length).toBeGreaterThan(300);
		expect(viaAdapter.records.length).toBeGreaterThan(300);
	}, 30000);
});
