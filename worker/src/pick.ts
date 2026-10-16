// "Vælg for mig": what DR has on its categories' pages, with what pick.js needs to ask the viewer about it,
// like whether it's a series, what it's like and how long it is. All of it is DR's own: its categories and keywords.

import {cachedIfWhole} from "./cache";
import {type Card, type DiscoverPage, getCategories, getPage} from "./discover";
import {type Ctx, DRUnavailable} from "./dr";
import {thumbnail} from "./show";

// How long a category's programmes are kept, which DR's rows change little within
const PICK_TIME = 6 * 60 * 60;
// As many rows of a category as its page here has, so they're kept for both
const ROWS = 12;
// Categories that aren't something to pick for an evening
const LEFT_OUT_CATEGORIES = /nyheder|sport/;
const LEFT_OUT_TAGS = ["nyheder", "arkivnyheder", "sport"];
// DR's rows of what's new, like "Netop tilføjet" and "Nye programmer"
const NEW_ROW = /^(ny|nye|netop)\b|\bny(e)? (sæson|episode|afsnit)/i;
// What a visit needs left of its requests to make a category's programmes, as getPage() may use
const ROOM_FOR_A_PAGE = 16;

export type Kind = "serie" | "film" | "dokumentar" | "program";

export interface Pick {
	title: string;
	url: string;
	image?: string;
	kind: Kind;
	tags: string[];
	year?: number;
	minutes?: number;
	seasons?: number;
	// On one of DR's rows of what's new
	fresh?: boolean;
	// For what the viewer has seen, and for making it a favourite
	videoId?: string;
	showId?: string;
	filmId?: string;
}

/** What a programme is, for the first question, or undefined for what isn't picked, like news and episodes */
export function kindOf(c: Card): Kind | undefined {
	if (c.live || c.seriesId || c.tags.some(t => LEFT_OUT_TAGS.includes(t))) {
		return undefined;
	}
	if (c.tags.includes("dokumentar")) {
		return "dokumentar";
	}
	if (c.showId) {
		return c.tags.includes("fiktionsserie") || c.tags.includes("serier") ? "serie" : "program";
	}
	if (c.filmId) {
		return c.tags.includes("film") ? "film" : "program";
	}
	return undefined;
}

/** The programmes on one of DR's pages that can be picked */
export function picks(page: DiscoverPage): Pick[] {
	const found: Pick[] = [];
	const add = (c: Card, fresh: boolean) => {
		const kind = kindOf(c);
		if (kind !== undefined) {
			found.push({
				title: c.title, url: c.url, image: thumbnail(c.image), kind, tags: c.tags,
				year: c.year, minutes: c.minutes, seasons: c.seasons, fresh: fresh || undefined,
				videoId: c.videoId, showId: c.showId, filmId: c.filmId,
			});
		}
	};
	page.featured.forEach(c => add(c, false));
	for (const row of page.rows) {
		const fresh = NEW_ROW.test(row.title);
		row.cards.forEach(c => add(c, fresh));
	}
	return found;
}

/** What's the same programme, like a show and one of its seasons, by DR's id */
function keyOf(p: Pick): string {
	return p.showId ? `show:${p.showId.split("_").at(-1)}` : p.url;
}

/** Programmes on several pages are the same one, with what all of them say about it */
export function merge(lists: Pick[][]): Pick[] {
	const all = new Map<string, Pick>();
	for (const p of lists.flat()) {
		const key = keyOf(p);
		const found = all.get(key);
		if (found === undefined) {
			all.set(key, {...p, tags: [...p.tags]});
			continue;
		}
		found.tags.push(...p.tags.filter(t => !found.tags.includes(t)));
		found.fresh ||= p.fresh;
		// With the show's name in its address
		if (p.showId?.includes("_") && !found.showId?.includes("_")) {
			found.url = p.url;
			found.showId = p.showId;
		}
	}
	return [...all.values()];
}

/**
 * All the programmes to pick from, from DR's categories' pages: one category at a time, each kept on its own, and
 * a visit makes at most one of those that ran out, since each is a page of DR's to read. When it left some out, the
 * list isn't kept, so the next visit adds them.
 */
export async function pickPool(ctx: Ctx): Promise<Pick[]> {
	const categories = (await getCategories(ctx)).filter(c => !LEFT_OUT_CATEGORIES.test(c.url));
	const lists: Pick[][] = [];
	let made = false;
	for (const category of categories) {
		if (made || ctx.budget.left < ROOM_FOR_A_PAGE) {
			// Only what's kept, for the rest
			ctx.refreshes = 0;
		}
		const path = category.url.replace(/\/$/, "");
		let found: Pick[] | undefined;
		try {
			found = await cachedIfWhole(ctx, `pick:${path}`, PICK_TIME, async () => {
				made = true;
				const page = await getPage(ctx, path, ROWS);
				if (page === undefined) {
					throw new DRUnavailable(`No page for the category ${path}`);
				}
				return picks(page);
			});
		} catch (e) {
			console.log("Could not get the programmes of", path, String(e));
			ctx.incomplete = true;
		}
		if (found !== undefined) {
			lists.push(found);
		}
	}
	return merge(lists);
}
