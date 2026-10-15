// What every page has: the header with the sections, and the footer

import versions from "../static-versions.json";
import {attr, each, html, type Html} from "./html";
import {ICONS} from "./icons";
import {icon} from "./ui";

export interface Site {
	serviceName: string;
	sourceURL: string;
	// Where the page is, like /kategorier/film/, for the header to show
	path: string;
	// What was searched for, for the header's search field
	query?: string;
}

/** The URL of one of our static files, which changes along with the file */
export function staticURL(name: keyof typeof versions): string {
	return `/static/${name}?v=${versions[name]}`;
}

// The libraries, served from here, and checked against the hashes they had when they were downloaded
export const LIBRARIES = {
	bootstrap: {href: "/static/vendor/bootstrap-5.3.3.min.css", integrity: "sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH"},
	hls: {href: "/static/vendor/hls-1.7.3.min.js", integrity: "sha384-cciJ0zi8d1uMKC2zJd7jvPY4HQt7W4ByUI/FlMkltvBi31aW61rcpVBhpmW8/NwX"},
	plyr: {href: "/static/vendor/plyr-3.8.4.min.js", integrity: "sha384-I+WOYmeHMpGhifL4sNlgOjvE/aIyNeReJ8GmAHzi4hy38rtVS/eav1hVJKvMvHrY"},
	plyrStyle: {href: "/static/vendor/plyr-3.8.4.css", integrity: "sha384-VqqE0KSv00qfHvKpRa8aov+g3xtUu2Rw0NsEmtjTOPGn/JDKVghgd56iw/VObHa7"},
};

export const MAIN_CATEGORIES = ["/kategorier/fiktionsserier/", "/kategorier/film/", "/kategorier/dokumentar/"];

/** The header's sections; the logo leads to the front page */
function sections(path: string): [string, string, boolean][] {
	return [
		["/live/", "Direkte", path.startsWith("/live/")],
		["/kategorier/fiktionsserier/", "Serier", path == "/kategorier/fiktionsserier/"],
		["/kategorier/film/", "Film", path == "/kategorier/film/"],
		["/kategorier/dokumentar/", "Dokumentar", path == "/kategorier/dokumentar/"],
		["/kategorier/", "Kategorier", path.startsWith("/kategorier/") && !MAIN_CATEGORIES.includes(path)],
		["/favoritter/", "Favoritter", path.startsWith("/favoritter/")],
	];
}

/** The tabs at the bottom of small screens, instead of the header's sections: [url, name, icon, current] */
function tabs(path: string): [string, string, string, boolean][] {
	return [
		["/", "Forside", "home", path == "/"],
		["/live/", "Direkte", "tv", path.startsWith("/live/")],
		["/kategorier/", "Kategorier", "grid", path.startsWith("/kategorier/")],
		["/search/", "Søg", "search", path.startsWith("/search/")],
		["/favoritter/", "Favoritter", "heart", path.startsWith("/favoritter/")],
	];
}

/** The scripts the players need */
export const PLAYER_SCRIPTS = html`<link href="${LIBRARIES.plyrStyle.href}" rel="stylesheet" integrity="${LIBRARIES.plyrStyle.integrity}">
<script src="${LIBRARIES.plyr.href}" integrity="${LIBRARIES.plyr.integrity}"></script>
<script src="${LIBRARIES.hls.href}" integrity="${LIBRARIES.hls.integrity}"></script>
<script src="${staticURL("player.js")}"></script>`;

/** The scripts a live channel's page needs: the player's, watching together's, and changing channels' */
export const LIVE_SCRIPTS = html`${PLAYER_SCRIPTS}
<script src="${staticURL("together.js")}"></script>
<script src="${staticURL("live.js")}"></script>`;

/** The scripts a video's page needs: the player's, watching together's, and skipping's */
export const VIDEO_SCRIPTS = html`${PLAYER_SCRIPTS}
<script src="${staticURL("next.js")}"></script>
<script src="${staticURL("together.js")}"></script>
<script src="${staticURL("skip.js")}"></script>`;

/** The site's name as its logo: like Flimmer with kassen on a tag beside it, for names that end in kassen or TV */
function logo(name: string): Html {
	const tag = /^(.+)(kassen|tv)$/i.exec(name);
	return tag ? html`<span class="logo-word">${tag[1]}</span><span class="logo-tag">${tag[2]}</span>` : html`<span class="logo-word">${name}</span>`;
}

export interface PageProps {
	// The window's title, before the site's name
	title?: string;
	// Or the whole of it, without the site's name
	windowTitle?: string;
	head?: Html;
	scripts?: Html;
	bodyClass?: string;
}

export function layout(site: Site, {title, windowTitle, head, scripts, bodyClass}: PageProps, content: Html): Html {
	return html`<!doctype html>
<html lang="da" data-bs-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#0b0c10">
<meta name="application-name" content="${site.serviceName}">
<title>${windowTitle ?? (title ? `${title} - ${site.serviceName}` : site.serviceName)}</title>
${head}
<link href="${LIBRARIES.bootstrap.href}" rel="stylesheet" integrity="${LIBRARIES.bootstrap.integrity}">
<link href="/static/vendor/schibsted-grotesk-5.3.0-latin.woff2" rel="preload" as="font" type="font/woff2" crossorigin>
<link href="${staticURL("style.css")}" rel="stylesheet">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="${staticURL("manifest.webmanifest")}">
<link rel="apple-touch-icon" href="/static/icons/apple-touch-icon.png">
<script src="${staticURL("progress.js")}"></script>
<script src="${staticURL("favorites.js")}"></script>
<script src="${staticURL("sync.js")}"></script>
<script src="${staticURL("ui.js")}"></script>
<script src="${staticURL("account.js")}"></script>
<script src="${staticURL("news.js")}"></script>
${scripts}
</head>
<body class="${bodyClass || ""}">
${ICONS}
<a class="skip-link" href="#main">Gå til indholdet</a>
<header class="site-header">
<div class="wrap header-bar">
<a class="logo" href="/" aria-label="${site.serviceName}, forsiden"${attr("aria-current", site.path == "/" && "page")}>${logo(site.serviceName)}</a>
<nav class="site-nav" aria-label="Hovedmenu">
<ul>
${each(sections(site.path), ([url, name, current]) =>
	html`<li><a href="${url}" class="nav-item"${attr("aria-current", current && "page")}>${url == "/live/" ? html`<span class="live-dot"></span>` : ""}${name}</a></li>\n`)}
</ul>
</nav>
<form class="header-search" role="search" action="/search/">
<input type="search" name="query" placeholder="Søg efter serier, film og afsnit" aria-label="Søg" value="${site.query || ""}" enterkeyhint="search">
<button type="submit" class="search-submit" aria-label="Søg">${icon("search")}</button>
</form>
<a class="search-link" href="/search/" aria-label="Søg"${attr("aria-current", site.path.startsWith("/search/") && "page")}>${icon("search")}</a>
<a class="bell-link js-bell" href="/nyt/" aria-label="Nyt til dig"${attr("aria-current", site.path.startsWith("/nyt/") && "page")}>${icon("bell")}<span class="bell-count" aria-hidden="true" hidden></span></a>
<a class="account-link" href="/sync/" aria-label="Din konto"${attr("aria-current", site.path.startsWith("/sync/") && "page")}>${icon("user")}</a>
</div>
</header>
<main id="main">
${content}
</main>
<div id="toast" class="toast-message" role="status" aria-live="polite"></div>
<footer class="site-footer">
<a class="logo" href="/" aria-label="${site.serviceName}, forsiden">${logo(site.serviceName)}</a>
<p>Siden er en uofficiel, uafhængig alternativ brugerflade og er ikke tilknyttet til DR. Alt indhold hentes direkte fra DR's servere, og siden giver ikke adgang til andet materiale end det, DR selv stiller til rådighed. DR og DRTV er DR's varemærker.</p>
<nav class="footer-links" aria-label="Om siden">
<a href="/privatliv/"${attr("aria-current", site.path.startsWith("/privatliv/") && "page")}>Privatliv</a>
<a href="/sync/">Din konto</a>
<a href="${site.sourceURL}">Kildekode</a>
</nav>
</footer>
<nav class="tab-bar" aria-label="Hovedmenu">
${each(tabs(site.path), ([url, name, symbol, current]) =>
	html`<a href="${url}" class="tab"${attr("aria-current", current && "page")}><span class="tab-icon">${icon(symbol)}${url == "/live/" ? html`<span class="live-dot"></span>` : ""}</span>${name}</a>\n`)}
</nav>
<script>
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
}
</script>
</body>
</html>
`;
}
