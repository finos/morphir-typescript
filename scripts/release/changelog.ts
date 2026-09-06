// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0

import { compareVersions, parseStableVersion, type StableVersion } from "./version.ts";

const REPOSITORY_URL = "https://github.com/finos/morphir-typescript";
const VERSION_TEXT = "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)";
const DATED_RELEASE_TEXT = new RegExp(`^\\[(${VERSION_TEXT})\\] - \\d{4}-\\d{2}-\\d{2}$`);
const RELEASE_LINK_LABEL = new RegExp(`^${VERSION_TEXT}$`);
const HTML_BLOCK_TAG =
	/^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[\t />]|$)/i;

interface SourceRange {
	readonly start: number;
	readonly end: number;
}

interface RootHeading extends SourceRange {
	readonly text: string;
}

interface RootLinkDefinition extends SourceRange {
	readonly label: string;
}

interface RootBlocks {
	readonly headings: RootHeading[];
	readonly links: RootLinkDefinition[];
}

type HtmlBlockEnd = { readonly kind: "blank" } | { readonly kind: "rawTag" } | { readonly kind: "marker"; readonly marker: string };

function htmlBlockStart(line: string): HtmlBlockEnd | undefined {
	const rawTag = /^ {0,3}<(script|pre|style|textarea)(?:[\t >]|$)/i.exec(line);
	if (rawTag !== null) return { kind: "rawTag" };
	if (/^ {0,3}<!--/.test(line)) return { kind: "marker", marker: "-->" };
	if (/^ {0,3}<\?/.test(line)) return { kind: "marker", marker: "?>" };
	if (/^ {0,3}<!\[CDATA\[/.test(line)) return { kind: "marker", marker: "]]>" };
	if (/^ {0,3}<![A-Za-z]/.test(line)) return { kind: "marker", marker: ">" };
	if (HTML_BLOCK_TAG.test(line)) return { kind: "blank" };
	if (/^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:[\t ]+[^<>]*)?\/?>[\t ]*$/.test(line)) return { kind: "blank" };
	return undefined;
}

function htmlBlockEnds(block: HtmlBlockEnd, line: string): boolean {
	if (block.kind === "blank") return line.trim().length === 0;
	if (block.kind === "rawTag") return /<\/(?:script|pre|style|textarea)>/i.test(line);
	return line.includes(block.marker);
}

function scanRootBlocks(markdown: string): RootBlocks {
	const headings: RootHeading[] = [];
	const links: RootLinkDefinition[] = [];
	let fence: { marker: "`" | "~"; length: number } | undefined;
	let htmlBlock: HtmlBlockEnd | undefined;
	let start = 0;
	while (start < markdown.length) {
		const newline = markdown.indexOf("\n", start);
		const sourceEnd = newline === -1 ? markdown.length : newline + 1;
		let contentEnd = newline === -1 ? markdown.length : newline;
		if (contentEnd > start && markdown.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1;
		const line = markdown.slice(start, contentEnd);

		if (fence !== undefined) {
			const closing = /^ {0,3}(`{3,}|~{3,})[\t ]*$/.exec(line);
			if (closing !== null && closing[1]?.[0] === fence.marker && closing[1].length >= fence.length) fence = undefined;
		} else if (htmlBlock !== undefined) {
			if (htmlBlockEnds(htmlBlock, line)) htmlBlock = undefined;
		} else {
			const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
			if (opening !== null && !(opening[1]?.startsWith("`") && opening[2]?.includes("`"))) {
				const marker = opening[1]?.[0];
				if (marker === "`" || marker === "~") fence = { marker, length: opening[1]?.length ?? 3 };
			} else {
				const startedHtmlBlock = htmlBlockStart(line);
				if (startedHtmlBlock !== undefined) {
					if (!htmlBlockEnds(startedHtmlBlock, line)) htmlBlock = startedHtmlBlock;
				} else {
					const heading = /^## (.*)$/.exec(line);
					if (heading !== null) headings.push({ start, end: contentEnd, text: heading[1] ?? "" });
					const link = /^ {0,3}\[([^\]]+)\]:[\t ]*\S.*$/.exec(line);
					if (link !== null) links.push({ start, end: sourceEnd, label: link[1] as string });
				}
			}
		}

		start = sourceEnd;
	}
	return { headings, links };
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

function releaseVersion(heading: RootHeading): StableVersion | undefined {
	const match = DATED_RELEASE_TEXT.exec(heading.text);
	return match === null ? undefined : parseStableVersion(match[1] as string);
}

export function prepareChangelog(markdown: string, version: StableVersion, date: string): string {
	if (!isIsoDate(date)) throw new Error(`invalid release date: ${date}`);
	const blocks = scanRootBlocks(markdown);
	const releases = blocks.headings.flatMap((heading) => {
		const release = releaseVersion(heading);
		return release === undefined ? [] : [release];
	});
	const undatedTarget = `[${version.text}]`;
	if (
		blocks.headings.some((heading) => {
			const release = releaseVersion(heading);
			return heading.text === undatedTarget || (release !== undefined && compareVersions(release, version) === 0);
		})
	)
		throw new Error(`changelog already contains release ${version.text}`);

	const unreleasedIndex = blocks.headings.findIndex((heading) => heading.text === "[Unreleased]");
	if (unreleasedIndex === -1) throw new Error("changelog is missing ## [Unreleased]");
	const unreleased = blocks.headings[unreleasedIndex] as RootHeading;
	const bodyStart = unreleased.end;
	const bodyEnd = blocks.headings[unreleasedIndex + 1]?.start ?? markdown.length;
	const body = markdown.slice(bodyStart, bodyEnd);
	if (!hasTopLevelUnorderedListItem(body)) throw new Error("Unreleased section has no top-level unordered list items");

	const comparisonLinks = blocks.links.filter((link) => link.label === "Unreleased" || RELEASE_LINK_LABEL.test(link.label));
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
	const blocks = scanRootBlocks(markdown);
	const targetIndex = blocks.headings.findIndex((heading) => releaseVersion(heading)?.text === version.text);
	if (targetIndex === -1) {
		if (blocks.headings.some((heading) => heading.text === `[${version.text}]`)) throw new Error(`release ${version.text} is not dated`);
		throw new Error(`release ${version.text} not found in changelog`);
	}
	const target = blocks.headings[targetIndex] as RootHeading;
	const bodyStart = target.end;
	const bodyEnd = blocks.headings[targetIndex + 1]?.start ?? markdown.length;
	const removalRanges = blocks.links.filter((link) => link.start >= bodyStart && link.end <= bodyEnd).map((link) => includeFollowingBlankLine(markdown, link));
	const body = removeSurroundingBlankLines(sliceWithoutRanges(markdown, bodyStart, bodyEnd, removalRanges));
	if (body.trim().length === 0) throw new Error(`release ${version.text} is empty`);
	return `${body}\n`;
}
