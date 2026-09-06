// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { compareVersions, parseStableVersion, type StableVersion } from "./version.ts";

const REPOSITORY_URL = "https://github.com/finos/morphir-typescript";
const VERSION_TEXT = "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)";
const DATED_RELEASE_TEXT = new RegExp(`^\\[(${VERSION_TEXT})\\] - \\d{4}-\\d{2}-\\d{2}$`);
const RELEASE_LINK_LABEL = new RegExp(`^${VERSION_TEXT}$`);

interface SourceRange {
	readonly start: number;
	readonly end: number;
}

interface HeadingCandidate extends SourceRange {
	readonly bodyStart: number;
	readonly text: string;
}

interface DefinitionCandidate extends SourceRange {
	readonly label: string;
	readonly labelStart: number;
	readonly labelEnd: number;
	readonly value: string;
}

interface Candidates {
	readonly headings: HeadingCandidate[];
	readonly definitions: DefinitionCandidate[];
}

interface Replacement extends SourceRange {
	readonly value: string;
}

function scanCandidates(markdown: string): Candidates {
	const headings: HeadingCandidate[] = [];
	const definitions: DefinitionCandidate[] = [];
	let start = 0;
	while (start < markdown.length) {
		const newline = markdown.indexOf("\n", start);
		const sourceEnd = newline === -1 ? markdown.length : newline + 1;
		let contentEnd = newline === -1 ? markdown.length : newline;
		if (contentEnd > start && markdown.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1;
		const line = markdown.slice(start, contentEnd);
		const heading = /^## (\[[^\]]+\](?: - \d{4}-\d{2}-\d{2})?)$/.exec(line);
		if (heading !== null) headings.push({ start, end: contentEnd, bodyStart: start + 3, text: heading[1] as string });
		const definition = /^ {0,3}\[([^\]]+)\]:[\t ]*(\S.*)$/.exec(line);
		if (definition !== null) {
			const label = definition[1] as string;
			const labelStart = start + line.indexOf("[") + 1;
			definitions.push({ start, end: sourceEnd, label, labelStart, labelEnd: labelStart + label.length, value: definition[2] as string });
		}
		start = sourceEnd;
	}
	return { headings, definitions };
}

function uniqueMarkerPrefix(markdown: string, stem: string): string {
	let prefix = stem;
	while (markdown.includes(prefix)) prefix += "X";
	return prefix;
}

function replaceRanges(markdown: string, replacements: readonly Replacement[]): string {
	let result = "";
	let cursor = 0;
	for (const replacement of replacements) {
		result += markdown.slice(cursor, replacement.start);
		result += replacement.value;
		cursor = replacement.end;
	}
	return result + markdown.slice(cursor);
}

function actualHeadings(markdown: string, candidates: readonly HeadingCandidate[]): HeadingCandidate[] {
	if (candidates.length === 0) return [];
	const prefix = uniqueMarkerPrefix(markdown, "MORPHIRRELEASEHEADINGMARKER");
	const markers = candidates.map((_, index) => `${prefix}${index}END`);
	const byMarker = new Map(markers.map((marker, index) => [marker, index]));
	const annotated = replaceRanges(
		markdown,
		candidates.map((candidate, index) => ({ start: candidate.bodyStart, end: candidate.end, value: markers[index] as string })),
	);
	const actual = new Set<number>();
	Bun.markdown.render(annotated, {
		heading(children, meta) {
			const index = meta.level === 2 ? byMarker.get(children) : undefined;
			if (index !== undefined) actual.add(index);
			return children;
		},
	});
	return candidates.filter((_, index) => actual.has(index));
}

function actualDefinitions(markdown: string, candidates: readonly DefinitionCandidate[]): DefinitionCandidate[] {
	if (candidates.length === 0) return [];
	const prefix = uniqueMarkerPrefix(markdown, "MORPHIRRELEASEDEFINITIONMARKER");
	const markers = candidates.map((_, index) => `${prefix}${index}END`);
	const probes = candidates.map((_, index) => `${prefix}PROBE${index}END`);
	const byProbe = new Map(probes.map((probe, index) => [probe, index]));
	const annotated = replaceRanges(
		markdown,
		candidates.map((candidate, index) => ({ start: candidate.labelStart, end: candidate.labelEnd, value: markers[index] as string })),
	);
	const resolved = new Set<number>();
	Bun.markdown.render(`${annotated}\n\n${probes.map((probe, index) => `[${probe}][${markers[index]}]`).join("\n")}`, {
		link(children, meta) {
			const index = byProbe.get(children);
			if (index !== undefined && meta.href.length > 0) resolved.add(index);
			return children;
		},
	});
	return candidates.filter((_, index) => resolved.has(index));
}

function tailDefinitions(markdown: string, definitions: readonly DefinitionCandidate[]): DefinitionCandidate[] {
	const tail: DefinitionCandidate[] = [];
	let cursor = markdown.length;
	for (let index = definitions.length - 1; index >= 0; index -= 1) {
		const definition = definitions[index] as DefinitionCandidate;
		if (markdown.slice(definition.end, cursor).trim().length !== 0) break;
		tail.unshift(definition);
		cursor = definition.start;
	}
	return tail;
}

function comparisonDefinitions(markdown: string, candidates: Candidates): DefinitionCandidate[] {
	const definitions = tailDefinitions(markdown, actualDefinitions(markdown, candidates.definitions));
	return definitions.filter((definition) => {
		if (definition.label !== "Unreleased" && !RELEASE_LINK_LABEL.test(definition.label)) return false;
		const destination = definition.value.trim().split(/[\t ]+/, 1)[0];
		return destination?.startsWith(`${REPOSITORY_URL}/`) === true;
	});
}

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

function includeFollowingBlankLine(markdown: string, range: SourceRange): SourceRange {
	if (range.end >= markdown.length) return range;
	const newline = markdown.indexOf("\n", range.end);
	const nextLineEnd = newline === -1 ? markdown.length : newline + 1;
	if (markdown.slice(range.end, nextLineEnd).trim().length !== 0) return range;
	return { start: range.start, end: nextLineEnd };
}

function sliceWithoutRanges(markdown: string, start: number, end: number, ranges: readonly SourceRange[]): string {
	let result = "";
	let cursor = start;
	for (const range of ranges) {
		if (range.end <= start) continue;
		if (range.start >= end) break;
		result += markdown.slice(cursor, range.start);
		cursor = range.end;
	}
	return result + markdown.slice(cursor, end);
}

function releaseVersion(heading: HeadingCandidate): StableVersion | undefined {
	const match = DATED_RELEASE_TEXT.exec(heading.text);
	return match === null ? undefined : parseStableVersion(match[1] as string);
}

export function prepareChangelog(markdown: string, version: StableVersion, date: string): string {
	if (!isIsoDate(date)) throw new Error(`invalid release date: ${date}`);
	const candidates = scanCandidates(markdown);
	const headings = actualHeadings(markdown, candidates.headings);
	const releases = headings.flatMap((heading) => {
		const release = releaseVersion(heading);
		return release === undefined ? [] : [release];
	});
	const undatedTarget = `[${version.text}]`;
	if (
		headings.some((heading) => {
			const release = releaseVersion(heading);
			return heading.text === undatedTarget || (release !== undefined && compareVersions(release, version) === 0);
		})
	)
		throw new Error(`changelog already contains release ${version.text}`);

	const unreleasedIndex = headings.findIndex((heading) => heading.text === "[Unreleased]");
	if (unreleasedIndex === -1) throw new Error("changelog is missing ## [Unreleased]");
	const unreleased = headings[unreleasedIndex] as HeadingCandidate;
	const bodyStart = unreleased.end;
	const bodyEnd = headings[unreleasedIndex + 1]?.start ?? markdown.length;
	const body = markdown.slice(bodyStart, bodyEnd);
	if (!hasTopLevelUnorderedListItem(body)) throw new Error("Unreleased section has no top-level unordered list items");

	const comparisonLinks = comparisonDefinitions(markdown, candidates);
	const removalRanges = comparisonLinks.map((link) => includeFollowingBlankLine(markdown, link));
	const olderLinks = new Map<string, string>();
	for (const link of comparisonLinks) {
		if (link.label !== "Unreleased" && link.label !== version.text && !olderLinks.has(link.label)) {
			olderLinks.set(link.label, markdown.slice(link.start, link.end).replace(/\r?\n$/, ""));
		}
	}
	const prefix = sliceWithoutRanges(markdown, 0, bodyStart, removalRanges);
	const releaseBody = sliceWithoutRanges(markdown, bodyStart, bodyEnd, removalRanges);
	const suffix = sliceWithoutRanges(markdown, bodyEnd, markdown.length, removalRanges);
	const withoutComparisonLinks = `${prefix}\n\n## [${version.text}] - ${date}${releaseBody}${suffix}`;
	const previous = releases.sort(compareVersions).at(-1);
	const targetUrl = previous ? `${REPOSITORY_URL}/compare/v${previous.text}...v${version.text}` : `${REPOSITORY_URL}/releases/tag/v${version.text}`;
	const links = [`[Unreleased]: ${REPOSITORY_URL}/compare/v${version.text}...HEAD`, `[${version.text}]: ${targetUrl}`, ...olderLinks.values()];
	return `${removeTrailingBlankLines(withoutComparisonLinks)}\n\n${links.join("\n")}\n`;
}

export function extractReleaseNotes(markdown: string, version: StableVersion): string {
	const candidates = scanCandidates(markdown);
	const headings = actualHeadings(markdown, candidates.headings);
	const targetIndex = headings.findIndex((heading) => releaseVersion(heading)?.text === version.text);
	if (targetIndex === -1) {
		if (headings.some((heading) => heading.text === `[${version.text}]`)) throw new Error(`release ${version.text} is not dated`);
		throw new Error(`release ${version.text} not found in changelog`);
	}
	const target = headings[targetIndex] as HeadingCandidate;
	const bodyStart = target.end;
	const bodyEnd = headings[targetIndex + 1]?.start ?? markdown.length;
	const removalRanges = comparisonDefinitions(markdown, candidates)
		.filter((definition) => definition.start >= bodyStart && definition.end <= bodyEnd)
		.map((definition) => includeFollowingBlankLine(markdown, definition));
	const body = removeSurroundingBlankLines(sliceWithoutRanges(markdown, bodyStart, bodyEnd, removalRanges));
	if (body.trim().length === 0) throw new Error(`release ${version.text} is empty`);
	return `${body}\n`;
}
