// The pages

import type {OwnRow} from "../catalogue";
import type {Card, Category, DiscoverPage, Row} from "../discover";
import {channelStyle, type Channels, type LiveChannel, percentDone, planFrom, type PlannedProgramme, type Programme, whatsOn} from "../live";
import type {SearchResult, SearchResultItem} from "../search";
import type {Segments} from "../segments";
import {allEpisodes, type Episode, type Program, type Season, type Show, thumbnail, wholeSentences} from "../show";
import {clock, clockTime, danishDate, danishDatetime, duration, isNew, isoTime, leavingLabel} from "../time";
import {attr, each, html, type Html, raw, scriptJSON} from "./html";
import {layout, LIBRARIES, LIVE_SCRIPTS, MAIN_CATEGORIES, type Site, staticURL, VIDEO_SCRIPTS} from "./layout";
import {cardFavorite, cardTile, channelTile, entryTile, favoriteButton, icon, leaving, moreLink, playButton, PROGRESS_BAR, searchField, SEEN_MARK, shelfHead, showFacts, type Tag, tile, widePicture} from "./ui";

type Schedules = Record<string, Programme[]>;

function rowShelf(row: Row, i: number): Html {
	return html`<section class="shelf" aria-labelledby="row-${i + 1}">
${shelfHead(row.title, `row-${i + 1}`, moreLink(row), row.complete)}
<div class="shelf-track">${each(row.cards, cardTile)}</div>
</section>
`;
}

/** DR's rows, numbered from `from`, for the later parts of a page */
function rows(found: Row[], from = 0): Html {
	return each(found, (row, i) => rowShelf(row, from + i));
}

// The front page's own rows, from the catalogue, in the order they come among DR's, after every other one of them
const OWN_ORDER = ["sidste-chance", "stemning", "tema", "nye-film", "kort"];
const OWN_EVERY = 2;
const OWN_LEAST = 4;

/** One of the front page's own rows, without what has left DR since it was made */
function ownShelf(row: OwnRow): Html {
	const now = clock.now();
	const entries = row.entries.filter(e => e.x === undefined || e.x > now);
	if (entries.length < OWN_LEAST) {
		return html``;
	}
	return html`<section class="shelf" data-own-row="${row.id}" aria-labelledby="own-${row.id}">
${shelfHead(row.title, `own-${row.id}`, row.more)}
<div class="shelf-track">${each(entries, e => entryTile(e, row.id == "sidste-chance" ? leavingLabel(e.x) : undefined))}</div>
</section>
`;
}

/** DR's rows, with the front page's own among them */
function frontRows(found: Row[], own: OwnRow[]): Html {
	const ordered = OWN_ORDER.map(id => own.find(row => row.id == id)).filter(row => row !== undefined);
	let out = "";
	let next = 0;
	found.forEach((row, i) => {
		out += rowShelf(row, i).text;
		if ((i + 1) % OWN_EVERY == 0 && next < ordered.length) {
			out += ownShelf(ordered[next++]).text;
		}
	});
	for (const row of ordered.slice(next)) {
		out += ownShelf(row).text;
	}
	return raw(out);
}

/** Where ui.js gets the next of a page's rows, as it's scrolled down to */
function moreRowsMark(from: number): Html {
	return html`<div class="more-rows js-more-rows" data-from="${from}" aria-hidden="true"></div>`;
}

/** The front page's later rows, from the row `from`, for ui.js to put in, and where to get those after them */
export function moreRows(page: DiscoverPage | undefined, from: number, next: number): Html {
	return page ? html`${rows(page.rows, from)}${page.more ? moreRowsMark(next) : ""}` : html``;
}

/**
 * What DR features, one at a time. ui.js plays DR's short clip of each without sound,
 * and moves on to the next as soon as it ends. The bars show which one is shown, and
 * how far it's got.
 */
function featuredSlides(featured: Card[]): Html {
	return html`<section class="hero featured" aria-label="Fremhævet">
${each(featured, (c, i) => html`<div class="hero-slide" id="featured-${i + 1}"${attr("data-preview", c.preview)}${c.live ? html` data-live` : ""}${i > 0 ? html` hidden` : ""}>
<div class="hero-backdrop">${widePicture(c.image, i > 0)}</div>
<div class="hero-content">
<h2 class="hero-title${c.title.length > 20 ? " is-long" : ""}">${c.title}</h2>
<p class="meta">${c.live ? html`<span class="tag tag-live">Direkte</span>` : ""}${
	c.categoryURL ? html`<a class="meta-link" href="${c.categoryURL}">${c.category}</a>` : c.category ? html`<span>${c.category}</span>` : ""}${
	c.detail && c.episodeURL ? html`<a class="meta-link" href="${c.episodeURL}">${c.detail}</a>` : c.detail ? html`<span>${c.detail}</span>` : ""}</p>
${c.tagline || c.description ? html`<p class="hero-text">${c.tagline || c.description}</p>` : ""}
<div class="actions">
<a class="button button-primary" href="${c.episodeURL || c.url}">${icon("play")} ${c.live ? "Se direkte" : "Se nu"}</a>
${cardFavorite(c)}
</div>
</div>
</div>
`)}${featured.length > 1 ? html`<div class="featured-controls wrap">
<div class="featured-bars" role="tablist" aria-label="Fremhævet" hidden>
${each(featured, (c, i) => html`<button type="button" class="featured-bar" role="tab" id="featured-tab-${i + 1}" aria-controls="featured-${i + 1}" aria-label="${c.title}" aria-selected="${i == 0 ? "true" : "false"}"${attr("tabindex", i == 0 ? undefined : -1)}><span></span></button>`)}
</div>
</div>` : ""}
</section>`;
}

function channelTiles(channels: Channels, schedules: Schedules): Html {
	return each(Object.entries(channels), ([slug, channel]) => channelTile(slug, channel, schedules[channel.id] ?? []));
}

// What links to these pages say of them, where they're shared
const FRONT_PAGE_TEXT = "Serier, film, dokumentarer og direkte TV. Se videre, hvor du slap, gem dine favoritter, og se sammen med andre.";
const LIVE_TEXT = "Direkte TV, med hvad der sendes nu og senere.";
const PICK_TEXT = "Ved du ikke, hvad du vil se? Svar på et par spørgsmål, og få et forslag til en serie, film eller dokumentar.";

/** A button that shares the page: with the phone's share sheet, or by copying its address; see shareLink() in ui.js */
function shareButton(title: string): Html {
	return html`<button type="button" class="button button-secondary js-share-page" data-share-title="${title}">${icon("share")} Del</button>`;
}

export function indexPage(site: Site, {page, featured, shows, channels, schedules, own = [], moreFrom}: {page?: DiscoverPage; featured: Card[]; shows: Show[]; channels: Channels; schedules: Schedules; own?: OwnRow[]; moreFrom?: number}): Html {
	return layout(site, {
		preview: {title: site.serviceName, description: FRONT_PAGE_TEXT},
		bodyClass: featured.length ? "has-hero" : "",
		// For the featured programmes' clips, along with the page instead of after it
		scripts: featured.length ? html`<link href="${LIBRARIES.hls.href}" rel="preload" as="script" integrity="${LIBRARIES.hls.integrity}">` : undefined,
	}, html`<h1 class="visually-hidden">Forside</h1>
${featured.length ? featuredSlides(featured) : html`<section class="intro wrap">
<h2>Serier, film og direkte TV</h2>
<p>Se videre, hvor du slap, saml dine yndlingsserier, og abonnér på dem med RSS.</p>
${searchField()}
</section>`}
<p class="pick-line wrap"><a href="/vaelg/">${icon("dice")}<span>Ved du ikke, hvad du vil se? <strong>Vælg for mig</strong></span></a></p>
<section class="shelf" id="continue-watching" aria-labelledby="continue-title" hidden>
${shelfHead("Se videre", "continue-title")}
<div class="shelf-track js-tiles"></div>
</section>
<section class="shelf" id="leaving-soon" aria-labelledby="leaving-title" hidden>
${shelfHead("Udløber snart", "leaving-title")}
<div class="shelf-track js-tiles"></div>
</section>
<section class="shelf" id="favorites" data-favorites="all" aria-labelledby="favorites-title" hidden>
${shelfHead("Mine favoritter", "favorites-title", "/favoritter/", true)}
<p class="shelf-empty js-favorites-empty">
${icon("heart")}
<span>Tryk på <strong>Favorit</strong> på en serie eller film, så samles de her. De gemmes i din browser, og du kan <a href="/sync/">synkronisere dem mellem dine enheder</a>.</span>
</p>
<div class="shelf-track js-tiles"></div>
</section>
<script>showKeptRows();</script>
${Object.keys(channels).length ? html`<section class="shelf" aria-labelledby="live-title">
${shelfHead("Direkte TV", "live-title")}
<div class="shelf-track">${channelTiles(channels, schedules)}</div>
</section>` : ""}
${shows.length ? html`<section class="shelf" aria-labelledby="recommended-title">
${shelfHead("Anbefalede serier", "recommended-title")}
<div class="shelf-track">${each(shows, show => {
		const episodes = allEpisodes(show);
		return tile({
			href: `/${show.url}/`, image: show.wallpaper, title: show.title,
			meta: show.seasons.length > 1 ? `${show.seasons.length} sæsoner` : `${episodes.length} afsnit`,
			tags: episodes.length > 0 && isNew(episodes.at(-1)!.pubdate) ? [["new", "Nye afsnit"]] : [],
			episodeIds: episodes.map(e => e.videoId), showId: show.url,
		});
	})}</div>
</section>` : ""}
${frontRows(page?.rows ?? [], own)}${page?.more && moreFrom !== undefined ? moreRowsMark(moreFrom) : ""}`);
}

function feedLink(show: Show): Html {
	return html`<link rel="alternate" type="application/rss+xml" title="${show.title}" href="/${show.url}.xml">`;
}

function episodeItem(e: Episode, show: Show): Html {
	return html`<li><a class="episode" href="${e.link}" data-video-id="${e.videoId}">
<div class="tile-media"><img src="${thumbnail(e.wallpaper)}" alt="" loading="lazy"><span class="tile-seen js-seen" hidden>Set</span>${
	e.minutes ? html`<span class="tile-duration">${duration(e.minutes)}</span>` : ""}<span class="tile-play">${icon("play")}</span><div class="tile-progress js-progress" role="progressbar" aria-label="Set indtil videre" aria-valuemin="0" aria-valuemax="100" hidden><span></span></div></div>
<div><h3 class="episode-title">${e.title}</h3>
<p class="meta"><span>${danishDate(e.pubdate)}</span>${e.minutes ? html`<span>${duration(e.minutes)}</span>` : ""}${
	isNew(e.pubdate) ? html`<span class="tag tag-new">Ny</span>` : ""}${
	// When its season leaves before the rest of the series
	e.expires != show.expires ? leaving(e.expires, true) : ""}${e.geoRestricted ? html`<span class="tag tag-geo">Kun i Danmark</span>` : ""}</p>
<p class="episode-desc">${wholeSentences(e.shortDescription)}</p></div>
</a></li>
`;
}

/**
 * A show, with its episodes in order. ui.js makes the seasons into tabs, and selects
 * the season with the episode the play button would play; until then, all are shown.
 * The feed is still linked in the head, for feed readers to find; a button for it can
 * come back as a setting.
 */
export function showPage(site: Site, show: Show): Html {
	const tabs = show.seasons.length > 1;
	return layout(site, {title: show.title, preview: {title: show.title, description: show.description, image: show.wallpaper, type: "video.tv_show"}, head: feedLink(show), bodyClass: "has-hero"}, html`<section class="hero">
<div class="hero-backdrop">${widePicture(show.wallpaper)}</div>
<div class="hero-content">
<h1 class="hero-title${show.title.length > 20 ? " is-long" : ""}">${show.title}</h1>
${showFacts(show)}
<p class="hero-text">${show.description}</p>
${show.nextEpisode ? html`<p class="hero-note">${icon("calendar")} Nyt afsnit ${danishDatetime(show.nextEpisode)}</p>` : ""}
<div class="actions">
${playButton(show)}
${favoriteButton(show.url, show.title, show.wallpaper)}
${shareButton(show.title)}
</div>
</div>
</section>
<section class="seasons" aria-label="Afsnit">
${tabs ? html`<div class="season-tabs" role="tablist" aria-label="Sæsoner" hidden>
${each(show.seasons, (season, i) => html`<button type="button" class="season-tab" role="tab" id="season-tab-${i + 1}" aria-controls="season-${i + 1}" aria-selected="${i == 0 ? "true" : "false"}"${attr("tabindex", i == 0 ? undefined : -1)}>${season.title}</button>`)}
</div>` : ""}
${each(show.seasons, (season, i) => html`<div class="season-panel" id="season-${i + 1}">
${show.seasons.length != 1 ? html`<h2 class="season-title">${season.title}</h2>` : ""}
<ol class="episodes">${each(season.episodes, e => episodeItem(e, show))}</ol>
</div>
`)}
</section>`);
}

/** Shown by progress.js, in the list of a season's episodes, for what the viewer has seen */
const SEEN_LABEL = html`<span class="episode-row-seen js-seen" hidden>Set</span>`;

/** Biograftilstand, as the viewer last left it, before the page is drawn, so it doesn't move; see player.js */
const CINEMA_FIRST = html`<script>try { if (localStorage.getItem("cinema") == "true") document.body.classList.add("cinema"); } catch (error) {}</script>
`;

/** The episode before or after one, for the side of its page */
export interface Neighbour {
	url: string;
	title: string;
	wallpaper?: string;
	minutes?: number;
}

/**
 * The episode before or after one, below it: the one before on the left and quiet, the one after on the right,
 * to go on to, like the player's own "Næste afsnit"
 */
function neighbourLink(kind: "previous" | "next", n: Neighbour | undefined): Html | "" {
	if (n === undefined) {
		return "";
	}
	const label = kind == "next" ? html`Næste afsnit ${icon("chevron-right")}` : html`${icon("chevron-left")} Forrige afsnit`;
	return html`<a class="episode-link episode-${kind}" href="${n.url}" data-video-id="${n.url.split("_").at(-1)!}"${kind == "next" ? html` rel="next"` : html` rel="prev"`}>
<span class="episode-thumb">${n.wallpaper ? html`<img src="${thumbnail(n.wallpaper)}" alt="" loading="lazy">` : ""}${SEEN_MARK}${kind == "next" ? html`<span class="episode-play">${icon("play")}</span>` : ""}${PROGRESS_BAR}</span>
<span class="episode-text"><span class="episode-label">${label}</span><span class="episode-name">${n.title}</span>${n.minutes ? html`<span class="episode-minutes">${duration(n.minutes)}</span>` : ""}</span>
</a>`;
}

/** The episodes of the season that plays, beside the video or below it */
export interface SeasonList {
	title: string;
	// The show's page, with all of them, when the list doesn't have all of them
	all?: string;
	episodes: (Neighbour & {videoId: string; current: boolean})[];
}

// How many of a season's episodes its list beside the video has at most, and how many of them before the one playing
const SEASON_LIST_SIZE = 40;
const SEASON_LIST_BEFORE = 10;

/** The season's episodes around the one playing, for the list beside the video */
export function seasonList(show: Show, season: Season, e: Episode): SeasonList {
	const i = season.episodes.indexOf(e);
	const from = season.episodes.length <= SEASON_LIST_SIZE ? 0 : Math.max(0, Math.min(i - SEASON_LIST_BEFORE, season.episodes.length - SEASON_LIST_SIZE));
	const shown = season.episodes.slice(from, from + SEASON_LIST_SIZE);
	return {
		title: show.seasons.length > 1 ? season.title : "Afsnit",
		all: shown.length < season.episodes.length ? `/${show.url}/` : undefined,
		episodes: shown.map(other => ({url: `/${show.url}/${other.link}`, title: other.title, wallpaper: other.wallpaper, minutes: other.minutes, videoId: other.videoId, current: other === e})),
	};
}

/** The list of the season's episodes, which next.js swaps for the next one's as it plays in the same page */
function seasonAside(season: SeasonList): Html {
	return html`<aside class="episode-list" aria-labelledby="episode-list-title">
<div class="episode-list-head"><h2 class="side-title" id="episode-list-title">${season.title}</h2>${season.all ? html`<a class="episode-list-all" href="${season.all}">Alle afsnit</a>` : ""}</div>
<ol class="episode-rows">
${each(season.episodes, n => html`<li><a class="episode-row" href="${n.url}" data-video-id="${n.videoId}"${attr("aria-current", n.current && "page")}>
<span class="episode-row-thumb">${n.wallpaper ? html`<img src="${thumbnail(n.wallpaper)}" alt="" loading="lazy">` : ""}${PROGRESS_BAR}</span>
<span class="episode-row-text"><span class="episode-row-title">${n.title}</span><span class="episode-row-meta">${n.current ? html`<span class="episode-row-now">Spiller nu</span>` : ""}${n.minutes ? html`<span>${duration(n.minutes)}</span>` : ""}${SEEN_LABEL}</span></span>
</a></li>
`)}</ol>
</aside>`;
}

/** Plays an episode of a show, or a programme on its own, like a film */
export function videoPage(site: Site, {show, e, description, previous, next, segments, season}: {show?: Show; e: Episode | Program; description: string; previous?: Neighbour; next?: Neighbour; segments?: Segments; season?: SeasonList}): Html {
	const film = show === undefined ? (e as Program) : undefined;
	// What was kept of it from before it left DR, when DR doesn't answer
	const over = e.expires !== undefined && e.expires <= clock.now();
	return layout(site, {windowTitle: show ? `${show.title} - ${e.title}` : e.title,
		preview: {title: show ? `${show.title}: ${e.title}` : e.title, description, image: e.wallpaper, type: show ? "video.episode" : "video.other"}, head: show ? feedLink(show) : undefined, scripts: VIDEO_SCRIPTS, bodyClass: season ? "video-page has-episodes" : "video-page"}, html`${CINEMA_FIRST}<div class="stage">
<video id="video" controls crossorigin="anonymous" data-episode-id="${e.videoId}"${attr("data-suggest", show ? `/forslag/serie/${show.url}` : `/forslag/program/${(e as Program).url.split("/").at(-1)}`)}${attr("poster", thumbnail(e.wallpaper, 1280))}${attr("data-next-url", next?.url)}${attr("data-next-title", next?.title)}${attr("data-previous-url", previous?.url)} data-title="${e.title}"${attr("data-show", show?.title)}${attr("data-image", thumbnail(e.wallpaper))}${attr("data-expires", e.expires)}${attr("data-segments", segments ? JSON.stringify(segments) : undefined)}></video>
</div>
<div class="watch">
<div>
${show ? html`<a class="eyebrow" href="/${show.url}/">${icon("chevron-left")} ${show.title}</a>` : ""}
<h1 class="watch-title">${e.title}</h1>
<p class="meta">${e.pubdate ? html`<span>${danishDate(e.pubdate)}</span>` : ""}${e.minutes ? html`<span>${duration(e.minutes)}</span>` : ""}${
	isNew(e.pubdate) ? html`<span class="tag tag-new">Ny</span>` : ""}${leaving(e.expires)}${e.geoRestricted ? html`<span class="tag tag-geo">Kun i Danmark</span>` : ""}</p>
${over ? html`<p class="watch-gone">${icon("alert")} ${show ? "Afsnittet" : "Programmet"} kan ikke længere ses.</p>` : ""}
<p class="description">${wholeSentences(description)}</p>
<div class="actions">
${film ? favoriteButton(film.url.split("/").at(-1)!, e.title, e.wallpaper, {kind: "film"}) : ""}
</div>
${previous || next ? html`<nav class="episode-nav" aria-label="Flere afsnit">
${neighbourLink("previous", previous)}
${neighbourLink("next", next)}
</nav>` : ""}
</div>
</div>
${season ? seasonAside(season) : ""}
${over ? "" : html`<script>
playVideo(document.getElementById('video'), ${scriptJSON(e.videoId)});
</script>`}`);
}

/** One of the channels in the channel guide: what's on it now, how far it's got, and what's next */
function guideChannel(slug: string, channel: LiveChannel, programmes: PlannedProgramme[], current: boolean, number: number): Html {
	const [onNow, later] = whatsOn(programmes);
	const next = later[0];
	const title = channel.title;
	return html`<li><a class="guide-channel" href="/live/${slug}" data-channel="${slug}"${attr("aria-current", current && "page")}${attr("style", channelStyle(slug, channel))}>
<span class="guide-key" aria-hidden="true">${number}</span>
<span class="guide-name">${title}</span>
<span class="guide-now">${onNow ? onNow.title : next ? `Sender igen kl. ${clockTime(next.start)}` : ""}</span>
<span class="guide-progress" aria-hidden="true"${onNow ? "" : html` hidden`}><span style="width: ${onNow ? percentDone(onNow) : 0}%;"></span></span>
<span class="guide-next">${next ? (onNow ? `${clockTime(next.start)} ${next.title}` : next.title) : ""}</span>
</a></li>
`;
}

/** The programmes on a channel, from the one on now; live.js makes them again for another channel */
function programmeItems(programmes: PlannedProgramme[]): Html {
	const [onNow, later] = whatsOn(programmes);
	const shown = (onNow ? [onNow] : []).concat(later.slice(0, 8));
	return each(shown, p => {
		const done = percentDone(p);
		return html`<li class="programme${p === onNow ? " is-now" : ""}" data-start="${isoTime(p.start)}" data-end="${isoTime(p.end)}">
<time class="programme-time" datetime="${isoTime(p.start)}">${clockTime(p.start)}</time>
<div class="programme-body">
<h3 class="programme-title">${p.title}</h3>
<div class="programme-now">
<div class="programme-progress" role="progressbar" aria-label="Sendt indtil videre" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${done}"><span style="width: ${done}%;"></span></div>
<p class="programme-ends">Til ${clockTime(p.end)}</p>
${p.description ? html`<p class="programme-desc">${p.description}</p>` : ""}
</div>
</div>
</li>
`;
	});
}

/**
 * A live channel, with the others in a little guide beside or below the video. Its links are ordinary links,
 * which live.js takes over, to change the channel in the same player, without a new page; it keeps the guide and
 * the programmes up to date from the rest of the day's schedule, which the page has with it.
 */
export function livePage(site: Site, {slug, channels, schedules}: {slug: string; channels: Channels; schedules: Record<string, Programme[]>}): Html {
	const channel = channels[slug];
	const plan = planFrom(channels, schedules);
	const data = {
		channel: slug,
		channels: Object.entries(channels).map(([s, c]) => ({slug: s, title: c.title, stream: c.streamURL, subtitles: c.subtitlesURL ?? null, style: channelStyle(s, c) ?? null})),
		plan,
	};
	const programmes = plan[slug];
	return layout(site, {title: channel.title, preview: {title: channel.title, description: LIVE_TEXT}, scripts: LIVE_SCRIPTS, bodyClass: "live-page"}, html`<div class="stage">
<video id="video" controls crossorigin="anonymous" data-channel="${slug}"></video>
</div>
<nav class="channel-guide" id="channel-guide" aria-label="Kanaler">
<div class="guide-head"><h2 class="guide-title">Kanaler</h2></div>
<ol class="guide-list">
${each(Object.entries(channels), ([other, c], i) => guideChannel(other, c, plan[other], other == slug, i + 1))}
</ol>
</nav>
<div class="watch">
<div>
<div class="badges"><span class="tag tag-live">Direkte</span></div>
<h1 class="watch-title js-live-title">${channel.title}</h1>
<div class="actions">
<button type="button" class="button button-secondary js-live-subtitles" aria-pressed="false"${channel.subtitlesURL ? "" : html` hidden`}>${icon("captions")} Undertekster</button>
</div>
</div>
<section class="schedule" aria-labelledby="schedule-title"${attr("style", channelStyle(slug, channel))}${programmes.length ? "" : html` hidden`}>
<h2 class="side-title" id="schedule-title">Programoversigt</h2>
<ol class="programmes">
${programmeItems(programmes)}</ol>
</section>
</div>
<script type="application/json" id="live-data">${scriptJSON(data)}</script>
<script>
setupChannels(document.getElementById('video'), JSON.parse(document.getElementById('live-data').textContent));
</script>`);
}

function pageHead(title: string): Html {
	return html`<div class="page-head wrap">
<h1>${title}</h1>
</div>`;
}

export function searchPage(site: Site, {query, results}: {query: string; results?: SearchResult}): Html {
	const title = query ? `${query} - Søg` : "Søg";
	if (!query || results === undefined) {
		return layout(site, {title}, html`<div class="empty">
${icon("search")}
<h1>Søg</h1>
<p>Find serier, film og afsnit.</p>
${searchField(undefined, true)}
</div>`);
	}
	const kinds: [string, string, SearchResultItem[]][] = [["Serier", "Serie", results.series], ["Film", "Film", results.movies], ["Afsnit", "Afsnit", results.episodes]];
	const found = kinds.filter(([, , items]) => items.length);
	if (found.length == 0) {
		return layout(site, {title}, html`<div class="empty">
${icon("search")}
<h1>Ingen resultater for „${query}“</h1>
<p>Prøv at stave det anderledes, eller søg efter noget andet.</p>
${searchField(query)}
</div>`);
	}
	return layout(site, {title}, html`${pageHead(`Resultater for „${query}“`)}
${each(found, ([heading, kind, items], i) => html`<section class="results" aria-labelledby="results-${i + 1}">
<h2 class="section-title" id="results-${i + 1}">${heading}</h2>
<div class="tile-grid">${each(items, item => {
		const tags: Tag[] = [["type", kind]];
		if (item.geoRestricted) {
			tags.push(["geo", "Kun i DK"]);
		}
		return tile({
			href: item.url, image: item.wallpaper, title: item.title, tags, description: item.description && wholeSentences(item.description),
			// Films and episodes can be marked as seen; series can't from here
			videoId: kind != "Serie" ? item.url.split("_").at(-1) : undefined,
			showId: kind == "Serie" ? item.url.replace(/^\/+|\/+$/g, "") : undefined,
			filmId: kind == "Film" ? item.url.split("/").at(-1) : undefined,
		});
	})}</div>
</section>
`)}`);
}

export function errorPage(site: Site, {title, message}: {title: string; message: string}): Html {
	return layout(site, {title}, html`<div class="empty">
${icon("alert")}
<h1>${title}</h1>
<p>${message}</p>
${searchField()}
<a class="button button-secondary" href="/">Gå til forsiden</a>
</div>`);
}

/**
 * A series, a programme or an episode that DR doesn't have any more: with the series, for an episode of one that's still
 * there, and something else to see, which catalogue.js finds of the same kind
 */
export function gonePage(site: Site, {kind, show}: {kind: "serie" | "program"; show?: {title: string; url: string}}): Html {
	return layout(site, {title: "Kan ikke længere ses"}, html`<div class="empty">
${icon("alert")}
<h1>Kan ikke længere ses</h1>
<p>${show ? `Afsnittet kan ikke længere ses, men resten af ${show.title} kan måske.` : "Det kan ikke længere ses her. Måske er det udløbet."}</p>
${show ? html`<a class="button button-primary" href="${show.url}">Gå til ${show.title}</a>` : searchField()}
<a class="button button-secondary" href="/">Gå til forsiden</a>
</div>
<section class="shelf js-gone-suggestions" data-kind="${kind}" aria-labelledby="gone-title" hidden>
${shelfHead("Måske noget for dig", "gone-title")}
<div class="shelf-track js-tiles"></div>
</section>`);
}

const PICK_SCRIPT = html`<script src="${staticURL("pick.js")}"></script>`;
const EXPLORE_SCRIPT = html`<script src="${staticURL("explore.js")}"></script>`;

/** What pick.js shows when it has picked something: the programme, and a countdown to it, which can be undone */
function pickResult(): Html {
	return html`<dialog class="pick-result js-pick-result" aria-labelledby="pick-result-title">
<div class="pick-result-media js-pick-result-media"></div>
<div class="pick-result-body">
<p class="pick-result-kind js-pick-result-kind"></p>
<h2 class="pick-result-title" id="pick-result-title"></h2>
<p class="pick-result-countdown js-pick-countdown" aria-live="polite"></p>
<div class="pick-result-actions">
<a class="button button-primary js-pick-go" href="/">${icon("play")} Se nu</a>
<button type="button" class="button button-secondary js-pick-again">${icon("dice")} Slå igen</button>
<button type="button" class="button button-secondary js-pick-cancel">Fortryd</button>
</div>
</div>
</dialog>`;
}

/** "Vælg for mig": a few questions about what DR has, which pick.js asks, with what's left below them */
export function pickPage(site: Site): Html {
	return layout(site, {title: "Vælg for mig", preview: {title: "Vælg for mig", description: PICK_TEXT}, scripts: PICK_SCRIPT}, html`${pageHead("Vælg for mig")}
<section class="pick wrap js-pick" aria-labelledby="pick-question" hidden>
<p class="pick-step js-pick-step"></p>
<h2 class="pick-question js-pick-question" id="pick-question" tabindex="-1"></h2>
<div class="pick-answers js-pick-answers" role="group" aria-labelledby="pick-question"></div>
<div class="pick-actions">
<button type="button" class="button button-primary js-pick-surprise">${icon("dice")} Overrask mig</button>
<button type="button" class="button button-secondary js-pick-back" hidden>${icon("chevron-left")} Tilbage</button>
<button type="button" class="button button-secondary js-pick-restart" hidden>Start forfra</button>
</div>
<p class="pick-count js-pick-count" aria-live="polite"></p>
</section>
<p class="wrap pick-loading js-pick-loading">Henter titler …</p>
<div class="tile-grid results js-pick-tiles"></div>
${pickResult()}
<noscript><p class="wrap">Vælg for mig kræver JavaScript.</p></noscript>`);
}

export function categoriesPage(site: Site, categories: Category[]): Html {
	// Serier, Film and Dokumentar first, which small screens' tabs lead here for
	const rank = (c: Category) => {
		const i = MAIN_CATEGORIES.indexOf(c.url);
		return i < 0 ? MAIN_CATEGORIES.length : i;
	};
	const sorted = categories.map((c, i) => ({c, i})).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(({c}) => c);
	return layout(site, {title: "Kategorier"}, html`${pageHead("Kategorier")}
<a class="pick-promo wrap" href="/vaelg/">${icon("dice")}<span><strong>Vælg for mig</strong> Ved du ikke, hvad du vil se? Svar på et par spørgsmål, eller lad terningen bestemme.</span></a>
<a class="pick-promo wrap" href="/alle/">${icon("filter")}<span><strong>Alle titler</strong> Find blandt alle serier, film og dokumentarer, efter genre, stemning, emne, land, årti og længde.</span></a>
<ul class="category-grid wrap">
${each(sorted, c => html`<li><a class="category" href="${c.url}"><span class="category-mark" aria-hidden="true">${[...c.title][0] ?? ""}</span><span class="category-title">${c.title}</span></a></li>\n`)}
</ul>`);
}

export function categoryPage(site: Site, {category, page, all}: {category: Category; page: DiscoverPage; all?: string}): Html {
	return layout(site, {title: category.title, preview: {title: category.title, description: `Serier, film og programmer under ${category.title}, samlet i rækker.`}, scripts: page.rows.length ? PICK_SCRIPT : undefined}, html`<div class="page-head wrap">
<h1>${category.title}</h1>${all || page.rows.length ? html`
<div class="page-actions">${all ? html`<a class="button button-secondary" href="${all}">${icon("filter")} Alle titler</a>` : ""}${page.rows.length ? html`
<button type="button" class="button button-secondary js-pick-surprise" hidden>${icon("dice")} Overrask mig</button>` : ""}</div>` : ""}
</div>
${page.rows.length ? html`${rows(page.rows)}
${pickResult()}` : html`<p class="wrap">Der er ikke noget i denne kategori lige nu.</p>`}`);
}

const ALL_TEXT = "Alle serier, film og dokumentarer, efter genre, stemning, emne, land, årti og længde.";

// How Alle titler can be sorted, which explore.js does
const SORTS: [string, string][] = [
	["anbefalet", "Anbefalet"], ["nyeste", "Nyeste"], ["udloeber", "Udløber snart"], ["titel", "Titel, A-Å"], ["aar", "Årstal, nyeste"], ["laengde", "Længde, korteste"],
];

/** Alle titler: all of the catalogue, with its filters, which explore.js shows and reads from the address */
export function allPage(site: Site): Html {
	return layout(site, {title: "Alle titler", preview: {title: "Alle titler", description: ALL_TEXT}, scripts: EXPLORE_SCRIPT}, html`${pageHead("Alle titler")}
<section class="explore wrap js-explore" aria-label="Find blandt alle titler" hidden>
<div class="explore-bar">
<div class="list-filter-search explore-search">${icon("search")}<input type="search" class="list-filter-field js-explore-search" placeholder="Find en titel, et emne eller en person" aria-label="Find en titel, et emne eller en person" enterkeyhint="search"></div>
<label class="explore-sort"><span>Sortér efter</span><select class="form-select js-explore-sort">${each(SORTS, ([id, label]) => html`<option value="${id}">${label}</option>`)}</select></label>
<button type="button" class="button button-secondary explore-toggle js-explore-toggle" aria-expanded="false" aria-controls="explore-filters">${icon("filter")} Filtre<span class="filter-count js-explore-active-count"></span></button>
</div>
<div class="explore-chosen js-explore-chosen" aria-label="Valgte filtre"></div>
<div class="explore-filters js-explore-filters" id="explore-filters"></div>
<p class="explore-count js-explore-count" role="status"></p>
</section>
<p class="wrap pick-loading js-explore-loading">Henter titler …</p>
<div class="tile-grid results js-explore-tiles"></div>
<div class="wrap explore-more"><button type="button" class="button button-secondary js-explore-more" hidden>Vis flere</button></div>
<noscript><p class="wrap">Alle titler kræver JavaScript.</p></noscript>`);
}

export function listPage(site: Site, {title, cards}: {title: string; cards: Card[]}): Html {
	return layout(site, {title}, html`${pageHead(title)}
<div class="tile-grid results">${each(cards, cardTile)}</div>`);
}

/** The favourites page's filter, which favorites.js shows once there are enough favourites of more than one kind */
function favoriteFilters(): Html {
	return html`<div class="favorite-filters wrap js-favorite-filters" role="group" aria-label="Vis" hidden>
${each([["alle", "Alle"], ["serier", "Serier"], ["film", "Film"], ["dokumentar", "Dokumentar"]], ([filter, name]) =>
	html`<button type="button" class="filter-button" data-filter="${filter}" aria-pressed="${filter == "alle" ? "true" : "false"}">${name} <span class="filter-count"></span></button>
`)}</div>
<p class="shelf-empty js-filter-empty" hidden>${icon("heart")}<span class="js-filter-empty-text"></span></p>`;
}

/** The viewer's favourites, series and films together, filled in by favorites.js and progress.js from their browser */
export function favoritesPage(site: Site): Html {
	return layout(site, {title: "Favoritter"}, html`${pageHead("Favoritter")}
${favoriteFilters()}
<section class="results" id="favorite-list" data-favorites="all" aria-label="Dine favoritter" hidden>
<p class="shelf-empty js-favorites-empty">
${icon("heart")}
<span>Tryk på <strong>Favorit</strong> på en serie eller film, så samles de her. De gemmes i din browser, og du kan <a href="/sync/">synkronisere dem mellem dine enheder</a>.</span>
</p>
<div class="tile-grid js-tiles"></div>
</section>
<noscript><p class="wrap">Favoritter kræver JavaScript.</p></noscript>`);
}

/** What's new for the viewer, which the bell in the header opens on phones: filled in by news.js */
export function newsPage(site: Site): Html {
	return layout(site, {title: "Nyt til dig"}, html`${pageHead("Nyt til dig")}
<div class="news-page wrap">
<div class="news js-news" id="news-page" data-full></div>
<noscript><p>Nyt til dig kræver JavaScript.</p></noscript>
</div>`);
}

/** The viewer's account, which is their sync code. Made to work by sync.js and account.js. */
export function syncPage(site: Site): Html {
	return layout(site, {title: "Din konto"}, html`<div class="sync-page wrap" id="sync-page">
<h1>Din konto</h1>
<p class="sync-intro">Med en konto har du de samme favoritter på din telefon, computer og TV, og du kan se videre, hvor du slap. Den kræver hverken e-mail eller adgangskode.</p>
<div class="sync-options js-sync-off" hidden>
<section class="sync-option" aria-labelledby="sync-new">
<h2 id="sync-new">Ny konto</h2>
<p>Du får en kode, som du logger ind med på dine andre enheder.</p>
<button type="button" class="button button-primary js-sync-create">Opret en konto</button>
</section>
<section class="sync-option js-passkey-login" aria-labelledby="sync-passkey" hidden>
<h2 id="sync-passkey">Har du en adgangsnøgle?</h2>
<p>Log ind med den adgangsnøgle, du har oprettet på en anden enhed.</p>
<button type="button" class="button button-secondary js-passkey-login-button">${icon("key")} Log ind med adgangsnøgle</button>
</section>
<form class="sync-option js-sync-join" aria-labelledby="sync-join">
<h2 id="sync-join">Har du en kode?</h2>
<p>Skriv koden fra din anden enhed.</p>
<label class="visually-hidden" for="sync-code">Kode</label>
<input class="code-input" id="sync-code" name="code" placeholder="ABCD-EFGH-JKMN-PQRS" autocomplete="off" autocapitalize="characters" spellcheck="false" required>
<button type="submit" class="button button-secondary">Log ind</button>
</form>
</div>
<div class="js-sync-on" hidden>
<section aria-labelledby="sync-code-title">
<h2 class="sync-label" id="sync-code-title">Din kode</h2>
<p class="sync-code js-sync-code"></p>
<p class="meta js-sync-status"></p>
<div class="actions">
<button type="button" class="button button-secondary js-sync-copy">Kopiér koden</button>
<button type="button" class="button button-secondary js-sync-now">Synkroniser nu</button>
</div>
</section>
<section class="account-section js-alerts" aria-labelledby="alerts-title" hidden>
<h2 id="alerts-title">Notifikationer på denne enhed</h2>
<p class="js-alerts-status">Klokken viser altid nye afsnit her på siden. Slå notifikationer til for også at få dem på denne enhed, når siden er lukket.</p>
<p class="js-alerts-home-screen" hidden>På iPhone og iPad skal siden først føjes til hjemmeskærmen: tryk på Del og derefter Føj til hjemmeskærm. Åbn den så derfra, og slå notifikationer til her.</p>
<div class="actions">
<button type="button" class="button button-primary js-alerts-toggle" aria-pressed="false">${icon("bell")}<span> Slå notifikationer til</span></button>
</div>
</section>
<section class="account-section js-passkeys" aria-labelledby="passkeys-title" hidden>
<h2 id="passkeys-title">Adgangsnøgler</h2>
<p>Med en adgangsnøgle logger du ind på dine andre enheder uden koden. Den gemmes på enheden, eller i din adgangskodeadministrator, som iCloud-nøglering eller Google Adgangskodeadministrator.</p>
<ul class="passkey-list js-passkey-list" hidden></ul>
<div class="actions">
<button type="button" class="button button-secondary js-passkey-create">${icon("key")} Opret en adgangsnøgle</button>
</div>
</section>
<section class="account-section js-contribute" aria-labelledby="contribute-title" hidden>
<h2 id="contribute-title">Spring intro og rulletekster over</h2>
<p>Knapperne Spring intro over og Næste afsnit findes, fordi seerne selv markerer, hvor intro og rulletekster er. Slå det til, så kan du også markere dem, når du ser noget på en computer. En markering bruges, når flere er enige om den.</p>
<label class="switch"><input type="checkbox" class="js-contribute-toggle"><span>Hjælp med at markere intro og rulletekster</span></label>
</section>
<div class="actions account-end">
<button type="button" class="button button-quiet js-sync-stop">Log ud på denne enhed</button>
<button type="button" class="button button-quiet js-sync-delete">Slet din konto</button>
</div>
<section class="account-confirm js-sync-delete-confirm" role="alertdialog" aria-labelledby="delete-title" aria-describedby="delete-text" tabindex="-1" hidden>
<h2 id="delete-title">Slet din konto?</h2>
<p id="delete-text">Dine favoritter, hvor langt du er nået, dine notifikationer, adgangsnøgler og markeringer af intro og rulletekster slettes fra serveren. Det kan ikke fortrydes, og koden kan ikke bruges igen. Det, der er gemt på denne enhed, bliver her.</p>
<label class="switch"><input type="checkbox" class="js-sync-delete-sure"><span>Jeg forstår, at kontoen ikke kan gendannes</span></label>
<div class="actions">
<button type="button" class="button button-primary js-sync-delete-yes" disabled>Slet kontoen for altid</button>
<button type="button" class="button button-secondary js-sync-delete-no">Annullér</button>
</div>
</section>
</div>
<section class="account-section" aria-labelledby="playback-title">
<h2 id="playback-title">Afspilning</h2>
<p>Når et afsnit slutter, starter det næste efter en nedtælling. Slået fra, tilbydes det næste afsnit stadig, men uden nedtælling. Valget gemmes på denne enhed.</p>
<label class="switch"><input type="checkbox" class="js-autoplay-toggle" checked><span>Afspil næste afsnit automatisk</span></label>
</section>
<p class="sync-error js-sync-error" role="alert" hidden></p>
<p class="sync-privacy">Din konto er koden. Under den gemmes dine favoritter, hvor langt du er nået i hvert afsnit, og hvilke af dine enheder der får notifikationer. Alle med koden kan se og ændre dem, så giv den kun til dine egne enheder. Uden en konto gemmes de kun i din browser.</p>
<noscript><p>Din konto kræver JavaScript.</p></noscript>
</div>`);
}

/** What the site keeps about its viewers, and where; drtvrss/templates/privacy.html says the same of the Python app */
export function privacyPage(site: Site): Html {
	return layout(site, {title: "Privatliv"}, html`<article class="prose wrap">
<h1>Privatliv</h1>
<p class="prose-lead">${site.serviceName} har ingen reklamer og ingen sporing. Siden bruger ingen analyseværktøjer, og den sælger eller deler ikke noget om dig. Her er alt, hvad den gemmer, og hvor.</p>

<h2>I din browser</h2>
<p>Det meste gemmes kun på din egen enhed, i browserens lager. Det forlader ikke enheden, medmindre du opretter en konto.</p>
<ul>
<li>Dine favoritter, og hvor langt du er nået i det, du ser, og hvad serverens svar om dine favoritter sidst var, som nye afsnit, så det ikke skal hentes på hver side.</li>
<li>Hvilke afsnit du har åbnet fra klokken, Nyt til dig, og hvornår du sidst ryddede den, så den kun viser det, du ikke har set.</li>
<li>Dine valg: om næste afsnit afspilles automatisk, undertekster til direkte TV, om sete afsnit skjules, afspillerens lydstyrke, hastighed og undertekster, og dit navn i Se sammen.</li>
<li>Om du har valgt at markere intro og rulletekster, og dem, du selv har markeret.</li>
<li>Hvad Vælg for mig sidst spurgte om og foreslog, så det ikke er det samme hver gang.</li>
<li>Din kode, hvis du har en konto.</li>
<li>Så længe fanen er åben: det rum, du ser sammen med andre i.</li>
<li>Programmernes billeder og listen over alle titler, så siderne åbner hurtigere.</li>
<li>Den kanal, du sidst så, i en cookie, så Direkte åbner den igen. Det er sidens eneste cookie: den bruges kun til at åbne kanalen, og den hverken sendes videre eller gemmes på serveren.</li>
</ul>
<p>Du sletter det hele ved at slette sidens data i din browser.</p>

<h2>Hvis du har en konto</h2>
<p>En konto er en kode. Den kræver hverken e-mail, navn eller adgangskode. Under koden gemmes på serveren:</p>
<ul>
<li>Dine favoritter, hvor langt du er nået, og hvornår du sidst ryddede klokken, så dine enheder kan dele dem.</li>
<li>Dine adgangsnøgler, hvis du opretter nogen: nøglens offentlige del, og hvilken slags enhed den blev lavet på, som "Firefox på Android".</li>
<li>Hvis du slår notifikationer om nye afsnit til: den adresse, din browsers beskedtjeneste (som Googles, Mozillas eller Apples) har givet enheden, og hvilke af dine serier der skal følges. Notifikationerne er krypteret, så beskedtjenesten ikke kan læse dem.</li>
<li>De intro og rulletekster, du markerer, og om du har fundet andres markeringer forkerte. Kun tidspunkterne i videoen.</li>
</ul>
<p>Det gemmes, indtil du sletter kontoen. Det kan du gøre under <a href="/sync/">Din konto</a>, og så slettes alt, der hører til koden.</p>

<h2>Se sammen</h2>
<p>Et rum kender kun det, der ses, hvor langt det er nået, og om det spiller, og så længe I er forbundet de navne, I selv skriver. I chatten husker rummet de sidste 20 beskeder med navn og tidspunkt, så de, der kommer til, kan læse med. Rummet slettes med sine beskeder seks timer efter, at den sidste har forladt det.</p>

<h2>DR</h2>
<p>Videoerne, underteksterne og billederne kommer direkte fra DR's servere til din browser, ligesom på DRTV. DR får derfor din IP-adresse og oplysninger om din browser, og DR's egne regler for privatliv gælder for det. Din browser fortæller ikke DR, at du kom fra ${site.serviceName}.</p>

<h2>Driften</h2>
<p>Siden kører hos Cloudflare. Som enhver webserver ser Cloudflare din IP-adresse og browser, når den sender dig siderne, og bruger dem til at beskytte siden mod misbrug. Siden gemmer en log over forespørgslerne (adresse, tidspunkt, svar og fejl) i op til tre dage, for at kunne finde fejl.</p>
<p>Skrifttyper og biblioteker kommer fra siden selv, ikke fra andre.</p>

<h2>Spørgsmål</h2>
<p>Koden bag siden er åben, så du kan se præcis, hvad den gør. Spørgsmål kan stilles på <a href="${site.sourceURL}">siden med kildekoden</a>.</p>
</article>`);
}
