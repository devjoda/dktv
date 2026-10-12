// Searching DR for series, films and episodes

import {cached} from "./cache";
import {type Ctx, fetchSearch, type Json} from "./dr";
import * as dr from "./models";

const SEARCH_CACHE_TIME = 15 * 60;

export interface SearchResultItem {
	title: string;
	wallpaper?: string;
	description: string;
	geoRestricted: boolean;
	url: string;
}

export interface SearchResult {
	series: SearchResultItem[];
	movies: SearchResultItem[];
	episodes: SearchResultItem[];
}

function resultItem(i: Json, url: string): SearchResultItem {
	return {
		title: dr.required(i, "title"),
		wallpaper: dr.wallpaper(i),
		description: dr.text(i.shortDescription) ?? "",
		geoRestricted: dr.geoRestricted(i),
		url,
	};
}

/** Each of DR's items that can be read, leaving out those that can't */
function each<T>(list: Json[], f: (item: Json) => T | undefined): T[] {
	return list.flatMap(item => {
		try {
			const found = f(item);
			return found === undefined ? [] : [found];
		} catch {
			return [];
		}
	});
}

export function buildSearchResult(r: Json): SearchResult {
	const series = each(dr.items(r, "series"), i => {
		dr.required(i, "id");
		return resultItem(i, "/" + dr.required(i, "path").split("/").at(-1) + "/");
	});
	const movies: SearchResultItem[] = [];
	const episodes: SearchResultItem[] = [];
	each(dr.items(r, "playable"), i => {
		dr.required(i, "id");
		const path = dr.required(i, "path");
		if (!path.includes("episode")) {
			movies.push(resultItem(i, path));
			return;
		}
		const slug = path.split("/").at(-1);
		const showId = dr.text(i.showId);
		// The show's page only needs the show's id, not its name
		episodes.push(resultItem(i, showId ? `/${showId}/${slug}` : `/program/${slug}`));
	});
	return {series, movies, episodes};
}

export async function search(ctx: Ctx, query: string): Promise<SearchResult> {
	return cached(ctx, `search:${query}`, SEARCH_CACHE_TIME, async () => buildSearchResult(await fetchSearch(ctx, query)));
}
