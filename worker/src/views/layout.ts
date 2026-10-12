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
	// Danmarks Radio's age, on its birthday
	birthday?: number;
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

const MAIN_CATEGORIES = ["/kategorier/fiktionsserier/", "/kategorier/film/", "/kategorier/dokumentar/"];

function sections(path: string): [string, string, boolean][] {
	return [
		["/", "Forside", path == "/"],
		["/live/", "Direkte", path.startsWith("/live/")],
		["/kategorier/fiktionsserier/", "Serier", path == "/kategorier/fiktionsserier/"],
		["/kategorier/film/", "Film", path == "/kategorier/film/"],
		["/kategorier/dokumentar/", "Dokumentar", path == "/kategorier/dokumentar/"],
		["/kategorier/", "Kategorier", path.startsWith("/kategorier/") && !MAIN_CATEGORIES.includes(path)],
		["/favoritter/", "Favoritter", path.startsWith("/favoritter/")],
	];
}

/** The scripts the players need */
export const PLAYER_SCRIPTS = html`<link href="${LIBRARIES.plyrStyle.href}" rel="stylesheet" integrity="${LIBRARIES.plyrStyle.integrity}">
<script src="${LIBRARIES.plyr.href}" integrity="${LIBRARIES.plyr.integrity}"></script>
<script src="${LIBRARIES.hls.href}" integrity="${LIBRARIES.hls.integrity}"></script>
<script src="${staticURL("player.js")}"></script>`;

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
<title>${windowTitle ?? (title ? `${title} - ${site.serviceName}` : site.serviceName)}</title>
${head}
<link href="${LIBRARIES.bootstrap.href}" rel="stylesheet" integrity="${LIBRARIES.bootstrap.integrity}">
<link href="/static/vendor/schibsted-grotesk-5.3.0-latin.woff2" rel="preload" as="font" type="font/woff2" crossorigin>
<link href="${staticURL("style.css")}" rel="stylesheet">
<link rel="manifest" href="${staticURL("manifest.webmanifest")}">
<link rel="apple-touch-icon" href="/static/icons/apple-touch-icon.png">
<script src="${staticURL("progress.js")}"></script>
<script src="${staticURL("favorites.js")}"></script>
<script src="${staticURL("sync.js")}"></script>
<script src="${staticURL("ui.js")}"></script>
<script src="${staticURL("account.js")}"></script>
${scripts}
</head>
<body class="${bodyClass || ""}">
${ICONS}
<a class="skip-link" href="#main">Gå til indholdet</a>
${site.birthday ? html`<div class="birthday">🇩🇰 Tillykke til DR med de ${site.birthday} år! 🇩🇰</div>` : ""}
<header class="site-header">
<div class="wrap header-bar">
<nav class="site-nav" aria-label="Hovedmenu">
<ul>
${each(sections(site.path), ([url, name, current]) =>
	html`<li><a href="${url}" class="nav-item"${attr("aria-current", current && "page")}>${url == "/live/" ? html`<span class="live-dot"></span>` : ""}${name}</a></li>\n`)}
</ul>
</nav>
<form class="header-search" role="search" action="/search/">
<input type="search" name="query" placeholder="Søg i DRTV" aria-label="Søg" value="${site.query || ""}" enterkeyhint="search">
<button type="submit" class="search-submit" aria-label="Søg">${icon("search")}</button>
</form>
<a class="search-link" href="/search/" aria-label="Søg">${icon("search")}</a>
<a class="account-link" href="/sync/" aria-label="Din konto"${attr("aria-current", site.path.startsWith("/sync/") && "page")}>${icon("user")}</a>
</div>
</header>
<main id="main">
${content}
</main>
<div id="toast" class="toast-message" role="status" aria-live="polite"></div>
<footer class="site-footer">
<p>Uofficiel brugerflade til DRTV. Ikke tilknyttet DR. Udsendelserne kommer direkte fra DR.</p>
<a href="/sync/">Din konto og synkronisering mellem dine enheder</a>
<a href="${site.sourceURL}">Kildekode</a>
</footer>
<script>
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
}
</script>
</body>
</html>
`;
}
