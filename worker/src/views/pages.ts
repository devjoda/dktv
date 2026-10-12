// The pages

import type {Card, Category, DiscoverPage, Row} from "../discover";
import {type Channels, percentDone, type Programme, whatsOn} from "../live";
import type {SearchResult, SearchResultItem} from "../search";
import {allEpisodes, type Episode, type Program, type Show, thumbnail} from "../show";
import {clockTime, danishDate, danishDatetime, duration, isNew, isoTime} from "../time";
import {attr, each, html, type Html, scriptJSON} from "./html";
import {layout, LIBRARIES, PLAYER_SCRIPTS, type Site} from "./layout";
import {cardTile, channelTile, favoriteButton, icon, moreLink, playButton, searchField, shelfHead, showFacts, type Tag, tile, widePicture} from "./ui";

type Schedules = Record<string, Programme[]>;

function rows(found: Row[]): Html {
	return each(found, (row, i) => html`<section class="shelf" aria-labelledby="row-${i + 1}">
${shelfHead(row.title, `row-${i + 1}`, moreLink(row))}
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
<h2>DR's serier, film og direkte TV</h2>
<p>Fortsæt hvor du slap, saml dine yndlingsserier, og abonnér på dem med RSS.</p>
${searchField()}
</section>`}
<section class="shelf" id="continue-watching" aria-labelledby="continue-title" hidden>
${shelfHead("Fortsæt med at se", "continue-title")}
<div class="shelf-track js-tiles"></div>
</section>
<section class="shelf" id="favorites" data-favorites="all" aria-labelledby="favorites-title" hidden>
${shelfHead("Mine favoritter", "favorites-title")}
<p class="shelf-empty js-favorites-empty">
${icon("heart")}
<span>Tryk på <strong>Favorit</strong> på en serie eller film, så samles de her. De gemmes i din browser, og du kan <a href="/sync/">synkronisere dem mellem dine enheder</a>.</span>
</p>
<div class="shelf-track js-tiles"></div>
</section>
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
${page ? rows(page.rows) : ""}`);
}

function feedLink(show: Show): Html {
	return html`<link rel="alternate" type="application/rss+xml" title="${show.title}" href="/${show.url}.xml">`;
}

function episodeItem(e: Episode): Html {
	return html`<li><a class="episode" href="${e.link}" data-video-id="${e.videoId}">
<div class="tile-media"><img src="${thumbnail(e.wallpaper)}" alt="" loading="lazy"><span class="tile-seen js-seen" hidden>Set</span>${
	e.minutes ? html`<span class="tile-duration">${duration(e.minutes)}</span>` : ""}<span class="tile-play">${icon("play")}</span><div class="tile-progress js-progress" role="progressbar" aria-label="Set indtil videre" aria-valuemin="0" aria-valuemax="100" hidden><span></span></div></div>
<div><h3 class="episode-title">${e.title}</h3>
<p class="meta"><span>${danishDate(e.pubdate)}</span>${e.minutes ? html`<span>${duration(e.minutes)}</span>` : ""}${
	isNew(e.pubdate) ? html`<span class="tag tag-new">Ny</span>` : ""}${e.geoRestricted ? html`<span class="tag tag-geo">Kun i Danmark</span>` : ""}</p>
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
<a href="https://www.dr.dk/drtv/serie/${show.url}" class="button button-quiet">Vis på DRTV ${icon("external")}</a>
</div>
</div>
</section>
<section class="seasons" aria-label="Afsnit">
${tabs ? html`<div class="season-tabs" role="tablist" aria-label="Sæsoner" hidden>
${each(show.seasons, (season, i) => html`<button type="button" class="season-tab" role="tab" id="season-tab-${i + 1}" aria-controls="season-${i + 1}" aria-selected="${i == 0 ? "true" : "false"}"${attr("tabindex", i == 0 ? undefined : -1)}>${season.title}</button>`)}
</div>` : ""}
${each(show.seasons, (season, i) => html`<div class="season-panel" id="season-${i + 1}">
${show.seasons.length != 1 ? html`<h2 class="season-title">${season.title}</h2>` : ""}
<ol class="episodes">${each(season.episodes, episodeItem)}</ol>
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

function neighbourTile(heading: string, n: Neighbour | undefined): Html | "" {
	return n ? html`<h2 class="side-title">${heading}</h2>
${tile({href: n.url, image: n.wallpaper, title: n.title, minutes: n.minutes, videoId: n.url.split("_").at(-1)})}` : "";
}

/** Plays an episode of a show, or a programme on its own, like a film */
export function videoPage(site: Site, {show, e, description, previous, next}: {show?: Show; e: Episode | Program; description: string; previous?: Neighbour; next?: Neighbour}): Html {
	const film = show === undefined ? (e as Program) : undefined;
	return layout(site, {windowTitle: show ? `${show.title} - ${e.title}` : e.title, head: show ? feedLink(show) : undefined, scripts: PLAYER_SCRIPTS}, html`<div class="stage">
<video id="video" controls crossorigin="anonymous"${attr("poster", thumbnail(e.wallpaper, 1280))}${attr("data-next-url", next?.url)}${attr("data-next-title", next?.title)} data-title="${e.title}"${attr("data-show", show?.title)}${attr("data-image", thumbnail(e.wallpaper))}></video>
</div>
<div class="watch">
<div>
${show ? html`<a class="eyebrow" href="/${show.url}/">${icon("chevron-left")} ${show.title}</a>` : ""}
<h1 class="watch-title">${e.title}</h1>
<p class="meta">${e.pubdate ? html`<span>${danishDate(e.pubdate)}</span>` : ""}${e.minutes ? html`<span>${duration(e.minutes)}</span>` : ""}${
	isNew(e.pubdate) ? html`<span class="tag tag-new">Ny</span>` : ""}${e.geoRestricted ? html`<span class="tag tag-geo">Kun i Danmark</span>` : ""}</p>
<p class="description">${description}</p>
<div class="actions">
${film ? favoriteButton(film.url.split("/").at(-1)!, e.title, e.wallpaper, {kind: "film"}) : ""}
<a class="button button-quiet" href="https://www.dr.dk/drtv${e.url}">Se på DRTV ${icon("external")}</a>
</div>
</div>
${previous || next ? html`<aside class="watch-side" aria-label="Flere afsnit">
${neighbourTile("Næste afsnit", next)}
${neighbourTile("Forrige afsnit", previous)}
</aside>` : ""}
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
<p>Find serier, film og afsnit fra DRTV.</p>
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
	return layout(site, {title: "Kategorier"}, html`${pageHead("Kategorier")}
<ul class="category-grid wrap">
${each(categories, c => html`<li><a class="category" href="${c.url}">${c.image ? html`<img src="${thumbnail(c.image)}" alt="" loading="lazy">` : ""}<span class="category-title">${c.title}</span></a></li>\n`)}
</ul>`);
}

export function categoryPage(site: Site, {category, page}: {category: Category; page: DiscoverPage}): Html {
	return layout(site, {title: category.title}, html`${pageHead(category.title)}
${page.rows.length ? rows(page.rows) : html`<p class="wrap">DR har ikke noget i denne kategori lige nu.</p>`}`);
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
<div class="actions account-end">
<button type="button" class="button button-quiet js-sync-stop">Log ud på denne enhed</button>
<button type="button" class="button button-quiet js-sync-delete">Slet din konto</button>
</div>
</div>
<p class="sync-error js-sync-error" role="alert" hidden></p>
<p class="sync-privacy">Din konto er koden. Under den gemmes dine favoritter, hvor langt du er nået i hvert afsnit, og hvilke af dine enheder der får beskeder. Alle med koden kan se og ændre dem, så giv den kun til dine egne enheder. Uden en konto gemmes de kun i din browser.</p>
<noscript><p>Din konto kræver JavaScript.</p></noscript>
</div>`);
}
