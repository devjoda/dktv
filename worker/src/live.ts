// DR's live channels, and what's on them

import {cached} from "./cache";
import {type Ctx, getApi, type Json} from "./dr";
import * as dr from "./models";
import {clock, parseTime} from "./time";

// The list of live channels on DR's website
const CHANNEL_LIST = 155156;
const CHANNEL_CACHE_TIME = 30 * 60;

// How far ahead to get the live channels' schedules, in hours: the rest of the day, and some
const SCHEDULE_HOURS = 24;
const SCHEDULE_CACHE_TIME = 5 * 60;

export interface LiveChannel {
	id: string;
	title: string;
	streamURL: string;
	// The same channel, with Danish subtitles burnt into the picture
	subtitlesURL?: string;
	// Like #FF001E
	colour?: string;
}

/** A programme on a live channel */
export interface Programme {
	title: string;
	start: number;
	end: number;
	description: string;
	image?: string;
}

/** The live channels by their short names, like DR1, in DR's order */
export type Channels = Record<string, LiveChannel>;

export function percentDone(p: Programme, at = clock.now()): number {
	const done = (at - p.start) / (p.end - p.start);
	return Math.round(100 * Math.min(Math.max(done, 0), 1));
}

/** The programme on now, if any, and the ones after it */
export function whatsOn(programmes: Programme[], at = clock.now()): [Programme | undefined, Programme[]] {
	const current = programmes.find(p => p.start <= at && at < p.end);
	return [current, programmes.filter(p => p.start >= at)];
}

export async function getChannels(ctx: Ctx): Promise<Channels> {
	return cached(ctx, "channels", CHANNEL_CACHE_TIME, async () => {
		const blob = await getApi(ctx, `/lists/${CHANNEL_LIST}`, {page_size: 24});
		const channels: Channels = {};
		for (const c of dr.items({list: blob}, "list")) {
			const fields = c?.customFields ?? {};
			const colour = dr.text(fields.channelHexColour);
			channels[dr.required(c, "channelShortCode")] = {
				id: dr.required(c, "id"),
				title: dr.required(c, "title"),
				streamURL: dr.required(fields, "hlsURL"),
				subtitlesURL: dr.text(fields.hlsWithSubtitlesURL),
				colour: colour && /^#[0-9A-Fa-f]{6}$/.test(colour) ? colour : undefined,
			};
		}
		return channels;
	});
}

function programme(b: Json): Programme {
	const start = parseTime(b?.startDate);
	const end = parseTime(b?.endDate);
	if (start === undefined || end === undefined) {
		throw new dr.FormatError("A broadcast without a start or an end");
	}
	return {
		title: dr.required(b.item, "title"),
		start,
		end,
		description: dr.text(b.item.description) || dr.text(b.item.shortDescription) || "",
		image: dr.wallpaper(b.item),
	};
}

/**
 * What's on the live channels, by channel id, from a little before now and some hours ahead.
 * Empty when DR doesn't say, since it's only extra.
 */
export async function getSchedules(ctx: Ctx, channels: Channels): Promise<Record<string, Programme[]>> {
	try {
		return await cached(ctx, "schedules", SCHEDULE_CACHE_TIME, async () => {
			const at = new Date(clock.now());
			const blob = await getApi(ctx, "/schedules", {
				date: at.toISOString().slice(0, 10),
				hour: at.getUTCHours(),
				channels: Object.values(channels).map(c => c.id).join(","),
				duration: SCHEDULE_HOURS,
			});
			if (!Array.isArray(blob)) {
				throw new dr.FormatError("Expected a list of schedules");
			}
			return Object.fromEntries(blob.map(s => [dr.required(s, "channelId"), (s.schedules ?? []).map(programme)]));
		});
	} catch (e) {
		console.log("Could not get the live channels' schedules", String(e));
		return {};
	}
}

/** A programme as the browser gets it, for the channel guide and the programme list: times in milliseconds */
export interface PlannedProgramme {
	title: string;
	start: number;
	end: number;
	description: string;
}

/** What's left of each channel's schedule from `at`, by the channel's short name, as the browser gets it */
export function planFrom(channels: Channels, schedules: Record<string, Programme[]>, at = clock.now()): Record<string, PlannedProgramme[]> {
	return Object.fromEntries(Object.entries(channels).map(([slug, channel]) => [slug, (schedules[channel.id] ?? [])
		.filter(p => p.end > at)
		.map(p => ({title: p.title, start: p.start, end: p.end, description: p.description.length > 280 ? p.description.slice(0, 279).trimEnd() + "…" : p.description}))]));
}

/** The channel a live channel's address names, like DR2 for dr2, if any */
export function channelNamed(channels: Channels, name: string): string | undefined {
	if (Object.hasOwn(channels, name)) {
		return name;
	}
	return Object.keys(channels).find(slug => slug.toLowerCase() == name.toLowerCase());
}
