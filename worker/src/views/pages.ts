// The pages

import type {Card, Category, DiscoverPage, Row} from "../discover";
import {type Channels, percentDone, type Programme, whatsOn} from "../live";
import type {SearchResult, SearchResultItem} from "../search";
import type {Segments} from "../segments";
import {allEpisodes, type Episode, type Program, type Show, thumbnail} from "../show";
import {clockTime, danishDate, danishDatetime, duration, isNew, isoTime} from "../time";
import {attr, each, html, type Html, scriptJSON} from "./html";
import {layout, LIBRARIES, MAIN_CATEGORIES, PLAYER_SCRIPTS, type Site, VIDEO_SCRIPTS} from "./layout";
import {cardTile, channelTile, favoriteButton, icon, leaving, moreLink, playButton, PROGRESS_BAR, searchField, SEEN_MARK, shelfHead, showFacts, type Tag, tile, widePicture} from "./ui";

type Schedules = Record<string, Programme[]>;

function rows(found: Row[]): Html {
	return each(found, (row, i) => html`<section class="shelf" aria-labelledby="row-${i + 1}">
${shelfHead(row.title, `row-${i + 1}`, moreLink(row), row.complete)}
<div class="shelf-track">${each(row.cards, cardTile)}</div>
</section>
`);
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
${c.showId ? favoriteButton(c.showId, c.title, c.image) : ""}
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

export function indexPage(site: Site, {page, featured, shows, channels, schedules}: {page?: DiscoverPage; featured: Card[]; shows: Show[]; channels: Channels; schedules: Schedules}): Html {
	return layout(site, {
		bodyClass: featured.length ? "has-hero" : "",
		// For the featured programmes' clips, along with the page instead of after it
		scripts: featured.length ? html`<link href="${LIBRARIES.hls.href}" rel="preload" as="script" integrity="${LIBRARIES.hls.integrity}">` : undefined,
	}, html`<h1 class="visually-hidden">Forside</h1>
${featured.length ? featuredSlides(featured) : html`<section class="intro wrap">
<h2>Serier, film og direkte TV</h2>
<p>Fortsæt hvor du slap, saml dine yndlingsserier, og abonnér på dem med RSS.</p>
${searchField()}
</section>`}
<section class="shelf" id="continue-watching" aria-labelledby="continue-title" hidden>
${shelfHead("Fortsæt med at se", "continue-title", "/favoritter/#continue-watching", true)}
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
${Object.keys(channels).length ? html`<section class="shelf" aria-labelledby="live-title">
${shelfHead("Direkte TV", "live-title", "/live/", true)}
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
${page ? rows(page.rows) : ""}`);
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
<p class="episode-desc">${e.shortDescription}</p></div>
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
	return layout(site, {title: show.title, head: feedLink(show), bodyClass: "has-hero"}, html`<section class="hero">
<div class="hero-backdrop">${widePicture(show.wallpaper)}</div>
<div class="hero-content">
<h1 class="hero-title${show.title.length > 20 ? " is-long" : ""}">${show.title}</h1>
${showFacts(show)}
<p class="hero-text">${show.description}</p>
${show.nextEpisode ? html`<p class="hero-note">${icon("calendar")} Nyt afsnit ${danishDatetime(show.nextEpisode)}</p>` : ""}
<div class="actions">
${playButton(show)}
${favoriteButton(show.url, show.title, show.wallpaper)}
<a href="https://www.dr.dk/drtv/serie/${show.url}" class="button button-quiet">Se originalen ${icon("external")}</a>
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

/** Plays an episode of a show, or a programme on its own, like a film */
export function videoPage(site: Site, {show, e, description, previous, next, segments}: {show?: Show; e: Episode | Program; description: string; previous?: Neighbour; next?: Neighbour; segments?: Segments}): Html {
	const film = show === undefined ? (e as Program) : undefined;
	return layout(site, {windowTitle: show ? `${show.title} - ${e.title}` : e.title, head: show ? feedLink(show) : undefined, scripts: VIDEO_SCRIPTS}, html`<div class="stage">
<video id="video" controls crossorigin="anonymous"${attr("poster", thumbnail(e.wallpaper, 1280))}${attr("data-next-url", next?.url)}${attr("data-next-title", next?.title)}${attr("data-previous-url", previous?.url)} data-title="${e.title}"${attr("data-show", show?.title)}${attr("data-image", thumbnail(e.wallpaper))}${attr("data-expires", e.expires)}${attr("data-segments", segments ? JSON.stringify(segments) : undefined)}></video>
</div>
<div class="watch">
<div>
${show ? html`<a class="eyebrow" href="/${show.url}/">${icon("chevron-left")} ${show.title}</a>` : ""}
<h1 class="watch-title">${e.title}</h1>
<p class="meta">${e.pubdate ? html`<span>${danishDate(e.pubdate)}</span>` : ""}${e.minutes ? html`<span>${duration(e.minutes)}</span>` : ""}${
	isNew(e.pubdate) ? html`<span class="tag tag-new">Ny</span>` : ""}${leaving(e.expires)}${e.geoRestricted ? html`<span class="tag tag-geo">Kun i Danmark</span>` : ""}</p>
<p class="description">${description}</p>
<div class="actions">
${film ? favoriteButton(film.url.split("/").at(-1)!, e.title, e.wallpaper, {kind: "film"}) : ""}
<a class="button button-quiet" href="https://www.dr.dk/drtv${e.url}">Se originalen ${icon("external")}</a>
</div>
${previous || next ? html`<nav class="episode-nav" aria-label="Flere afsnit">
${neighbourLink("previous", previous)}
${neighbourLink("next", next)}
</nav>` : ""}
</div>
</div>
<script>
playVideo(document.getElementById('video'), ${scriptJSON(e.videoId)});
</script>`);
}

/** A live channel. ui.js keeps the programmes up to date while the page is open, without reloading the stream. */
export function livePage(site: Site, {slug, channels, programmes}: {slug: string; channels: Channels; programmes: Programme[]}): Html {
	const channel = channels[slug];
	const [onNow, later] = whatsOn(programmes);
	const shown = (onNow ? [onNow] : []).concat(later.slice(0, 8));
	return layout(site, {title: channel.title, scripts: PLAYER_SCRIPTS}, html`<div class="stage">
<video id="video" controls crossorigin="anonymous"></video>
</div>
<div class="watch">
<div>
<div class="badges"><span class="tag tag-live">Direkte</span></div>
<h1 class="watch-title">${channel.title}</h1>
<nav class="channel-switcher" aria-label="Kanaler">
${each(Object.entries(channels), ([other, c]) => html`<a href="/live/${other}" class="nav-item"${attr("aria-current", other == slug && "page")}><span class="live-dot"></span>${c.title}</a>\n`)}
</nav>
${channel.subtitlesURL ? html`<div class="actions">
<button type="button" class="button button-secondary js-live-subtitles" aria-pressed="false">${icon("captions")} Undertekster</button>
</div>` : ""}
</div>
${shown.length ? html`<section class="schedule" aria-labelledby="schedule-title">
<h2 class="side-title" id="schedule-title">Programoversigt</h2>
<ol class="programmes">
${each(shown, p => {
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
	})}
</ol>
</section>` : ""}
</div>
<script>
setupLive(document.getElementById('video'), ${scriptJSON(channel.streamURL)}, ${scriptJSON(channel.subtitlesURL ?? null)});
</script>`);
}

function pageHead(title: string): Html {
	return html`<div class="page-head wrap">
<h1>${title}</h1>
</div>`;
}

export function liveIndexPage(site: Site, {channels, schedules}: {channels: Channels; schedules: Schedules}): Html {
	return layout(site, {title: "Direkte TV"}, html`${pageHead("Direkte TV")}
<div class="tile-grid results">${channelTiles(channels, schedules)}</div>`);
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
			href: item.url, image: item.wallpaper, title: item.title, tags, description: item.description,
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

export function categoriesPage(site: Site, categories: Category[]): Html {
	// Serier, Film and Dokumentar first, which small screens' tabs lead here for
	const rank = (c: Category) => {
		const i = MAIN_CATEGORIES.indexOf(c.url);
		return i < 0 ? MAIN_CATEGORIES.length : i;
	};
	const sorted = categories.map((c, i) => ({c, i})).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(({c}) => c);
	return layout(site, {title: "Kategorier"}, html`${pageHead("Kategorier")}
<ul class="category-grid wrap">
${each(sorted, c => html`<li><a class="category" href="${c.url}"><span class="category-mark" aria-hidden="true">${[...c.title][0] ?? ""}</span><span class="category-title">${c.title}</span></a></li>\n`)}
</ul>`);
}

export function categoryPage(site: Site, {category, page}: {category: Category; page: DiscoverPage}): Html {
	return layout(site, {title: category.title}, html`${pageHead(category.title)}
${page.rows.length ? rows(page.rows) : html`<p class="wrap">Der er ikke noget i denne kategori lige nu.</p>`}`);
}

export function listPage(site: Site, {title, cards}: {title: string; cards: Card[]}): Html {
	return layout(site, {title}, html`${pageHead(title)}
<div class="tile-grid results">${each(cards, cardTile)}</div>`);
}

/** Filled in by favorites.js and progress.js, from the viewer's browser */
export function favoritesPage(site: Site): Html {
	return layout(site, {title: "Favoritter"}, html`${pageHead("Favoritter")}
<section class="results" id="favorite-shows" data-favorites="show" aria-labelledby="favorite-shows-title" hidden>
<h2 class="section-title" id="favorite-shows-title">Serier</h2>
<p class="shelf-empty js-favorites-empty">
${icon("heart")}
<span>Tryk på <strong>Favorit</strong> på en serie, så samles dine serier her. De gemmes i din browser, og du kan <a href="/sync/">synkronisere dem mellem dine enheder</a>.</span>
</p>
<div class="tile-grid js-tiles"></div>
</section>
<section class="results" id="favorite-films" data-favorites="film" aria-labelledby="favorite-films-title" hidden>
<h2 class="section-title" id="favorite-films-title">Film</h2>
<p class="shelf-empty js-favorites-empty">
${icon("heart")}
<span>Tryk på <strong>Favorit</strong> på en film, så den er her, når du vil se den.</span>
</p>
<div class="tile-grid js-tiles"></div>
</section>
<section class="results" id="continue-watching" aria-labelledby="continue-title" hidden>
<h2 class="section-title" id="continue-title">Fortsæt med at se</h2>
<div class="tile-grid js-tiles"></div>
</section>
<noscript><p class="wrap">Favoritter kræver JavaScript.</p></noscript>`);
}

/** The viewer's account, which is their sync code. Made to work by sync.js and account.js. */
export function syncPage(site: Site): Html {
	return layout(site, {title: "Din konto"}, html`<div class="sync-page wrap" id="sync-page">
<h1>Din konto</h1>
<p class="sync-intro">Med en konto har du de samme favoritter på din telefon, computer og TV, og du kan fortsætte, hvor du slap. Den kræver hverken e-mail eller adgangskode.</p>
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
<h2 id="alerts-title">Beskeder om nye afsnit</h2>
<p class="js-alerts-status">Få en besked på denne enhed, når en af dine favoritserier får et nyt afsnit.</p>
<p class="js-alerts-home-screen" hidden>På iPhone og iPad skal siden først føjes til hjemmeskærmen: tryk på Del og derefter Føj til hjemmeskærm. Åbn den så derfra, og slå beskeder til her.</p>
<div class="actions">
<button type="button" class="button button-primary js-alerts-toggle" aria-pressed="false">${icon("bell")}<span> Slå beskeder til</span></button>
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
<h2 id="contribute-title">Intro og rulletekster</h2>
<p>Vil du hjælpe andre med at springe introer over? Slå det til, så kan du markere, hvor intro og rulletekster starter og slutter, når du ser noget på en computer. En markering bruges, når flere er enige om den.</p>
<label class="switch"><input type="checkbox" class="js-contribute-toggle"><span>Bidrag med intro og rulletekster</span></label>
</section>
<div class="actions account-end">
<button type="button" class="button button-quiet js-sync-stop">Log ud på denne enhed</button>
<button type="button" class="button button-quiet js-sync-delete">Slet din konto</button>
</div>
<section class="account-confirm js-sync-delete-confirm" role="alertdialog" aria-labelledby="delete-title" aria-describedby="delete-text" tabindex="-1" hidden>
<h2 id="delete-title">Slet din konto?</h2>
<p id="delete-text">Dine favoritter, hvor langt du er nået, dine beskeder, adgangsnøgler og markeringer af intro og rulletekster slettes fra serveren. Det kan ikke fortrydes, og koden kan ikke bruges igen. Det, der er gemt på denne enhed, bliver her.</p>
<label class="switch"><input type="checkbox" class="js-sync-delete-sure"><span>Jeg forstår, at kontoen ikke kan gendannes</span></label>
<div class="actions">
<button type="button" class="button button-primary js-sync-delete-yes" disabled>Slet kontoen for altid</button>
<button type="button" class="button button-secondary js-sync-delete-no">Annullér</button>
</div>
</section>
</div>
<p class="sync-error js-sync-error" role="alert" hidden></p>
<p class="sync-privacy">Din konto er koden. Under den gemmes dine favoritter, hvor langt du er nået i hvert afsnit, og hvilke af dine enheder der får beskeder. Alle med koden kan se og ændre dem, så giv den kun til dine egne enheder. Uden en konto gemmes de kun i din browser.</p>
<noscript><p>Din konto kræver JavaScript.</p></noscript>
</div>`);
}

/** What the site keeps about its viewers, and where; drtvrss/templates/privacy.html says the same of the Python app */
export function privacyPage(site: Site): Html {
	return layout(site, {title: "Privatliv"}, html`<article class="prose wrap">
<h1>Privatliv</h1>
<p class="prose-lead">${site.serviceName} har ingen reklamer, ingen cookies og ingen sporing. Siden bruger ingen analyseværktøjer, og den sælger eller deler ikke noget om dig. Her er alt, hvad den gemmer, og hvor.</p>

<h2>I din browser</h2>
<p>Det meste gemmes kun på din egen enhed, i browserens lager. Det forlader ikke enheden, medmindre du opretter en konto.</p>
<ul>
<li>Dine favoritter, og hvor langt du er nået i det, du ser.</li>
<li>Dine valg: undertekster til direkte TV, om sete afsnit skjules, afspillerens lydstyrke, hastighed og undertekster, og dit navn i Se sammen.</li>
<li>Om du har valgt at markere intro og rulletekster, og dem, du selv har markeret.</li>
<li>Din kode, hvis du har en konto.</li>
<li>Så længe fanen er åben: det rum, du ser sammen med andre i.</li>
<li>Programmernes billeder, så siderne åbner hurtigere.</li>
</ul>
<p>Du sletter det hele ved at slette sidens data i din browser.</p>

<h2>Hvis du har en konto</h2>
<p>En konto er en kode. Den kræver hverken e-mail, navn eller adgangskode. Under koden gemmes på serveren:</p>
<ul>
<li>Dine favoritter, og hvor langt du er nået, så dine enheder kan dele dem.</li>
<li>Dine adgangsnøgler, hvis du opretter nogen: nøglens offentlige del, og hvilken slags enhed den blev lavet på, som "Firefox på Android".</li>
<li>Hvis du slår beskeder om nye afsnit til: den adresse, din browsers beskedtjeneste (som Googles, Mozillas eller Apples) har givet enheden, og hvilke af dine serier der skal følges. Beskederne er krypteret, så beskedtjenesten ikke kan læse dem.</li>
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
