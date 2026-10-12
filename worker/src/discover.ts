// DR's own front page and categories: what DR features at the top, and the rows
// of programmes below, with links to the pages here instead of DR's.

import {cached} from "./cache";
import {type Ctx, getApi, type Json, NotFound} from "./dr";
import {type Channels, getChannels} from "./live";
import * as dr from "./models";

const PAGE_CACHE_TIME = 30 * 60;
const ROW_SIZE = 24;
// The most DR gives at a time, and the most of a list shown, like all films from A to Å
const LIST_PAGE_SIZE = 100;
const MAX_LIST = 1000;
// A row with fewer than this isn't worth a row
const MIN_ROW = 3;

// DR's categories, as they're linked here and from the header
const CATEGORY_LIST = 376779;

// Rows on DR's pages that are better elsewhere here, or aren't rows of programmes
const SKIPPED_ROWS = new Set(["Se live tv", "Se livesport", "Kategorier"]);

/** A programme in one of DR's rows, or at the top of a page */
export interface Card {
	title: string;
	url: string;
	image?: string;
	description: string;
	tagline: string;
	category: string;
	// Like "Episode 1:7", from the start of DR's tagline
	detail: string;
	// Where the category and the detail lead
	categoryURL?: string;
	episodeURL?: string;
	// DR's short clip of it, to play at the top of the front page
	preview?: string;
	// For marking what the viewer has seen
	videoId?: string;
	// For making a show or a film a favourite
	showId?: string;
	filmId?: string;
	live: boolean;
}

export interface Row {
	title: string;
	cards: Card[];
	// DR's list, when it has more than the row shows
	more?: string;
}

export interface DiscoverPage {
	title: string;
	featured: Card[];
	rows: Row[];
}

export interface Category {
	title: string;
	url: string;
	image?: string;
}

/** Where an item of DR's goes here, or undefined if it doesn't go anywhere here */
export function card(item: Json, channelSlugs: Record<string, string>): Card | undefined {
	const type = dr.required(item, "type");
	const path = dr.required(item, "path");
	const title = dr.required(item, "title");
	const id = dr.required(item, "id");
	const showId = dr.text(item.showId) ?? (typeof item.showId == "number" ? String(item.showId) : undefined);
	const slug = path.replace(/\/+$/, "").split("/").at(-1)!;
	let url: string;
	let videoId: string | undefined;
	let cardShowId: string | undefined;
	let filmId: string | undefined;
	if (type == "show") {
		url = `/${slug}/`;
		cardShowId = slug;
	} else if (type == "season" && showId) {
		// The show's page only needs the show's id, not its name
		url = `/${showId}/`;
		cardShowId = showId;
	} else if (type == "episode") {
		url = showId ? `/${showId}/${slug}` : `/program/${slug}`;
		videoId = slug.split("_").at(-1);
	} else if (type == "program") {
		url = `/program/${slug}`;
		videoId = slug.split("_").at(-1);
		filmId = slug;
	} else if (type == "link" && path.startsWith("/kanal/")) {
		const channelId = slug.split("_").at(-1)!;
		if (!(channelId in channelSlugs)) {
			return undefined;
		}
		url = `/live/${channelSlugs[channelId]}`;
	} else {
		return undefined;
	}
	const fields = item.customFields ?? {};
	const category = (dr.text(fields.DisplayCategory) ?? "").split(",")[0];
	let detail = "";
	let tagline = dr.text(item.tagline) ?? "";
	if (tagline.includes(" | ")) {
		const at = tagline.indexOf(" | ");
		[detail, tagline] = [tagline.slice(0, at), tagline.slice(at + 3)];
	}
	let episodeURL: string | undefined;
	const number = /^Episode (\d+)/.exec(detail);
	if (type == "season" && number) {
		episodeURL = `/${showId}/afsnit/${number[1]}?saeson=${id}`;
	} else if (videoId !== undefined) {
		episodeURL = url;
	}
	const description = dr.text(item.shortDescription) ?? "";
	return {
		title,
		url,
		image: dr.wallpaper(item),
		description: description != "LinkItem" ? description : "",
		tagline,
		category,
		detail,
		episodeURL,
		preview: dr.text(fields.ShortVideoUrl),
		videoId,
		showId: cardShowId,
		filmId,
		live: type == "link",
	};
}

export function cards(items: Json[], channelSlugs: Record<string, string>): Card[] {
	const result: Card[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		let c: Card | undefined;
		try {
			c = card(item, channelSlugs);
		} catch {
			continue;
		}
		// DR sometimes has a show twice in a row, like two of its seasons
		if (c !== undefined && !seen.has(c.url)) {
			seen.add(c.url);
			result.push(c);
		}
	}
	return result;
}

interface PageList {
	id: string;
	title?: string;
	items: Json[];
	// In pages, not items
	pages: number;
}

function pageList(blob: Json): PageList | undefined {
	if (blob == null || typeof blob != "object" || (typeof blob.id != "string" && typeof blob.id != "number")) {
		return undefined;
	}
	const pages = dr.integer(blob.paging?.total);
	return {
		id: String(blob.id),
		title: dr.text(blob.title),
		items: Array.isArray(blob.items) ? blob.items.filter((i: Json) => i && typeof i == "object") : [],
		pages: pages ?? 1,
	};
}

function isRow(entry: Json): boolean {
	const title = (dr.text(entry.title) ?? "").trim();
	const template = dr.text(entry.template) ?? "";
	return pageList(entry.list) !== undefined
		&& ["P", "T"].includes(template.slice(0, 1))
		&& !template.startsWith("TX")
		// Not the rows for each letter of the alphabet
		&& title.length > 1
		&& !SKIPPED_ROWS.has(title);
}

/** Like "nyhederogdebat" for "Nyheder og debat", to compare names of categories */
export function simple(text: string): string {
	return text.toLowerCase().replaceAll("æ", "ae").replaceAll("ø", "oe").replaceAll("å", "aa").replace(/[^a-z]/g, "");
}

/** The category for one of DR's, like "Fiktionsserie" for the Serier at /kategorier/fiktionsserier/ */
export function categoryURL(name: string, categories: Category[]): string | undefined {
	if (!name) {
		return undefined;
	}
	const wanted = simple(name);
	for (const c of categories) {
		const slug = simple(c.url.replace(/\/+$/, "").split("/").at(-1)!);
		if (slug.startsWith(wanted) || wanted.startsWith(slug)) {
			return c.url;
		}
	}
	return undefined;
}

const channelSlugs = (channels: Channels) => Object.fromEntries(Object.entries(channels).map(([slug, c]) => [c.id, slug]));

/** Which of DR's lists one of its pages has, at the top and as rows */
interface Layout {
	title: string;
	hero?: string;
	rows: {title: string; list: string}[];
}

async function getLayout(ctx: Ctx, path: string): Promise<Layout> {
	return cached(ctx, `layout:${path}`, PAGE_CACHE_TIME, async () => {
		// Without the rows' programmes, which are got and kept one row at a time
		const page = await getApi(ctx, "/page", {path, list_page_size: ROW_SIZE, max_list_prefetch: 0});
		const entries: Json[] = Array.isArray(page?.entries) ? page.entries.filter((e: Json) => e && typeof e == "object") : [];
		const hero = entries.find(e => /^(DRH|H)/.test(dr.text(e.template) ?? "") && pageList(e.list));
		return {
			title: dr.text(page?.title) ?? "",
			hero: hero ? pageList(hero.list)!.id : undefined,
			rows: entries.filter(isRow).map(e => ({title: e.title.trim(), list: pageList(e.list)!.id})),
		};
	});
}

/** The start of one of DR's lists, as a row shows it */
interface RowList {
	cards: Card[];
	pages: number;
}

async function getRow(ctx: Ctx, listId: string): Promise<RowList> {
	return cached(ctx, `row:${listId}`, PAGE_CACHE_TIME, async () => {
		let blob: Json;
		try {
			blob = await getApi(ctx, `/lists/${listId}`, {page_size: ROW_SIZE});
		} catch (e) {
			// Kept as empty, so it isn't asked for again on every visit
			if (e instanceof NotFound) {
				return {cards: [], pages: 0};
			}
			throw e;
		}
		const found = pageList(blob);
		if (found === undefined) {
			throw new dr.FormatError(`DR's list ${listId} isn't a list`);
		}
		return {cards: cards(found.items, channelSlugs(await getChannels(ctx))), pages: found.pages};
	});
}

/**
 * One of DR's pages, like "/" or "/kategorier/film", or undefined if DR doesn't say.
 * When DR doesn't answer, the last one it did is used for a while longer.
 */
export async function getPage(ctx: Ctx, path: string, maxRows = 10): Promise<DiscoverPage | undefined> {
	let layout: Layout;
	try {
		layout = await getLayout(ctx, path);
	} catch (e) {
		console.log("Could not get DR's page", path, String(e));
		return undefined;
	}
	const wanted = layout.rows.slice(0, maxRows);
	const [categories, hero, ...found] = await Promise.all([
		getCategories(ctx),
		layout.hero ? getRow(ctx, layout.hero).catch(e => {
			console.log("Could not get the top of", path, String(e));
			return undefined;
		}) : undefined,
		...wanted.map(row => getRow(ctx, row.list).catch(e => {
			console.log("Could not get a row of", path, row.title, String(e));
			return undefined;
		})),
	]);
	const featured = (hero?.cards ?? []).map(c => ({...c, categoryURL: categoryURL(c.category, categories)}));
	const rows: Row[] = [];
	wanted.forEach((row, i) => {
		const list = found[i];
		if (list !== undefined && list.cards.length >= MIN_ROW) {
			rows.push({title: row.title, cards: list.cards, more: list.pages > 1 ? row.list : undefined});
		}
	});
	return {title: layout.title, featured, rows};
}

export interface FullList {
	title: string;
	cards: Card[];
}

/** All of one of DR's lists, which rows only show the start of, or undefined if DR doesn't have it */
export async function getList(ctx: Ctx, listId: string): Promise<FullList | undefined> {
	try {
		return await cached(ctx, `list:${listId}`, PAGE_CACHE_TIME, async () => {
			const first = pageList(await getApi(ctx, `/lists/${listId}`, {page_size: LIST_PAGE_SIZE, page: 1}));
			if (first === undefined) {
				throw new dr.FormatError(`DR's list ${listId} isn't a list`);
			}
			const pages = Math.min(first.pages, MAX_LIST / LIST_PAGE_SIZE);
			const rest = await Promise.all(Array.from({length: Math.max(pages - 1, 0)}, (_, i) =>
				getApi(ctx, `/lists/${listId}`, {page_size: LIST_PAGE_SIZE, page: i + 2})));
			const items = first.items.concat(...rest.map(blob => pageList(blob)?.items ?? []));
			return {title: first.title ?? "", cards: cards(items, channelSlugs(await getChannels(ctx)))};
		});
	} catch (e) {
		console.log("Could not get DR's list", listId, String(e));
		return undefined;
	}
}

/** DR's categories, like Serier, Film and Dokumentar */
export async function getCategories(ctx: Ctx): Promise<Category[]> {
	try {
		return await cached(ctx, "categories", PAGE_CACHE_TIME, async () => {
			const list = pageList(await getApi(ctx, `/lists/${CATEGORY_LIST}`, {page_size: 50}));
			const found: Category[] = [];
			for (const item of list?.items ?? []) {
				const path = dr.text(item.path) ?? "";
				// Search finds anything from A to Å better
				if (path.startsWith("/kategorier/") && path != "/kategorier/a-aa") {
					found.push({title: dr.text(item.title) ?? "", url: path + "/", image: dr.text(item.images?.tile) || dr.text(item.images?.wallpaper)});
				}
			}
			return found;
		});
	} catch (e) {
		console.log("Could not get DR's categories", String(e));
		return [];
	}
}
