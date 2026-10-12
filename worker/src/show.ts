// Shows, their seasons and episodes, and programmes that aren't part of a show, like films

import {cached, peek} from "./cache";
import {type Ctx, getApi, type Json, NotFound} from "./dr";
import * as dr from "./models";
import {isoTime} from "./time";

export interface Episode {
	title: string;
	shortDescription: string;
	// Like /episode/rejseholdet_503615
	url: string;
	// The end of the URL, like rejseholdet_503615, which the episode's page here is at
	link: string;
	videoId: string;
	pubdate: number;
	wallpaper?: string;
	minutes?: number;
	geoRestricted: boolean;
}

export interface Season {
	title: string;
	// DR's id for the season
	id: string;
	episodes: Episode[];
}

export interface Show {
	title: string;
	description: string;
	// Like rejseholdet_503605, which the show's page here is at
	url: string;
	wallpaper?: string;
	geoRestricted: boolean;
	nextEpisode?: number;
	seasons: Season[];
}

export interface Program {
	title: string;
	description: string;
	url: string;
	videoId: string;
	pubdate?: number;
	wallpaper?: string;
	minutes?: number;
	geoRestricted?: boolean;
}

const SHOW_CACHE_TIME = 60 * 60;
// Each season is a request to DR, of the 50 a visit may make. Few shows have more.
export const MAX_SEASONS = 38;

/** DR's id for a video, from its URL, which ends in it */
export function videoId(url: string): string {
	return url.split("_").at(-1)!;
}

/** DR's id at the end of something like rejseholdet_503605, or NotFound */
export function itemId(slug: string): string {
	const id = slug.split("_").at(-1)!;
	if (!/^\d+$/.test(id)) {
		throw new NotFound(`${slug} has no id`);
	}
	return String(Number(id));
}

export function allEpisodes(show: Show): Episode[] {
	return show.seasons.flatMap(s => s.episodes);
}

/**
 * Asks DR's image service for a smaller version of an image, since DR's image URLs are for full HD
 */
export function thumbnail(url: string | undefined | null, width = 640): string | undefined {
	if (url == null) {
		return undefined;
	}
	// Pages have the same pictures over and over, which this saves working out again
	const key = width + url;
	let found = thumbnails.get(key);
	if (found === undefined) {
		if (thumbnails.size > MAX_THUMBNAILS) {
			thumbnails.clear();
		}
		found = resize(url, width);
		thumbnails.set(key, found);
	}
	return found;
}

const thumbnails = new Map<string, string>();
const MAX_THUMBNAILS = 20_000;

function resize(url: string, width: number): string {
	const oldWidth = /\bWidth=(\d+)/.exec(url);
	const oldHeight = /\bHeight=(\d+)/.exec(url);
	if (oldWidth == null || oldHeight == null || Number(oldWidth[1]) <= width) {
		return url;
	}
	const height = Math.round(Number(oldHeight[1]) * width / Number(oldWidth[1]));
	return url
		.replace(oldWidth[0], `Width=${width}`)
		// Some are photos as PNG, which are many times bigger than as JPEG
		.replace("Format='png'", "Format='jpg'")
		.replace(oldHeight[0], `Height=${height}`);
}

function episode(blob: Json): Episode {
	const url = dr.required(blob, "path");
	return {
		title: dr.episodeTitle(blob),
		shortDescription: dr.text(blob.shortDescription) ?? "",
		url,
		link: url.split("/").at(-1)!,
		videoId: videoId(url),
		pubdate: dr.pubdate(blob),
		wallpaper: dr.wallpaper(blob),
		minutes: dr.lengthInMinutes(blob),
		geoRestricted: dr.geoRestricted(blob),
	};
}

/**
 * Builds a Show from the latest season of a series (which carries the show),
 * and all of the show's seasons keyed by path
 */
export function buildShow(latest: Json, seasons: Map<string, Json>): Show {
	const show = latest.show;
	const title = dr.required(show, "title");
	const next = dr.integer(show.nextEpisode?.availableUTC);
	const result: Show = {
		title,
		description: dr.text(show.description) ?? "",
		url: dr.required(show, "path").split("/").at(-1)!,
		wallpaper: dr.wallpaper(latest),
		geoRestricted: dr.geoRestricted(latest),
		nextEpisode: next !== undefined ? next * 1000 : undefined,
		seasons: [],
	};
	for (const ref of dr.items(show, "seasons")) {
		const season = seasons.get(ref.path);
		if (season === undefined) {
			continue;
		}
		let seasonTitle = dr.required(ref, "title");
		if (seasonTitle == title) {
			const number = dr.integer(ref.seasonNumber);
			const year = dr.integer(ref.releaseYear);
			if (number !== undefined) {
				seasonTitle = `Sæson ${number}`;
			} else if (year !== undefined) {
				seasonTitle = String(year);
			}
		} else if (seasonTitle.startsWith(`${title}: `)) {
			// Like "Rejseholdet: Sæson 3", where the show's name is just noise
			seasonTitle = seasonTitle.slice(title.length + 2);
		}
		result.seasons.push({
			title: seasonTitle,
			id: dr.required(ref, "id"),
			episodes: dr.items(season, "episodes").flatMap(blob => {
				try {
					return [episode(blob)];
				} catch (e) {
					console.log("Leaving out an episode of", title, String(e));
					return [];
				}
			}),
		});
	}
	return result;
}

export async function getShow(ctx: Ctx, slug: string): Promise<Show> {
	const id = itemId(slug);
	return cached(ctx, `show:${id}`, SHOW_CACHE_TIME, async () => {
		const item = await getApi(ctx, `/items/${id}`, {expand: "all"});
		if (item?.type != "show") {
			throw new NotFound(`${id} is a ${item?.type}, not a show`);
		}
		let refs = dr.items(item, "seasons");
		if (refs.length == 0) {
			throw new Error(`Show ${id} has no seasons`);
		}
		if (refs.length > MAX_SEASONS) {
			console.log("Only the newest", MAX_SEASONS, "of", refs.length, "seasons of", id);
			refs = refs.slice(-MAX_SEASONS);
		}
		const seasons = new Map<string, Json>(await Promise.all(refs.map(async (ref): Promise<[string, Json]> =>
			[ref.path, await getApi(ctx, `/items/${dr.required(ref, "id")}`, {expand: "all"})])));
		// The latest season carries the show along with it, like DR's own site uses
		return buildShow(seasons.get(refs.at(-1).path), seasons);
	});
}

/** An episode's long description, which only its own item has */
export async function getLongDescription(ctx: Ctx, e: Episode): Promise<string> {
	try {
		return await cached(ctx, `description:${e.videoId}`, SHOW_CACHE_TIME, async () => {
			const item = await getApi(ctx, `/items/${e.videoId}`);
			return dr.text(item.description) || e.shortDescription;
		});
	} catch (error) {
		console.log("Could not get the long description of", e.url, String(error));
		return e.shortDescription;
	}
}

export async function getProgram(ctx: Ctx, slug: string): Promise<Program> {
	const id = itemId(slug);
	return cached(ctx, `program:${id}`, SHOW_CACHE_TIME, async () => {
		// Programmes carry the same date and length as episodes do
		const item = await getApi(ctx, `/items/${id}`);
		const url = dr.required(item, "path");
		return {
			title: dr.text(item.title) || dr.required(item, "id"),
			description: dr.text(item.shortDescription) ?? "",
			url,
			videoId: videoId(url),
			pubdate: dr.availableFrom(item),
			wallpaper: dr.wallpaper(item),
			minutes: dr.lengthInMinutes(item),
		};
	});
}

/** The episodes in the order they're watched in, for the play button to find where the viewer got to */
export function playlist(show: Show) {
	return show.seasons.flatMap(season => season.episodes.map(e => ({
		id: e.videoId,
		url: `/${show.url}/${e.link}`,
		title: e.title,
		season: show.seasons.length > 1 ? season.title : null,
	})));
}

const escapeXML = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const element = (name: string, content: string) => `<${name}>${escapeXML(content)}</${name}>`;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Like Sun, 01 Oct 2000 18:00:00 +0000 */
function rssDate(at: number): string {
	const d = new Date(at);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${DAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${isoTime(at).slice(11, 19)} +0000`;
}

/** The show as an RSS feed, for podcast apps and feed readers, with links to the pages at baseURL */
export function rssFeed(show: Show, baseURL: string): string {
	const parts = [
		"<?xml version='1.0' encoding='UTF-8'?>\n",
		'<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>',
		element("title", show.title),
		"<ttl>60</ttl>",
	];
	if (show.description) {
		parts.push(element("description", show.description));
	}
	parts.push(element("link", `${baseURL}/${show.url}/`));
	for (const e of allEpisodes(show)) {
		parts.push("<item>", element("title", e.title));
		// The long description is only fetched once someone opens the episode
		const description = peek<string>(`description:${e.videoId}`) || e.shortDescription;
		if (description) {
			parts.push(element("description", description));
		}
		parts.push(
			element("link", `${baseURL}/${show.url}/${e.link}`),
			`<guid isPermaLink="false">${escapeXML("DRTV:" + e.link)}</guid>`,
			element("pubDate", rssDate(e.pubdate)),
		);
		if (e.wallpaper) {
			parts.push(`<media:thumbnail url="${escapeXML(thumbnail(e.wallpaper)!)}" />`);
		}
		parts.push("</item>");
	}
	parts.push("</channel></rss>");
	return parts.join("");
}
