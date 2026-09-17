// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { array, object, string } from "../json.ts";
import { maxima } from "./result-semantics.ts";
import { canonical, equal, records, sorted, tree, unique } from "./validation.ts";

export function validateScenario(entry: Record<string, unknown>, documents: ReadonlyMap<string, unknown>, bytesById: ReadonlyMap<string, Uint8Array>): void {
	const setup = object(entry.setup);
	const actors = records(setup.actors);
	const registries = records(setup.registries);
	const operations = records(entry.operations);
	for (const [values, label] of [
		[actors, "actor"],
		[registries, "registry"],
		[operations, "operation"],
	] as const)
		unique(
			values.map((value) => value.id),
			`${label} ID`,
		);
	const actorIds = actors.map((actor) => string(actor.id));
	const registryIds = registries.map((registry) => string(registry.id));
	const byOperation = new Map(operations.map((operation) => [string(operation.id), operation]));
	const known = (id: unknown, ids: readonly string[], label: string): void => {
		if (!ids.includes(string(id))) throw new Error(`unknown ${label} ${String(id)}`);
	};
	const root = (value: unknown): void => {
		const item = object(value);
		known(item.owner, ["registry", "publisher"].includes(string(item.kind)) ? registryIds : actorIds, "root owner");
	};
	const bytes = (value: unknown): Uint8Array | undefined => {
		const item = object(value);
		return item.kind === "hex" ? Buffer.from(string(item.value), "hex") : bytesById.get(string(item.asset));
	};
	const expected = (operation: Record<string, unknown>): Record<string, unknown> | undefined => {
		const item = object(operation.expected);
		const value = item.kind === "inline" ? item.result : item.kind === "asset" ? documents.get(string(item.asset)) : undefined;
		return value === undefined ? undefined : object(value);
	};
	const aliases = new Map<string, readonly string[]>();
	const knownAlias = (id: unknown, actor: unknown): void => {
		const configured = aliases.get(string(actor));
		// A pending configuration carries no authority to infer alias membership.
		if (configured) known(id, configured, "actor registry alias");
	};
	for (const actor of actors) {
		const configuration = documents.get(string(object(actor.configuration).asset));
		if (configuration !== undefined) {
			const bindings = records(object(configuration).bindings);
			aliases.set(
				string(actor.id),
				bindings.map((binding) => string(binding.alias)),
			);
			for (const binding of bindings) known(binding.registryRoot, registryIds, "configuration registry root");
		}
	}
	for (const operation of operations) {
		known(operation.actor, actorIds, "actor");
		const limits = records(operation.limits);
		unique(
			limits.map((limit) => limit.resource),
			"resource limit",
		);
		for (const limit of limits)
			if (maxima[string(limit.resource)] === undefined || BigInt(string(limit.maximum)) > (maxima[string(limit.resource)] as bigint))
				throw new Error("caller limit exceeds profile maximum");
		const input = object(operation.input);
		if (input.registry !== undefined) knownAlias(input.registry, operation.actor);
		if (input.registries !== undefined) {
			unique(array(input.registries), "invocation registry");
			for (const id of array(input.registries)) knownAlias(id, operation.actor);
		}
	}
	const policies = records(object(entry.observe).policies);
	unique(
		policies.map((policy) => policy.actor),
		"observation policy actor",
	);
	equal(policies.map((policy) => string(policy.actor)).sort(), [...actorIds].sort(), "complete observation policies");
	const states = new Map<string, "running" | "joined" | "terminated">();
	const barriers = new Map<string, { operation: string; state: "declared" | "held" | "released" | "terminated"; fault: boolean }>();
	for (const action of records(entry.actions)) {
		if (action.actor !== undefined) {
			known(action.actor, actorIds, "action actor");
			if (
				action.kind === "restart-client" &&
				operations.some((operation) => operation.actor === action.actor && states.get(string(operation.id)) === "running")
			)
				throw new Error("cannot restart a client with a running operation");
		}
		if (action.registry !== undefined) known(action.registry, registryIds, "action registry");
		if (action.kind === "filesystem") {
			const change = object(action.change);
			if (change.root !== undefined) root(change.root);
			if (change.actor !== undefined) known(change.actor, actorIds, "mutation actor");
		}
		if (action.kind === "start") {
			const id = string(action.operation);
			if (!byOperation.has(id) || states.has(id)) throw new Error(`invalid operation start ${id}`);
			states.set(id, "running");
			for (const checkpoint of records(action.barriers)) {
				equal(checkpoint.operation, id, "barrier operation");
				const operation = byOperation.get(id) as Record<string, unknown>;
				const subject = object(checkpoint.subject);
				if (subject.registry !== undefined) knownAlias(subject.registry, operation.actor);
				if (
					["source-inventory", "source-file-copy", "source-recheck", "staged-verification", "cache-promotion", "bundle-ready"].includes(
						string(checkpoint.step),
					) &&
					subject.kind !== "object"
				)
					throw new Error("bundle checkpoint requires object subject");
				if (
					[
						"writer-lock",
						"predecessor-check",
						"version-reservation",
						"bundle-install",
						"record-install",
						"statement-install",
						"targets-install",
						"snapshot-install",
						"retained-timestamp-install",
						"timestamp-replace",
						"timestamp-directory-flush",
					].includes(string(checkpoint.step)) &&
					operation.name !== "publish-library"
				)
					throw new Error("publication checkpoint on nonpublication operation");
				const key = canonical(checkpoint);
				if (barriers.has(key)) throw new Error("duplicate checkpoint declaration");
				barriers.set(key, { operation: id, state: "declared", fault: false });
			}
		} else if (action.kind === "join") {
			const id = string(action.operation);
			if (
				states.get(id) !== "running" ||
				object((byOperation.get(id) as Record<string, unknown>).expected).kind === "terminated" ||
				[...barriers.values()].some((barrier) => barrier.operation === id && barrier.state !== "released")
			)
				throw new Error(`invalid operation join ${id}`);
			states.set(id, "joined");
		} else if (action.checkpoint !== undefined) {
			const checkpoint = object(action.checkpoint);
			const barrier = barriers.get(canonical(checkpoint));
			const id = string(checkpoint.operation);
			if (!barrier || states.get(id) !== "running") throw new Error("unknown or inactive checkpoint");
			if (action.kind === "await") {
				if (barrier.state !== "declared" || [...barriers.values()].some((other) => other.operation === id && other.state === "held"))
					throw new Error("checkpoint cannot be reached twice or while another is held");
				barrier.state = "held";
			} else {
				if (barrier.state !== "held") throw new Error("checkpoint action requires held barrier");
				if (action.kind === "inject-fault") {
					if (checkpoint.boundary !== "before" || barrier.fault) throw new Error("fault must be injected once before the step");
					barrier.fault = true;
				}
				if (action.kind === "release") barrier.state = "released";
				if (action.kind === "terminate") {
					const termination = object((byOperation.get(id) as Record<string, unknown>).expected);
					if (termination.kind !== "terminated") throw new Error("termination requires terminated expectation");
					equal(termination.checkpoint, checkpoint, "termination checkpoint");
					barrier.state = "terminated";
					states.set(id, "terminated");
				}
			}
		}
	}
	if (
		operations.some((operation) => !["joined", "terminated"].includes(states.get(string(operation.id)) ?? "")) ||
		[...barriers.values()].some((barrier) => ["declared", "held"].includes(barrier.state))
	)
		throw new Error("incomplete operation/checkpoint schedule");
	const observation = documents.get(string(object(entry.expectedObservations).asset));
	if (observation === undefined) return;
	const snapshot = object(observation);
	const security = records(snapshot.security);
	equal(
		security.map((item) => item.actor),
		[...actorIds].sort(),
		"complete sorted security actors",
	);
	for (const item of security) {
		equal(item.observedAt, object(entry.observe).at, "observation clock");
		const policy = policies.find((policy) => policy.actor === item.actor) as Record<string, unknown>;
		const observedBytes = bytes(item.policy);
		const expectedBytes = bytes(policy.policy);
		if (observedBytes && expectedBytes) equal(Buffer.from(observedBytes), Buffer.from(expectedBytes), "observation policy bytes");
		if (["lost", "corrupt"].includes(string(item.condition)) && array(item.grants).length) throw new Error("lost/corrupt state cannot report grants");
		const repositories = records(item.repositories);
		sorted(
			repositories.map((repository) => repository.registry),
			"security repositories",
		);
		for (const repository of repositories) {
			knownAlias(repository.registry, item.actor);
		}
		for (const key of ["grants", "revocations"]) {
			const values = records(item[key]);
			const ordering = values.map((value) => [value.registry, object(value.release).packagePath, object(value.release).version].join("\0"));
			sorted(ordering, key, (a, b) => {
				const left = a.split("\0");
				const right = b.split("\0");
				for (let index = 0; index < 2; index++) if (left[index] !== right[index]) return (left[index] as string) < (right[index] as string) ? -1 : 1;
				const x = (left[2] as string).split(".").map(BigInt);
				const y = (right[2] as string).split(".").map(BigInt);
				for (let index = 0; index < 3; index++) if (x[index] !== y[index]) return (x[index] as bigint) < (y[index] as bigint) ? -1 : 1;
				return 0;
			});
			for (const value of values) {
				knownAlias(value.registry, item.actor);
				if (value.keys !== undefined) sorted(array(value.keys), "grant keys");
			}
		}
		for (const grant of records(item.grants))
			if (records(item.revocations).some((revocation) => revocation.registry === grant.registry && isDeepStrictEqual(revocation.release, grant.release)))
				throw new Error("revoked release cannot report eligible grant");
	}
	equal(
		records(snapshot.registries).map((registry) => registry.registry),
		[...registryIds].sort(),
		"complete sorted publisher registries",
	);
	const expectedRoots = [
		...actorIds.flatMap((owner) => [
			{ owner, kind: "cache" },
			{ owner, kind: "destination" },
		]),
		...registryIds.map((owner) => ({ owner, kind: "registry" })),
	].sort((a, b) => (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
	const filesystems = records(snapshot.filesystems);
	equal(
		filesystems.map((filesystem) => filesystem.root),
		expectedRoots,
		"complete sorted filesystem inventories",
	);
	for (const filesystem of filesystems) {
		tree(filesystem);
		sorted(
			records(filesystem.entries).map((file) => file.path),
			"observed paths",
		);
		if (object(filesystem.root).kind === "cache") {
			const entries = records(filesystem.entries);
			for (const item of entries) {
				const path = string(item.path);
				if (!/^bundles(?:\/[a-f0-9]{64}(?:\/.+)?)?$/.test(path) || !["file", "directory"].includes(string(item.kind)))
					throw new Error("invalid cache projection entry");
				if (path === "bundles" || /^bundles\/[a-f0-9]{64}$/.test(path)) {
					if (item.kind !== "directory") throw new Error("cache bundle parent must be a directory");
					if (path !== "bundles" && !entries.some((entry) => entry.path === `${path}/manifest.json` && entry.kind === "file"))
						throw new Error("completed cache bundle requires manifest inventory");
				}
			}
		}
		if (object(filesystem.root).kind === "destination" && array(filesystem.entries).length) throw new Error("unrequested destination output");
	}
	const lockIds = [
		...new Set(
			operations.flatMap((operation) => {
				const lock = object(operation.input).lock;
				return lock !== undefined && object(lock).kind === "asset" ? [string(object(lock).asset)] : [];
			}),
		),
	].sort();
	equal(
		records(snapshot.lockBytes).map((lock) => lock.asset),
		lockIds,
		"complete input lock observations",
	);
	for (const lock of records(snapshot.lockBytes)) {
		const input = bytesById.get(string(lock.asset));
		if (input) equal(lock.sha256, `sha256:${createHash("sha256").update(input).digest("hex")}`, "unchanged input lock digest");
	}
	const results = operations.map((operation) => ({ operation, result: expected(operation) }));
	if (results.every((item) => item.result !== undefined || object(item.operation.expected).kind === "terminated"))
		equal(
			snapshot.readyGraphs,
			results.filter((item) => item.result?.kind === "graph-ready").map((item) => ({ operation: item.operation.id, releases: item.result?.verified })),
			"ready graph observations",
		);
}
