// The parts of DR's API that we rely on.
//
// Everything we know about DR's data format is read here. Fields we can't do without
// are checked, and something without them is left out or fails with a message naming
// the field. Cosmetic fields (descriptions, dates, lengths, images) are optional, so DR
// dropping one of them degrades a page instead of breaking it.

import {type Json} from "./dr";
import {danishMidnight, parseTime} from "./time";

/** DR's data wasn't what we expected */
export class FormatError extends Error {}

export function text(value: unknown): string | undefined {
	return typeof value == "string" ? value : undefined;
}

export function required(blob: Json, field: string): string {
	const value = blob?.[field];
	if (typeof value == "number") {
		return String(value);
	}
	if (typeof value != "string") {
		throw new FormatError(`Expected ${field} to be text, got ${JSON.stringify(value)?.slice(0, 100)}`);
	}
	return value;
}

/** DR sends true and false as "True" and "False" */
export function flag(value: unknown): boolean {
	return value === true || (typeof value == "string" && ["true", "1", "yes", "on"].includes(value.toLowerCase()));
}

export function integer(value: unknown): number | undefined {
	const n = typeof value == "string" && /^\s*-?\d+\s*$/.test(value) ? Number(value) : value;
	return typeof n == "number" && Number.isInteger(n) ? n : undefined;
}

export function wallpaper(blob: Json): string | undefined {
	return text(blob?.images?.wallpaper);
}

export function geoRestricted(blob: Json): boolean {
	return flag(blob?.customFields?.IsGeoRestricted);
}

/** A length like "43M" or "1T 5M", in minutes */
export function parseLength(s: string): number | undefined {
	const match = /^\s*(?:(\d+)T)?\s*(?:(\d+)M)?\s*$/.exec(s);
	if (match == null || (match[1] === undefined && match[2] === undefined)) {
		return undefined;
	}
	return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

/** "1. DEC 2021 | 38M" or "SÆSON 1 EPISODE 10 | 1T 5M", split in two */
function extraDetails(blob: Json): [string, string] | undefined {
	const parts = text(blob?.customFields?.ExtraDetails)?.split(" | ");
	return parts?.length == 2 ? [parts[0], parts[1]] : undefined;
}

export function lengthInMinutes(blob: Json): number | undefined {
	const details = extraDetails(blob);
	return details ? parseLength(details[1]) : undefined;
}

/** When it can no longer be seen on DR, which only items fetched on their own say, not lists */
export function availableUntil(blob: Json): number | undefined {
	const ends = (Array.isArray(blob?.offers) ? blob.offers : []).map((o: Json) => parseTime(o?.endDate)).filter((at: number | undefined) => at !== undefined);
	return ends.length ? Math.max(...ends) : undefined;
}

export function availableFrom(blob: Json): number | undefined {
	return parseTime(blob?.customFields?.AvailableFrom);
}

const ENGLISH_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** The best publication date we can find, falling back to now */
export function pubdate(blob: Json): number {
	const available = availableFrom(blob);
	if (available !== undefined) {
		return available;
	}
	const date = /^(\d{1,2})\. ([A-Za-z]{3}) (\d{4})$/.exec(extraDetails(blob)?.[0] ?? "");
	const month = date ? ENGLISH_MONTHS.indexOf(date[2].toUpperCase()) : -1;
	if (date && month >= 0) {
		return danishMidnight(Number(date[3]), month, Number(date[1]));
	}
	const year = integer(blob?.releaseYear);
	if (year) {
		return danishMidnight(year, 0, 1);
	}
	return Date.now();
}

/** What an episode is called on its show's page */
export function episodeTitle(blob: Json): string {
	return text(blob?.contextualTitle) || text(blob?.title) || required(blob, "id");
}

/** The items of one of DR's lists, like a show's seasons */
export function items(blob: Json, field: string): Json[] {
	const found = blob?.[field]?.items;
	if (!Array.isArray(found)) {
		throw new FormatError(`Expected ${field}.items to be a list`);
	}
	return found;
}
