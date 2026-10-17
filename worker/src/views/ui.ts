// The building blocks of the pages

import type {Entry} from "../catalogue";
import type {Card} from "../discover";
import {channelStyle, type LiveChannel, percentDone, type Programme, whatsOn} from "../live";
import {allEpisodes, playlist, type Show, thumbnail} from "../show";
import {clock, clockTime, danishDate, duration, isNew, leavingLabel} from "../time";
import {attr, each, html, type Html} from "./html";

const icons = new Map<string, Html>();

export function icon(name: string): Html {
	let found = icons.get(name);
	if (found === undefined) {
		found = html`<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
		icons.set(name, found);
	}
	return found;
}

/** Shown by progress.js, for videos the viewer started */
export const PROGRESS_BAR = html`<div class="tile-progress js-progress" role="progressbar" aria-label="Set indtil videre" aria-valuemin="0" aria-valuemax="100" hidden><span></span></div>`;

/** Shown by progress.js, for what the viewer has seen */
export const SEEN_MARK = html`<span class="tile-seen js-seen" hidden>Set</span>`;

export type Tag = [kind: string, label: string];

export function badges(tags: Tag[]): Html {
	return each(tags, ([kind, label]) => html`<span class="tag tag-${kind}">${label}</span>`);
}

/** Adds a show or a film to the viewer's favourites, or removes it, with favorites.js */
export function favoriteButton(id: string, title: string, image: string | undefined, {compact = false, kind = "show"}: {compact?: boolean; kind?: "show" | "film"} = {}): Html {
	return html`<button type="button" class="${compact ? "tile-action" : "button button-secondary"} js-favorite" aria-pressed="false"${
		compact ? html` aria-label="Favorit: ${title}" title="Favorit"` : ""} data-favorite-id="${id}" data-kind="${kind}" data-title="${title}" data-image="${image ? thumbnail(image) : ""}">${
		icon("heart")}${compact ? "" : " Favorit"}</button>`;
}

export interface TileProps {
	href: string;
	image?: string;
	title: string;
	meta?: string;
	tags?: Tag[];
	// Marks how far the viewer got with that video
	videoId?: string;
	// Marks how many of a show's episodes they've seen
	episodeIds?: string[];
	minutes?: number;
	description?: string;
	// Add a button to make the show or film a favourite
	showId?: string;
	filmId?: string;
	// Or the button itself
	action?: Html | "";
}

/** A picture with a title, linking to a show or a video */
export function tile({href, image, title, meta, tags = [], videoId, episodeIds, minutes, description, showId, filmId, action}: TileProps): Html {
	return html`<article class="tile"${attr("data-video-id", videoId)}${attr("data-episode-ids", episodeIds?.length ? episodeIds.join(" ") : undefined)}>
<a class="tile-link" href="${href}"><div class="tile-media">${
	image ? html`<img src="${thumbnail(image)}" alt="" loading="lazy">` : ""}${
	tags.length ? html`<div class="tile-badges">${badges(tags)}</div>` : ""}${SEEN_MARK}${
	minutes ? html`<span class="tile-duration">${duration(minutes)}</span>` : ""}<span class="tile-play">${icon("play")}</span>${PROGRESS_BAR}</div>
<h3 class="tile-title">${title}</h3></a>
<p class="tile-meta"><span class="js-meta">${meta || ""}</span>${action !== undefined ? action
	: showId ? favoriteButton(showId, title, image, {compact: true}) : filmId ? favoriteButton(filmId, title, image, {compact: true, kind: "film"}) : ""}</p>${
	description ? html`<p class="tile-desc">${description}</p>` : ""}
</article>`;
}

/** A picture across the page, from DR's image service, as sharp as the screen needs */
export function widePicture(image: string | undefined, lazy = false): Html {
	return html`<img src="${thumbnail(image, 1280)}" srcset="${thumbnail(image, 1280)} 1280w, ${thumbnail(image, 1920)} 1920w" sizes="100vw" alt=""${
		lazy ? html` loading="lazy" fetchpriority="low"` : ""} decoding="async">`;
}

/** The button that makes one of DR's programmes a favourite: a series, an episode's series, or a film; live channels have none */
export function cardFavorite(c: Card, compact = false): Html | "" {
	if (c.showId || c.seriesId) {
		return favoriteButton((c.showId ?? c.seriesId)!, c.showId ? c.title : c.seriesTitle ?? c.title, c.image, {compact});
	}
	return c.filmId ? favoriteButton(c.filmId, c.title, c.image, {compact, kind: "film"}) : "";
}

/** One of DR's programmes */
export function cardTile(c: Card): Html {
	return tile({href: c.url, image: c.image, title: c.title, meta: c.category, tags: c.live ? [["live", "Direkte"]] : [], videoId: c.videoId, action: cardFavorite(c, true)});
}

export const KIND_NAMES: Record<string, string> = {serie: "Serie", film: "Film", dokumentar: "Dokumentar", program: "Program"};

/** One of the catalogue's titles, with its kind below it, or `meta` */
export function entryTile(e: Entry, meta?: string): Html {
	const show = e.u.endsWith("/");
	const slug = e.u.replace(/^\/(program\/)?|\/$/g, "");
	return tile({href: e.u, image: e.i, title: e.t, meta: meta ?? KIND_NAMES[e.k], videoId: show ? undefined : e.id,
		showId: show ? slug : undefined, filmId: show ? undefined : slug});
}

/** A live channel, with what's on it now */
export function channelTile(slug: string, channel: LiveChannel, programmes: Programme[]): Html {
	const [onNow, later] = whatsOn(programmes);
	const done = onNow ? percentDone(onNow) : 0;
	return html`<article class="tile channel-tile">
<a class="tile-link" href="/live/${slug}"${attr("style", channelStyle(slug, channel))}><div class="tile-media">${
	onNow?.image
		? html`<img src="${thumbnail(onNow.image)}" alt="" loading="lazy"><div class="tile-badges"><span class="tag tag-channel">${channel.title}</span></div>`
		: html`<div class="channel-art">${channel.title}</div>`
}<span class="tile-play">${icon("play")}</span>${
	onNow ? html`<div class="tile-progress tile-progress-live" role="progressbar" aria-label="Sendt indtil videre" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${done}"><span style="width: ${done}%;"></span></div>` : ""
}</div>
<h3 class="tile-title">${onNow ? html`<span class="visually-hidden">${channel.title}: </span>${onNow.title}` : channel.title}</h3></a>
<p class="tile-meta">${
	onNow
		? html`<span>Til ${clockTime(onNow.end)}${later.length ? `, derefter ${later[0].title}` : ""}</span>`
		: later.length
			? html`<span>Fra ${clockTime(later[0].start)}: ${later[0].title}</span>`
			: html`<span>Direkte</span>`
}</p>
</article>`;
}

/**
 * The top of a row of tiles that scrolls sideways, with a link to all of it. When the row
 * has all of it, ui.js only shows the link when the row is wider than the page.
 */
export function shelfHead(title: string, id: string, more?: string, overflowOnly = false): Html {
	return html`<div class="shelf-head">
<h2 class="shelf-title" id="${id}">${title}</h2>${
	more ? html`<a class="shelf-more" href="${more}"${overflowOnly ? html` data-overflow-only` : ""}>Se alle <span class="visually-hidden">${title}</span>${icon("chevron-right")}</a>` : ""}
<div class="shelf-nav" hidden><button type="button" class="js-shelf-back" aria-label="Tilbage">${icon("chevron-left")}</button><button type="button" class="js-shelf-forward" aria-label="Frem">${icon("chevron-right")}</button></div>
</div>`;
}

/** Where all of one of DR's rows is */
export function moreLink(row: {title: string; more: string}): string {
	return `/liste/${row.more}/?titel=${encodeURIComponent(row.title)}`;
}

export function searchField(query?: string, autofocus = false): Html {
	return html`<form class="search-field" role="search" action="/search/">
<input type="search" name="query" placeholder="Søg efter serier, film og afsnit" aria-label="Søg" value="${query || ""}" enterkeyhint="search"${autofocus ? html` autofocus` : ""}>
<button type="submit" class="search-submit" aria-label="Søg">${icon("search")}</button>
</form>`;
}

/** Plays the episode the viewer is at, which progress.js finds; the first one until then */
export function playButton(show: Show): Html {
	const episodes = playlist(show);
	return html`<a class="button button-primary js-play" href="${episodes.length ? episodes[0].url : `/${show.url}/`}" data-episodes="${JSON.stringify(episodes)}">
${icon("play")}
<span class="button-label"><span class="js-play-label">Afspil</span><span class="button-detail js-play-detail" hidden></span></span>
</a>`;
}

/** When something leaves DR: a tag when it's soon, or has, and otherwise the date, if DR says */
export function leaving(at: number | undefined, quiet = false): Html | "" {
	if (at && at <= clock.now()) {
		return html`<span class="tag tag-leaving">Kan ikke længere ses</span>`;
	}
	const label = leavingLabel(at);
	if (label) {
		return html`<span class="tag tag-leaving">${label}</span>`;
	}
	return at && !quiet ? html`<span>Kan ses til ${danishDate(at)}</span>` : "";
}

/** The facts about a show, for the line below its title */
export function showFacts(show: Show): Html {
	const episodes = allEpisodes(show);
	return html`<p class="meta">${
		show.seasons.length > 1 ? html`<span>${show.seasons.length} sæsoner</span>` : ""}<span>${episodes.length} afsnit</span>${
		episodes.length > 0 && isNew(episodes.at(-1)!.pubdate) ? html`<span class="tag tag-new">Nye afsnit</span>` : ""}${
		leaving(show.expires)}${
		show.geoRestricted ? html`<span class="tag tag-geo">Kun i Danmark</span>` : ""}</p>`;
}
