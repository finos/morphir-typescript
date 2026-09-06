// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { compareVersions, parseStableVersion, type StableVersion } from "./version.ts";

const REPOSITORY_URL = "https://github.com/finos/morphir-typescript";
const VERSION_TEXT = "(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)";
const DATED_RELEASE_HEADING = new RegExp(`^## \\[(${VERSION_TEXT})\\] - \\d{4}-\\d{2}-\\d{2}$`, "gm");
const RELEASE_LINK = new RegExp(`^\\[(Unreleased|${VERSION_TEXT})\\]:[^\\r\\n]*(?:\\r?\\n|$)`, "gm");

function hasTopLevelUnorderedListItem(markdown: string): boolean {
	let found = false;
	Bun.markdown.render(markdown, {
		listItem(children, meta) {
			if (meta.depth === 0 && !meta.ordered) found = true;
			return children;
		},
	});
	return found;
}

function isIsoDate(date: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
	const parsed = new Date(`${date}T00:00:00.000Z`);
	return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}

function removeTrailingBlankLines(markdown: string): string {
	return markdown.replace(/(?:\r?\n[\t ]*)+$/, "");
}

function removeSurroundingBlankLines(markdown: string): string {
	return removeTrailingBlankLines(markdown.replace(/^(?:[\t ]*\r?\n)+/, ""));
}

export function prepareChangelog(markdown: string, version: StableVersion, date: string): string {
	if (!isIsoDate(date)) throw new Error(`invalid release date: ${date}`);
	const releases = Array.from(markdown.matchAll(DATED_RELEASE_HEADING), (match) => parseStableVersion(match[1] as string));
	if (releases.some((release) => compareVersions(release, version) === 0)) throw new Error(`changelog already contains release ${version.text}`);
	const heading = /^## \[Unreleased\]$/m.exec(markdown);
	if (heading === null) throw new Error("changelog is missing ## [Unreleased]");
	const bodyStart = heading.index + heading[0].length;
	const rest = markdown.slice(bodyStart);
	const nextHeading = /^## /m.exec(rest);
	const bodyEnd = nextHeading === null ? markdown.length : bodyStart + nextHeading.index;
	const body = markdown.slice(bodyStart, bodyEnd);
	if (!hasTopLevelUnorderedListItem(body)) throw new Error("Unreleased section has no top-level unordered list items");

	const olderLinks = new Map<string, string>();
	const withoutReleaseLinks = `${markdown.slice(0, bodyStart)}\n\n## [${version.text}] - ${date}${body}${markdown.slice(bodyEnd)}`.replace(
		RELEASE_LINK,
		(line, label: string) => {
			if (label !== "Unreleased" && label !== version.text && !olderLinks.has(label)) olderLinks.set(label, line.replace(/\r?\n$/, ""));
			return "";
		},
	);
	const previous = releases.sort(compareVersions).at(-1);
	const targetUrl = previous ? `${REPOSITORY_URL}/compare/v${previous.text}...v${version.text}` : `${REPOSITORY_URL}/releases/tag/v${version.text}`;
	const links = [`[Unreleased]: ${REPOSITORY_URL}/compare/v${version.text}...HEAD`, `[${version.text}]: ${targetUrl}`, ...olderLinks.values()];
	return `${removeTrailingBlankLines(withoutReleaseLinks)}\n\n${links.join("\n")}\n`;
}

export function extractReleaseNotes(markdown: string, version: StableVersion): string {
	const escapedVersion = version.text.replaceAll(".", "\\.");
	const heading = new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m").exec(markdown);
	if (heading === null) {
		if (new RegExp(`^## \\[${escapedVersion}\\]$`, "m").test(markdown)) throw new Error(`release ${version.text} is not dated`);
		throw new Error(`release ${version.text} not found in changelog`);
	}
	const bodyStart = heading.index + heading[0].length;
	const rest = markdown.slice(bodyStart);
	const nextHeading = /^## /m.exec(rest);
	const bodyEnd = nextHeading === null ? markdown.length : bodyStart + nextHeading.index;
	const body = removeSurroundingBlankLines(markdown.slice(bodyStart, bodyEnd).replace(RELEASE_LINK, ""));
	if (body.trim().length === 0) throw new Error(`release ${version.text} is empty`);
	return `${body}\n`;
}
