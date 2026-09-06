// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { fromMarkdown } from "mdast-util-from-markdown";
import { compareVersions, parseStableVersion, type StableVersion } from "./version.ts";

const REPOSITORY_URL = "https://github.com/finos/morphir-typescript";
const REPOSITORY_URL_PATTERN = "https://github\\.com/finos/morphir-typescript";
const VERSION_TEXT = "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)";
const KAC_HEADING = new RegExp(`^## (\\[Unreleased\\]|\\[${VERSION_TEXT}\\]|\\[${VERSION_TEXT}\\] - \\d{4}-\\d{2}-\\d{2})$`);
const DATED_RELEASE_TEXT = new RegExp(`^\\[(${VERSION_TEXT})\\] - \\d{4}-\\d{2}-\\d{2}$`);
const RELEASE_LINK_LABEL = new RegExp(`^${VERSION_TEXT}$`);
const UNRELEASED_URL = new RegExp(`^${REPOSITORY_URL_PATTERN}/compare/v${VERSION_TEXT}\\.\\.\\.HEAD$`);
const RELEASE_URL = new RegExp(`^${REPOSITORY_URL_PATTERN}/releases/tag/v(${VERSION_TEXT})$`);
const COMPARE_URL = new RegExp(`^${REPOSITORY_URL_PATTERN}/compare/v${VERSION_TEXT}\\.\\.\\.v(${VERSION_TEXT})$`);

interface SourceRange {
	readonly start: number;
	readonly end: number;
}

interface RootHeading extends SourceRange {
	readonly kacText?: string;
}

interface RootDefinition extends SourceRange {
	readonly label: string;
	readonly url: string;
}

interface ChangelogBlocks {
	readonly headings: RootHeading[];
	readonly definitions: RootDefinition[];
	readonly unorderedLists: SourceRange[];
}

interface PositionedNode {
	readonly position?: {
		readonly start: { readonly offset?: number };
		readonly end: { readonly offset?: number };
	};
}

function sourceRange(node: PositionedNode): SourceRange {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;
	if (start === undefined || end === undefined) throw new Error("Markdown parser did not provide source offsets");
	return { start, end };
}

function sourceRangeWithIndentation(markdown: string, node: PositionedNode): SourceRange {
	const range = sourceRange(node);
	return { ...range, start: markdown.lastIndexOf("\n", range.start - 1) + 1 };
}

function changelogBlocks(markdown: string): ChangelogBlocks {
	const root = fromMarkdown(markdown);
	const headings: RootHeading[] = [];
	const definitions: RootDefinition[] = [];
	const unorderedLists: SourceRange[] = [];
	let trailingDefinitionStart = root.children.length;
	while (root.children[trailingDefinitionStart - 1]?.type === "definition") trailingDefinitionStart -= 1;
	for (const [index, child] of root.children.entries()) {
		if (child.type === "heading" && child.depth === 2) {
			const range = sourceRange(child);
			const match = KAC_HEADING.exec(markdown.slice(range.start, range.end));
			headings.push({ ...range, kacText: match?.[1] });
		} else if (child.type === "list" && child.ordered !== true && child.children.length > 0) {
			unorderedLists.push(sourceRange(child));
		} else if (index >= trailingDefinitionStart && child.type === "definition") {
			const range = sourceRangeWithIndentation(markdown, child);
			definitions.push({ ...range, label: child.label ?? child.identifier, url: child.url });
		}
	}
	return { headings, definitions, unorderedLists };
}

function comparisonDefinition(definition: RootDefinition): boolean {
	if (definition.label === "Unreleased") return UNRELEASED_URL.test(definition.url);
	if (!RELEASE_LINK_LABEL.test(definition.label)) return false;
	const release = RELEASE_URL.exec(definition.url);
	if (release?.[1] === definition.label) return true;
	return COMPARE_URL.exec(definition.url)?.[1] === definition.label;
}

function hasTopLevelUnorderedListItem(blocks: ChangelogBlocks, start: number, end: number): boolean {
	return blocks.unorderedLists.some((list) => list.start >= start && list.end <= end);
}

function isIsoDate(date: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
	const parsed = new Date(`${date}T00:00:00.000Z`);
	return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}

function documentEol(markdown: string): "\n" | "\r\n" {
	const newline = markdown.indexOf("\n");
	return newline > 0 && markdown[newline - 1] === "\r" ? "\r\n" : "\n";
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

function releaseVersion(heading: RootHeading): StableVersion | undefined {
	const match = heading.kacText === undefined ? null : DATED_RELEASE_TEXT.exec(heading.kacText);
	return match === null ? undefined : parseStableVersion(match[1] as string);
}

export function prepareChangelog(markdown: string, version: StableVersion, date: string): string {
	if (!isIsoDate(date)) throw new Error(`invalid release date: ${date}`);
	const eol = documentEol(markdown);
	const blocks = changelogBlocks(markdown);
	const headings = blocks.headings;
	const releases = headings.flatMap((heading) => {
		const release = releaseVersion(heading);
		return release === undefined ? [] : [release];
	});
	const undatedTarget = `[${version.text}]`;
	if (
		headings.some((heading) => {
			const release = releaseVersion(heading);
			return heading.kacText === undatedTarget || (release !== undefined && compareVersions(release, version) === 0);
		})
	)
		throw new Error(`changelog already contains release ${version.text}`);

	const unreleasedIndex = headings.findIndex((heading) => heading.kacText === "[Unreleased]");
	if (unreleasedIndex === -1) throw new Error("changelog is missing ## [Unreleased]");
	const unreleased = headings[unreleasedIndex] as RootHeading;
	const bodyStart = unreleased.end;
	const bodyEnd = headings[unreleasedIndex + 1]?.start ?? markdown.length;
	if (!hasTopLevelUnorderedListItem(blocks, bodyStart, bodyEnd)) throw new Error("Unreleased section has no top-level unordered list items");

	const comparisonLinks = blocks.definitions.filter(comparisonDefinition);
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
	const withoutComparisonLinks = `${prefix}${eol}${eol}## [${version.text}] - ${date}${releaseBody}${suffix}`;
	const previous = releases.sort(compareVersions).at(-1);
	const targetUrl = previous ? `${REPOSITORY_URL}/compare/v${previous.text}...v${version.text}` : `${REPOSITORY_URL}/releases/tag/v${version.text}`;
	const links = [`[Unreleased]: ${REPOSITORY_URL}/compare/v${version.text}...HEAD`, `[${version.text}]: ${targetUrl}`, ...olderLinks.values()];
	return `${removeTrailingBlankLines(withoutComparisonLinks)}${eol}${eol}${links.join(eol)}${eol}`;
}

export function extractReleaseNotes(markdown: string, version: StableVersion): string {
	const eol = documentEol(markdown);
	const blocks = changelogBlocks(markdown);
	const headings = blocks.headings;
	const targetIndex = headings.findIndex((heading) => releaseVersion(heading)?.text === version.text);
	if (targetIndex === -1) {
		if (headings.some((heading) => heading.kacText === `[${version.text}]`)) throw new Error(`release ${version.text} is not dated`);
		throw new Error(`release ${version.text} not found in changelog`);
	}
	const target = headings[targetIndex] as RootHeading;
	const bodyStart = target.end;
	const bodyEnd = headings[targetIndex + 1]?.start ?? markdown.length;
	const removalRanges = blocks.definitions
		.filter(comparisonDefinition)
		.filter((definition) => definition.start >= bodyStart && definition.end <= bodyEnd)
		.map((definition) => includeFollowingBlankLine(markdown, definition));
	const body = removeSurroundingBlankLines(sliceWithoutRanges(markdown, bodyStart, bodyEnd, removalRanges));
	if (body.trim().length === 0) throw new Error(`release ${version.text} is empty`);
	return `${body}${eol}`;
}
