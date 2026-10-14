// Renders every page against the fixtures, to catch template breakage

import {createHash} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, test} from "vitest";
import {expireAll, forgetAll} from "../src/cache";
import {clock} from "../src/time";
import {between, dr, env, get, load, request} from "./helpers";

const PUBLIC = join(__dirname, "..", "public");

/** The playlist a show's play button has, from its data-episodes */
function playlist(text: string) {
	const attribute = between(text, 'data-episodes="', '"');
	return JSON.parse(attribute.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"));
}

const count = (text: string, part: string) => text.split(part).length - 1;

describe("the front page", () => {
	test("links to the live channels", async () => {
		const r = await get("/");
		expect(r.status).toBe(200);
		expect(r.text).toContain('href="/live/DR1"');
	});

	test("features DR's programmes", async () => {
		const r = await get("/");
		// Like DR's own, which has a dozen or so
		const slides = count(r.text, 'class="hero-slide"');
		expect(slides).toBeGreaterThan(3);
		expect(slides).toBeLessThanOrEqual(12);
		// Bars instead of the titles a second time, named for screen readers
		expect(count(r.text, 'class="featured-bar"')).toBe(slides);
		expect(between(r.text, 'class="featured-bars"', "</div>")).toContain('aria-label="');
		expect(r.text).toContain('data-preview="https://');
		// DR's rows, with links to the pages here
		expect(r.text).toContain('<h2 class="shelf-title" id="row-1">');
		// Each with a link to all of it, which ui.js hides when the row has room for all of it
		const rows = r.text.split('<section class="shelf" aria-labelledby="row-').slice(1);
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			expect(row).toMatch(/<a class="shelf-more" href="\/liste\/\d+\/\?titel=[^"]+"( data-overflow-only)?>Se alle/);
		}
		expect(between(r.text, 'id="featured-1"', 'id="featured-2"')).toContain('<a class="button button-primary" href="/');
	});

	test("the featured programmes' facts lead somewhere", async () => {
		const featured = between((await get("/")).text, 'id="featured-1"', 'id="featured-2"');
		// Its category, and the episode DR mentions
		expect(featured).toContain('<a class="meta-link" href="/kategorier/');
		expect(featured).toMatch(/<a class="meta-link" href="\/\d+\/afsnit\/\d+\?saeson=\d+">Episode/);
		// Plays it, instead of showing the show's page
		expect(featured).toMatch(/<a class="button button-primary" href="\/\d+\/afsnit\//);
	});

	test("without DR's page, asks what to look for", async () => {
		dr.answer = path => (path == "/page" ? new Response("{}", {status: 404}) : undefined);
		const r = await get("/");
		expect(r.status).toBe(200);
		expect(r.text).not.toContain('class="hero-slide"');
		expect(r.text).toContain("<h2>Serier, film og direkte TV</h2>");
		expect(r.text).toContain('action="/search/"');
	});

	test("lists the live channels, and what's on them", async () => {
		// During "Hammerslag" on DR1, 11.40 to 12.10 UTC in the fixture
		clock.now = () => Date.UTC(2026, 9, 12, 11, 55);
		const r = await get("/");
		expect(r.text).toContain('<h2 class="shelf-title" id="live-title">Direkte TV</h2>');
		expect(r.text).toContain('<a class="tile-link" href="/live/DR1" style="--channel: #FF001E;">');
		// TV A in warm white, and Ramasjang in purple, instead of DR's red and turquoise, too like DR1's and DR2's
		expect(r.text).toContain('<a class="tile-link" href="/live/EVA" style="--channel: #f2efe9; --channel-on-paper: #0f1013;">');
		expect(r.text).toContain('<a class="tile-link" href="/live/TVR" style="--channel: #9b6cff;">');
		expect(r.text).toContain('<span class="visually-hidden">DR1: </span>Hammerslag 2022 - Lejlighed i storbyen</h3>');
		// In Danish time
		expect(r.text).toContain("Til 14.10, derefter");
		expect(r.text).toContain('aria-valuenow="50"');
	});

	test("channels without a schedule", async () => {
		// Long after the fixture's schedule
		clock.now = () => Date.UTC(2030, 0, 1);
		expect((await get("/")).text).toContain('<div class="channel-art">DR1</div>');
		const r = await get("/live/DR1");
		expect(r.status).toBe(200);
		expect(r.text).toContain('<section class="schedule" aria-labelledby="schedule-title" style="--channel: #FF001E;" hidden>');
		expect(between(r.text, '<a class="guide-channel" href="/live/DR1"', "</a>")).toContain('<span class="guide-now"></span>');
	});

	test("can continue watching, and list favourites", async () => {
		const r = await get("/");
		expect(r.text).toContain('<section class="shelf" id="continue-watching" aria-labelledby="continue-title" hidden>');
		expect(r.text).toContain('<section class="shelf" id="leaving-soon" aria-labelledby="leaving-title" hidden>');
		expect(r.text).toContain('<section class="shelf" id="favorites" data-favorites="all" aria-labelledby="favorites-title" hidden>');
		expect(r.text).toContain('<script src="/static/progress.js?v=');
		expect(r.text).toContain('<script src="/static/favorites.js?v=');
		expect(r.text).toContain('<script src="/static/ui.js?v=');
		expect(r.text).toContain('<div id="toast" class="toast-message" role="status" aria-live="polite"></div>');
	});

	test("lists recommended shows that were fetched already", async () => {
		env.RECOMMENDED_SHOWS = "findes-ikke_1:rejseholdet_503605";
		// The first time, they're fetched for later
		expect((await get("/")).text).not.toContain("Anbefalede serier");
		const r = await get("/");
		expect(r.text).toContain("Anbefalede serier");
		expect(r.text).toContain('href="/rejseholdet_503605/"');
		expect(r.text).toContain("Width=640&amp;Height=360");
		// For marking how many of its episodes the viewer has seen
		expect(r.text).toContain('data-episode-ids="503615 ');
		expect(r.text).toContain('data-favorite-id="rejseholdet_503605"');
	});

	test("doesn't list other visitors' shows", async () => {
		await get("/rejseholdet_503605/");
		await get("/rejseholdet_503605.xml");
		const r = await get("/");
		expect(r.text).not.toContain('href="/rejseholdet_503605/"');
		expect(r.text).not.toContain("Anbefalede serier");
	});
});

describe("every page", () => {
	test("has the logo, which leads to the front page, and the sections in the header", async () => {
		const r = await get("/");
		expect(r.text).toContain('<a class="logo" href="/" aria-label="GLOTV, forsiden" aria-current="page"><span class="logo-word">GLO</span><span class="logo-tag">TV</span></a>');
		const nav = between(r.text, '<nav class="site-nav"', "</nav>");
		for (const title of ["Direkte", "Serier", "Film", "Dokumentar", "Kategorier", "Favoritter"]) {
			expect(nav).toContain(`${title}</a>`);
		}
		expect(nav).not.toContain("Forside");
		expect(r.text).toContain("<title>GLOTV</title>");
		expect(r.text).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
	});

	test("has tabs for small screens, with the one for the page's section current", async () => {
		const tabs = (path: string) => between(r(path), '<nav class="tab-bar"', "</nav>");
		const r = (path: string) => pages.get(path)!;
		const pages = new Map<string, string>();
		for (const path of ["/", "/kategorier/film/", "/search/?query=matador"]) {
			pages.set(path, (await get(path)).text);
		}
		const titles = [...tabs("/").matchAll(/<\/span>([^<]+)<\/a>/g)].map(m => m[1]);
		expect(titles).toEqual(["Forside", "Direkte", "Kategorier", "Søg", "Favoritter"]);
		expect(tabs("/")).toContain('<a href="/" class="tab" aria-current="page">');
		expect(tabs("/kategorier/film/")).toContain('<a href="/kategorier/" class="tab" aria-current="page">');
		expect(tabs("/search/?query=matador")).toContain('<a href="/search/" class="tab" aria-current="page">');
		expect(count(tabs("/kategorier/film/"), "aria-current")).toBe(1);
	});

	test("says it isn't DR's, and links to privacy, syncing and the source", async () => {
		const footer = between((await get("/")).text, '<footer class="site-footer">', "</footer>");
		expect(footer).toContain("GLOTV er et uofficielt, uafhængigt projekt og er hverken tilknyttet eller sponsoreret af DR. DR og DRTV er DR's varemærker.");
		expect(footer).toContain("GLOTV er udelukkende en alternativ brugerflade: alt indhold hentes direkte fra DR's servere");
		expect(footer).toContain('<a href="/privatliv/">Privatliv</a>');
		expect(footer).toContain('<a href="/sync/">');
		expect(footer).toContain('<a href="https://github.com/devjoda/dktv">Kildekode</a>');
	});

	test("says what it keeps about its viewers", async () => {
		const r = await get("/privatliv/");
		expect(r.status).toBe(200);
		expect(r.text).toContain("<title>Privatliv - GLOTV</title>");
		expect(r.text).toContain("ingen reklamer og ingen sporing");
		expect(r.text).toContain('<a href="/sync/">Din konto</a>');
		expect(between(r.text, '<footer class="site-footer">', "</footer>")).toContain('<a href="/privatliv/" aria-current="page">Privatliv</a>');
		expect((await get("/privatliv")).location).toBe("/privatliv/");
	});

	test("the source can be elsewhere", async () => {
		env.SOURCE_URL = "https://example.com/kode";
		expect((await get("/")).text).toContain('<a href="https://example.com/kode">Kildekode</a>');
	});

	test("is dark, and doesn't tell DR where it's used from", async () => {
		for (const path of ["/", "/rejseholdet_503605/", "/search/", "/live/DR1"]) {
			const text = (await get(path)).text;
			expect(text).toContain('<html lang="da" data-bs-theme="dark">');
			expect(text).toContain('<link href="/static/style.css?v=');
			expect(text).toContain('<meta name="referrer" content="no-referrer">');
		}
	});

	test("loads the libraries from here", async () => {
		for (const path of ["/", "/rejseholdet_503605/", "/program/lise-noergaard_-ikke-kun-en-pige_362031"]) {
			const text = (await get(path)).text;
			expect(text).not.toContain("cdn.jsdelivr.net");
			expect(text).toContain('<link href="/static/vendor/bootstrap-5.3.3.min.css" rel="stylesheet" integrity="sha384-');
			expect(text).not.toContain("bootstrap.bundle");
		}
	});

	test("registers the service worker from the root", async () => {
		expect((await get("/")).text).toContain('navigator.serviceWorker.register("/sw.js")');
	});

	test("has a search box with a button", async () => {
		expect((await get("/")).text).toContain('<button type="submit" class="search-submit" aria-label="Søg">');
	});

	test("names DR only in the footer", async () => {
		// Not the front page or searches, whose channels and descriptions are DR's own, like "DR Ramasjang"
		for (const path of ["/rejseholdet_503605/", "/rejseholdet_503605/rejseholdet_503615", "/search/", "/kategorier/", "/favoritter/", "/sync/", "/findes/ikke/"]) {
			const page = (await get(path)).text;
			// What the page says outside the footer: its text, and its fields' words, but not its addresses
			const said = page.split('<footer class="site-footer">')[0].replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, " ")
				+ [...page.matchAll(/(?:placeholder|aria-label|title)="([^"]*)"/g)].map(m => m[1]).join(" ");
			expect(said, path).not.toMatch(/\bDR\b|DRTV/);
		}
	});
});

describe("the browser's files", () => {
	test("are copied to be served, with the service worker at the root", () => {
		for (const path of ["static/player.js", "static/ui.js", "static/vendor/bootstrap-5.3.3.min.css", "static/vendor/hls-1.7.3.min.js",
			"static/vendor/plyr-3.8.4.min.js", "static/vendor/plyr-3.8.4.css", "static/vendor/plyr-3.8.4.svg", "favicon.ico"]) {
			expect(existsSync(join(PUBLIC, path)), path).toBe(true);
		}
		expect(readFileSync(join(PUBLIC, "sw.js"), "utf8")).toContain("ResizeImage");
		expect(readFileSync(join(PUBLIC, "static", "player.js"), "utf8")).toContain("async function playVideo(");
	});

	test("are versioned, so browsers get new ones right after an update", async () => {
		const text = (await get("/")).text;
		const version = /src="\/static\/ui\.js\?v=(\w+)"/.exec(text)![1];
		const content = readFileSync(join(PUBLIC, "static", "ui.js"));
		expect(version).toBe(createHash("sha256").update(content).digest("hex").slice(0, 12));
		// Which browsers may keep for good, and the service worker, which they should check for often
		const headers = readFileSync(join(PUBLIC, "_headers"), "utf8");
		expect(headers).toMatch(/\/static\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/);
		expect(headers).toMatch(/\/sw\.js\n {2}Cache-Control: no-cache/);
	});
});

describe("a show", () => {
	test("its page", async () => {
		const r = await get("/rejseholdet_503605/");
		expect(r.status).toBe(200);
		expect(r.text).toContain("Rejseholdet");
		expect(r.text).toContain('href="rejseholdet_503615"');
		expect(r.text).toContain('<link rel="alternate" type="application/rss+xml" title="Rejseholdet" href="/rejseholdet_503605.xml">');
		// Only for feed readers to find, until it's a setting
		expect(r.text).not.toContain("Abonnér med RSS");
		// Seasons in order
		const at = (s: string) => r.text.indexOf(s);
		expect(at("Sæson 1")).toBeLessThan(at("Sæson 2"));
		expect(at("Sæson 2")).toBeLessThan(at("Sæson 3"));
		expect(at("Sæson 3")).toBeLessThan(at("Sæson 4"));
		// Small pictures for the episodes; full HD only on offer for the big one, for screens that need it
		const episodes = r.text.split('class="seasons"')[1];
		expect(episodes).not.toContain("Width=1920");
		expect(episodes).toContain("Width=640");
		expect(r.text).toContain('1920w" sizes="100vw"');
		// All but the big picture at the top, which is seen right away
		expect(count(r.text, 'loading="lazy"')).toBe(count(r.text, "<img") - 1);
		expect(r.text).toContain("Width=1280");
		expect(r.text).toContain("1. okt. 2000");
		expect(r.text).toContain("59 min.");
		expect(r.text).toContain("4 sæsoner");
		expect(r.text).toContain("32 afsnit");
		// Seasons become tabs, with the first selected until ui.js knows where the viewer got to
		expect(r.text).toContain('<button type="button" class="season-tab" role="tab" id="season-tab-1" aria-controls="season-1" aria-selected="true">Sæson 1</button>');
		expect(r.text).toContain('<button type="button" class="season-tab" role="tab" id="season-tab-4" aria-controls="season-4" aria-selected="false" tabindex="-1">Sæson 4</button>');
		// Can be made a favourite
		expect(r.text).toContain('class="button button-secondary js-favorite" aria-pressed="false" data-favorite-id="rejseholdet_503605" data-kind="show" data-title="Rejseholdet"');
		// For showing how far the viewer got with each episode, and what to play
		expect(r.text).toContain('<script src="/static/progress.js?v=');
		expect(r.text).toContain('data-video-id="503615"');
		expect(r.text).toContain('class="button button-primary js-play" href="/rejseholdet_503605/rejseholdet_503615"');
		expect(playlist(r.text)[0]).toEqual({id: "503615", url: "/rejseholdet_503605/rejseholdet_503615", title: "1. episode", season: "Sæson 1"});
		expect(playlist(r.text)).toHaveLength(32);
	});

	test("says when it leaves DR, and when that's soon", async () => {
		expect((await get("/rejseholdet_503605/")).text).toContain("<span>Kan ses til 15. mar. 2028</span>");
		forgetAll();
		clock.now = () => Date.UTC(2028, 2, 1, 12);
		const r = await get("/rejseholdet_503605/");
		expect(r.text).toContain('<span class="tag tag-leaving">Udløber om 14 dage</span>');
		expect(r.text).not.toContain("Kan ses til");
		// The whole series leaves then, so its episodes needn't each say so
		expect(count(r.text, "tag-leaving")).toBe(1);
	});

	test("says when a season leaves before the rest of the series", async () => {
		const first = load("items_503606.json");
		first.offers[0].endDate = "2028-02-25T22:59:00Z";
		dr.answer = path => (path == "/items/503606" ? first : undefined);
		clock.now = () => Date.UTC(2028, 1, 20, 12);
		const r = await get("/rejseholdet_503605/");
		const seasons = r.text.split('class="season-panel"');
		expect(count(seasons[1], "Udløber om 5 dage")).toBe(9);
		expect(seasons.slice(2).join("")).not.toContain("tag-leaving");
	});

	test("announces the next episode", async () => {
		const blob = load("items_503612.json");
		blob.show.nextEpisode = {availableUTC: "1760000000"};
		dr.answer = path => (path == "/items/503612" ? blob : undefined);
		// 08:53 UTC, so 10:53 in Denmark
		expect((await get("/rejseholdet_503605/")).text).toContain("Nyt afsnit 9. okt. kl. 10.53");
	});

	test("that isn't there", async () => {
		const r = await get("/findes-ikke_1/");
		expect(r.status).toBe(404);
		expect(r.text).toContain("Siden findes ikke");
		expect(r.text).toContain('action="/search/"');
		expect((await get("/ikke-et-tal/")).status).toBe(404);
		// A programme isn't a show
		expect((await get("/lise-noergaard_-ikke-kun-en-pige_362031/")).status).toBe(404);
	});

	test("without the slash at the end", async () => {
		const r = await get("/rejseholdet_503605");
		expect(r.status).toBe(308);
		expect(r.location).toBe("/rejseholdet_503605/");
	});

	test("links don't lead to other sites", async () => {
		for (const path of ["/serie/%2F%2Fexample.com", "/drtv/serie/%2F%2Fexample.com", "/%2F%2Fexample%2Ecom", "/kategorier/%2F%2Fexample.com"]) {
			const r = await get(path);
			expect(r.status, path).toBe(404);
			expect(r.location).toBeNull();
		}
	});

	test("DR-style links lead to it", async () => {
		for (const path of ["/serie/rejseholdet_503605", "/drtv/serie/rejseholdet_503605"]) {
			const r = await get(path);
			expect(r.status).toBe(302);
			expect(r.location).toBe("/rejseholdet_503605/");
		}
	});

	test("its RSS feed", async () => {
		const r = await get("/rejseholdet_503605.xml");
		expect(r.status).toBe(200);
		expect(r.contentType).toBe("application/rss+xml");
		expect(r.text).toContain("<channel><title>Rejseholdet</title>");
		expect(r.text).toContain("<link>http://localhost/rejseholdet_503605/</link>");
		expect(count(r.text, "<item>")).toBe(32);
	});

	test("its RSS feed has the long descriptions once known", async () => {
		dr.answer = path => (path == "/items/503615" ? {id: "503615", description: "Lang beskrivelse"} : undefined);
		// Until someone opens an episode, the feed makes do with its short description
		expect((await get("/rejseholdet_503605.xml")).text).not.toContain("Lang beskrivelse");
		expect((await get("/rejseholdet_503605/rejseholdet_503615")).text).toContain('<p class="description">Lang beskrivelse</p>');
		expect((await get("/rejseholdet_503605.xml")).text).toContain("<description>Lang beskrivelse</description>");
	});

	test("plays an episode by its number", async () => {
		// Rejseholdet's second season
		const r = await get("/rejseholdet_503605/afsnit/2?saeson=503607");
		expect(r.status).toBe(302);
		expect(r.location).toBe("/rejseholdet_503605/rejseholdet_503624");
		// Without a season, the newest; and numbers past the end, the last one
		expect((await get("/rejseholdet_503605/afsnit/1")).location).toBe("/rejseholdet_503605/rejseholdet_503616");
		expect((await get("/rejseholdet_503605/afsnit/99?saeson=503612")).location).toBe("/rejseholdet_503605/rejseholdet_503636");
	});

	test("a show that can't be built is an error of ours", async () => {
		const blob = load("items_503605.json");
		blob.seasons.items = [];
		dr.answer = path => (path == "/items/503605" ? blob : undefined);
		const r = await get("/rejseholdet_503605/");
		expect(r.status).toBe(500);
		expect(r.text).toContain("Noget gik galt");
	});
});

describe("an episode", () => {
	test("its page", async () => {
		const r = await get("/rejseholdet_503605/rejseholdet_503615");
		expect(r.status).toBe(200);
		expect(r.text).toContain('<a class="eyebrow" href="/rejseholdet_503605/">');
		expect(r.text).toContain('<h1 class="watch-title">1. episode</h1>');
		expect(r.text).toContain("<title>Rejseholdet - 1. episode</title>");
		expect(r.text).toContain('type="application/rss+xml" title="Rejseholdet" href="/rejseholdet_503605.xml"');
		expect(r.text).toContain("<span>1. okt. 2000</span><span>59 min.</span>");
		expect(r.text).toContain('poster="https://');
		expect(r.text).toContain('playVideo(document.getElementById(\'video\'), "503615")');
		// The first episode has nothing before it
		expect(r.text).not.toContain("Forrige afsnit");
		expect(r.text).toContain('<a class="episode-link episode-next" href="/rejseholdet_503605/rejseholdet_503640" data-video-id="503640" rel="next">');
		expect(r.text).toContain('<span class="episode-name">2. episode</span>');
		expect(r.text).toContain('data-next-url="/rejseholdet_503605/rejseholdet_503640"');
		// What it saves about the video, to list it under "Fortsæt med at se"
		expect(r.text).toContain('data-title="1. episode"');
		expect(r.text).toContain('data-show="Rejseholdet"');
		expect(r.text).toContain('data-image="https://');
		// Which belongs to its show, so isn't a favourite on its own
		expect(between(r.text, 'class="watch"', 'class="episode-nav"')).not.toContain("js-favorite");
	});

	test("links into the next season", async () => {
		// The last episode of season 1
		const r = await get("/rejseholdet_503605/rejseholdet_503638");
		expect(r.status).toBe(200);
		expect(r.text).toContain('<a class="episode-link episode-previous" href="/rejseholdet_503605/rejseholdet_503618" data-video-id="503618" rel="prev">');
		expect(r.text).toContain('<span class="episode-name">8. episode</span>');
		expect(r.text).toContain('<span class="episode-name">Sæson 2, 1. episode</span>');
		// There's no fixture for this episode's page, so it falls back to the short description
		expect(r.text).toContain("Dansk krimiserie fra 2000.");
	});

	test("that isn't there", async () => {
		expect((await get("/rejseholdet_503605/findes-ikke_1")).status).toBe(404);
	});
});

describe("a programme on its own", () => {
	test("its page", async () => {
		const r = await get("/program/lise-noergaard_-ikke-kun-en-pige_362031");
		expect(r.status).toBe(200);
		expect(r.text).toContain("Lise Nørgaard: Ikke kun en pige");
		expect(r.text).toContain("<span>7. jan. 2023</span><span>48 min.</span>");
		expect(r.text).toContain('poster="https://');
		expect(r.text).toContain('playVideo(document.getElementById(\'video\'), "362031")');
		expect(r.text).not.toContain("Næste afsnit");
		// Films can be favourites from their page
		expect(r.text).toContain('data-favorite-id="lise-noergaard_-ikke-kun-en-pige_362031" data-kind="film"');
		// When it leaves DR, which the player saves along with how far the viewer got
		expect(r.text).toContain("<span>Kan ses til 6. jan. 2028</span>");
		expect(r.text).toContain(`data-expires="${Date.UTC(2028, 0, 6, 22, 59)}"`);
	});

	test("players use Plyr, and the pinned hls.js", async () => {
		for (const path of ["/program/lise-noergaard_-ikke-kun-en-pige_362031", "/rejseholdet_503605/rejseholdet_503615", "/live/DR1"]) {
			const text = (await get(path)).text;
			expect(text).toContain('<script src="/static/vendor/hls-1.7.3.min.js" integrity="sha384-');
			expect(text).toContain('<script src="/static/player.js?v=');
			expect(text).toContain('<script src="/static/vendor/plyr-3.8.4.min.js" integrity="sha384-');
			expect(text).toContain('<link href="/static/vendor/plyr-3.8.4.css" rel="stylesheet" integrity="sha384-');
		}
	});
});

describe("live", () => {
	const cookie = (value: string) => request("/live/", {headers: {Cookie: `lastChannel=${value}`}});

	test("Direkte opens DR1, for those who haven't watched a channel", async () => {
		const r = await get("/live/");
		expect(r.status).toBe(302);
		expect(r.location).toBe("/live/DR1");
		expect(r.headers.get("Cache-Control")).toBe("private, no-store");
	});

	test("Direkte opens the channel the viewer watched last, as the browser remembers", async () => {
		for (const slug of ["DR2", "EVA", "TVR"]) {
			const r = await cookie(slug);
			expect(r.status).toBe(302);
			expect(r.location).toBe(`/live/${slug}`);
			expect(r.headers.get("Cache-Control")).toBe("private, no-store");
		}
		// The next viewer isn't sent where the last one went
		expect((await get("/live/")).location).toBe("/live/DR1");
	});

	test("Direkte ignores what isn't a channel in the cookie", async () => {
		for (const value of ["DR9", "dr2", "constructor", "__proto__", "..%2F..%2Fsync%2F", "%22%3E%3Cscript%3E", ""]) {
			expect((await cookie(value)).location).toBe("/live/DR1");
		}
	});

	test("a channel, with the others in a guide, as ordinary links", async () => {
		const r = await get("/live/DR1");
		expect(r.status).toBe(200);
		expect(r.text).toContain('<a href="/live/" class="nav-item" aria-current="page"><span class="live-dot"></span>Direkte</a>');
		expect(r.text).toContain('<a href="/live/" class="tab" aria-current="page">');
		const guide = between(r.text, '<nav class="channel-guide" id="channel-guide" aria-label="Kanaler">', "</nav>");
		expect([...guide.matchAll(/<a class="guide-channel" href="(\/live\/\w+)" data-channel="(\w+)"/g)].map(m => m[1])).toEqual(["/live/DR1", "/live/DR2", "/live/EVA", "/live/TVR"]);
		expect(guide).toContain('<a class="guide-channel" href="/live/DR1" data-channel="DR1" aria-current="page" style="--channel: #FF001E;">');
		expect(count(guide, "aria-current")).toBe(1);
		// In the channels' colours, as on the front page: TV A's warm white, dark on the chosen channel, and Ramasjang's purple
		expect(guide).toContain('<a class="guide-channel" href="/live/EVA" data-channel="EVA" style="--channel: #f2efe9; --channel-on-paper: #0f1013;">');
		expect(guide).toContain('<a class="guide-channel" href="/live/TVR" data-channel="TVR" style="--channel: #9b6cff;">');
		expect(r.text).toMatch(/<section class="schedule" aria-labelledby="schedule-title" style="--channel: #FF001E;"( hidden)?>/);
		expect(guide).toContain('<span class="guide-key" aria-hidden="true">4</span>');
		// What the browser needs to change channels by itself
		const data = JSON.parse(between(r.text, '<script type="application/json" id="live-data">', "</script>"));
		expect(data.channel).toBe("DR1");
		expect(data.channels.map((c: any) => c.slug)).toEqual(["DR1", "DR2", "EVA", "TVR"]);
		expect(data.channels[0]).toMatchObject({title: "DR1", stream: expect.stringContaining("https://drlivedr1hls.akamaized.net/"), subtitles: expect.stringContaining("drlivedr1texthls"), style: "--channel: #FF001E;"});
		expect(data.channels[3].style).toBe("--channel: #9b6cff;");
		expect(r.text).toContain("setupChannels(document.getElementById('video'), ");
		expect(r.text).toContain('<script src="/static/live.js?v=');
		// The overview of the channels is the guide now
		expect(r.text).not.toContain("channel-switcher");
	});

	test("the guide says what's on now, how far it's got, and what's next", async () => {
		clock.now = () => Date.UTC(2026, 9, 12, 11, 55);
		const r = await get("/live/DR1");
		const dr1 = between(r.text, '<a class="guide-channel" href="/live/DR1"', "</a>");
		expect(dr1).toMatch(/<span class="guide-now">[^<]+<\/span>/);
		expect(dr1).toMatch(/<span class="guide-progress" aria-hidden="true"><span style="width: 50%;"><\/span><\/span>/);
		expect(dr1).toMatch(/<span class="guide-next">14\.10 [^<]+<\/span>/);
	});

	test("the guide says when a channel is on again, when it isn't on", async () => {
		// Before DR Ramasjang's first programme in the fixture, at 11.35
		clock.now = () => Date.UTC(2026, 9, 12, 11, 0);
		const r = await get("/live/DR1");
		const ramasjang = between(r.text, '<a class="guide-channel" href="/live/TVR"', "</a>");
		expect(ramasjang).toContain('<span class="guide-now">Sender igen kl. 13.35</span>');
		expect(ramasjang).toContain('<span class="guide-progress" aria-hidden="true" hidden>');
	});

	test("a channel's programmes, with subtitles to choose", async () => {
		clock.now = () => Date.UTC(2026, 9, 12, 11, 55);
		const r = await get("/live/DR1");
		expect(r.text).toContain('<li class="programme is-now" data-start="2026-10-12T11:40:00+00:00" data-end="2026-10-12T12:10:00+00:00">');
		expect(r.text).toContain('<time class="programme-time" datetime="2026-10-12T11:40:00+00:00">13.40</time>');
		expect(r.text).toContain("Til 14.10");
		expect(r.text).toContain('<button type="button" class="button button-secondary js-live-subtitles" aria-pressed="false">');
		// The rest of the day, for the guide and the programmes to keep up with
		const data = JSON.parse(between(r.text, '<script type="application/json" id="live-data">', "</script>"));
		expect(data.plan.DR1[0]).toMatchObject({start: Date.UTC(2026, 9, 12, 11, 40), end: Date.UTC(2026, 9, 12, 12, 10)});
		expect(Object.keys(data.plan)).toEqual(["DR1", "DR2", "EVA", "TVR"]);
	});

	test("a channel's address in small letters leads to it", async () => {
		const r = await get("/live/dr2");
		expect(r.status).toBe(308);
		expect(r.location).toBe("/live/DR2");
	});

	test("a channel that isn't there", async () => {
		expect((await get("/live/DR9")).status).toBe(404);
		expect((await get("/live/constructor")).status).toBe(404);
	});

	test("the rest of the day's schedule, for the guide when the page's runs out", async () => {
		clock.now = () => Date.UTC(2026, 9, 12, 15, 0);
		const r = await get("/live/plan.json");
		expect(r.status).toBe(200);
		expect(r.contentType).toContain("application/json");
		const {plan} = JSON.parse(r.text);
		expect(Object.keys(plan)).toEqual(["DR1", "DR2", "EVA", "TVR"]);
		for (const programmes of Object.values(plan) as any[][]) {
			expect(programmes.length).toBeGreaterThan(0);
			for (const p of programmes) {
				// Only what isn't over
				expect(p.end).toBeGreaterThan(Date.UTC(2026, 9, 12, 15, 0));
				expect(Object.keys(p).sort()).toEqual(["description", "end", "start", "title"]);
			}
		}
		// All of each description, as in the programme list
		expect(Object.values(plan).flat().some((p: any) => p.description.length > 280 && !p.description.endsWith("…"))).toBe(true);
		// The whole day is asked for
		expect(dr.requested.find(path => path.startsWith("/schedules"))).toContain("duration=24");
	});
});

describe("categories and lists", () => {
	test("the categories", async () => {
		const r = await get("/kategorier/");
		expect(r.status).toBe(200);
		expect(r.text).toContain('<a class="category" href="/kategorier/fiktionsserier/">');
		expect(r.text).toContain('<span class="category-title">Dokumentar</span>');
		// Search does A to Å better
		expect(r.text).not.toContain("a-aa");
		// Serier, Film and Dokumentar first
		const urls = [...r.text.matchAll(/<a class="category" href="([^"]+)">/g)].map(m => m[1]);
		expect(urls.slice(0, 3)).toEqual(["/kategorier/fiktionsserier/", "/kategorier/film/", "/kategorier/dokumentar/"]);
		expect(urls.length).toBeGreaterThan(3);
	});

	test("a category", async () => {
		const r = await get("/kategorier/fiktionsserier/");
		expect(r.status).toBe(200);
		expect(r.text).toContain("<h1>Serier</h1>");
		expect(r.text).toContain('<a href="/kategorier/fiktionsserier/" class="nav-item" aria-current="page">Serier</a>');
		expect(r.text).toContain('<h2 class="shelf-title" id="row-1">');
		expect(r.text).toMatch(/<a class="shelf-more" href="\/liste\/\d+\/\?titel=[^"]+">Se alle/);
		expect((await get("/kategorier/findes-ikke/")).status).toBe(404);
		expect((await get("/kategorier/fiktionsserier")).location).toBe("/kategorier/fiktionsserier/");
	});

	test("all of a list", async () => {
		dr.answer = (path, params) => {
			if (path != "/lists/355817") {
				return undefined;
			}
			const page = Number(params.get("page"));
			return {
				id: "355817", title: "Film | A - Å", paging: {total: 2},
				items: [0, 1, 2].map(i => ({id: String(page * 1000 + i), type: "program", title: `Film ${page}-${i}`, path: `/program/film-${page}-${i}_${page * 1000 + i}`})),
			};
		};
		const r = await get("/liste/355817/?titel=A%20-%20%C3%85");
		expect(r.status).toBe(200);
		expect(r.text).toContain("<h1>A - Å</h1>");
		// Both pages
		expect(count(r.text, 'class="tile"')).toBe(6);
		expect(r.text).toContain('href="/program/film-2-2_2002"');
		expect((await get("/liste/355817/")).text).toContain("<h1>Film: A - Å</h1>");
		expect((await get("/liste/1/")).status).toBe(404);
	});
});

describe("favourites", () => {
	test("their page, shows first and films below", async () => {
		const r = await get("/favoritter/");
		expect(r.status).toBe(200);
		const shows = r.text.indexOf('<section class="results" id="favorite-shows" data-favorites="show"');
		const films = r.text.indexOf('<section class="results" id="favorite-films" data-favorites="film"');
		expect(shows).toBeGreaterThan(0);
		expect(shows).toBeLessThan(films);
		expect(r.text).toContain('<section class="results" id="continue-watching" aria-labelledby="continue-title" hidden>');
		// Films and single programmes, like a documentary or a concert, which don't get new episodes
		expect(r.text).toContain('<h2 class="section-title" id="favorite-films-title">Film og programmer</h2>');
		// The filters, which favorites.js shows when there are enough of more than one kind, before the favourites
		const filters = between(r.text, '<div class="favorite-filters wrap js-favorite-filters" role="group" aria-label="Vis" hidden>', "</div>");
		expect([...filters.matchAll(/data-filter="(\w+)" aria-pressed="(\w+)">([^<]+)</g)].map(m => [m[1], m[2], m[3].trim()])).toEqual([
			["alle", "true", "Alle"], ["serier", "false", "Serier"], ["film", "false", "Film og programmer"], ["dokumentar", "false", "Dokumentar"],
		]);
		expect(r.text.indexOf("js-favorite-filters")).toBeLessThan(shows);
		// The same page, whatever filter the address has, which only the browser reads
		expect((await get("/favoritter/?vis=dokumentar")).text).toBe(r.text);
	});

	test("are described", async () => {
		const r = await get("/favorites.json?shows=rejseholdet_503605:findes-ikke_1:ikke-et-tal&films=lise-noergaard_-ikke-kun-en-pige_362031:findes-ikke_2");
		expect(r.status).toBe(200);
		const favorites = JSON.parse(r.text);
		// The ones that can't be found are left out, instead of failing it all
		expect(Object.keys(favorites.shows)).toEqual(["rejseholdet_503605"]);
		expect(Object.keys(favorites.films)).toEqual(["lise-noergaard_-ikke-kun-en-pige_362031"]);
		expect(favorites.more).toBeUndefined();
		const film = favorites.films["lise-noergaard_-ikke-kun-en-pige_362031"];
		expect(film).toMatchObject({title: "Lise Nørgaard: Ikke kun en pige", url: "/program/lise-noergaard_-ikke-kun-en-pige_362031", minutes: 48, expires: Date.UTC(2028, 0, 6, 22, 59)});
		expect(favorites.shows["rejseholdet_503605"].expires).toBe(Date.UTC(2028, 2, 15, 22, 59));
		const rejseholdet = favorites.shows["rejseholdet_503605"];
		expect(rejseholdet).toMatchObject({title: "Rejseholdet", url: "/rejseholdet_503605/", seasons: 4, episodes: 32, new: false});
		expect(rejseholdet.image).toContain("Width=640");
		expect(rejseholdet.episode_ids).toHaveLength(32);
		expect(rejseholdet.episode_ids[0]).toBe("503615");
		// Whether each is a documentary, from DR's categories in what's kept, as on the page Dokumentar
		expect(rejseholdet.documentary).toBe(false);
		expect(film.documentary).toBe(true);
	});

	test("tells of each series' new episodes, from the series as it's kept, without asking DR again", async () => {
		clock.now = () => Date.UTC(2004, 0, 2, 12);
		await get("/rejseholdet_503605/");
		const asked = dr.requested.length;
		const r = await get("/favorites.json?shows=rejseholdet_503605");
		expect(dr.requested.length).toBe(asked);
		const found = JSON.parse(r.text).shows["rejseholdet_503605"].new_episodes;
		expect(found.map((e: any) => [e.id, e.season, e.number, e.url])).toEqual([
			["503636", 4, 2, "/rejseholdet_503605/rejseholdet_503636"],
			["503616", 4, 1, "/rejseholdet_503605/rejseholdet_503616"],
		]);
		expect(found[0]).toEqual({id: "503636", title: expect.any(String), season: 4, number: 2, url: "/rejseholdet_503605/rejseholdet_503636", published: Date.UTC(2004, 0, 1, 20), image: expect.stringContaining("Width=640")});
		// Without new ones, none
		clock.now = () => Date.UTC(2026, 9, 12);
		expect(JSON.parse((await get("/favorites.json?shows=rejseholdet_503605")).text).shows["rejseholdet_503605"].new_episodes).toEqual([]);
	});

	test("none", async () => {
		const r = await get("/favorites.json");
		expect(JSON.parse(r.text)).toEqual({shows: {}, films: {}});
		expect(dr.requested.filter(p => p.startsWith("/items/"))).toEqual([]);
	});

	test("more than a visit may ask DR about are left for the next", async () => {
		// Twenty shows, each like Rejseholdet, with its four seasons
		dr.answer = path => (/^\/items\/9\d\d$/.test(path) ? load("items_503605.json") : undefined);
		const wanted = Array.from({length: 20}, (_, i) => `show_${900 + i}`);
		const first = JSON.parse((await get(`/favorites.json?shows=${wanted.join(":")}`)).text);
		const described = Object.keys(first.shows);
		expect(described.length).toBeGreaterThan(3);
		expect(first.more.shows.length).toBeGreaterThan(0);
		expect([...described, ...first.more.shows].sort()).toEqual(wanted.sort());
		// Fewer requests to DR than a visit may make
		expect(dr.requested.length).toBeLessThanOrEqual(46);
		const second = JSON.parse((await get(`/favorites.json?shows=${first.more.shows.join(":")}`)).text);
		expect(Object.keys(second.shows).length).toBeGreaterThan(0);
	});

	test("shows and films can be made favourites from their tiles", async () => {
		const r = await get("/search/?query=matador");
		expect(r.text).toContain('aria-label="Favorit: Matador" title="Favorit"');
		expect(r.text).toContain('data-favorite-id="matador_540736" data-kind="show"');
		expect(r.text).toContain('data-favorite-id="lise-noergaard_-ikke-kun-en-pige_362031" data-kind="film"');
	});
});

describe("what to watch next", () => {
	test("is DR's own programmes from the narrowest category it has a page for, without the series itself", async () => {
		const r = await get("/forslag/serie/rejseholdet_503605");
		expect(r.status).toBe(200);
		const similar = JSON.parse(r.text);
		// Rejseholdet is Krimi and Gensyn too, which the fixtures have no page for
		expect(similar.label).toBe("Serier");
		expect(similar.cards.length).toBeGreaterThan(0);
		expect(similar.cards.length).toBeLessThanOrEqual(8);
		expect(similar.cards.every((c: any) => !c.url.includes("503605") && c.title && c.url.startsWith("/"))).toBe(true);
		expect(new Set(similar.cards.map((c: any) => c.url)).size).toBe(similar.cards.length);
		// From what the category's page is made of, which is kept for both
		expect(dr.requested.some(p => p.startsWith("/page") && p.includes("fiktionsserier"))).toBe(true);
	});

	test("is nothing when DR has no page for its categories", async () => {
		const similar = JSON.parse((await get("/forslag/program/lise-noergaard_-ikke-kun-en-pige_362031")).text);
		expect(similar).toEqual({label: "", cards: []});
	});

	test("is only for series and programmes", async () => {
		expect((await get("/forslag/noget/rejseholdet_503605")).status).toBe(404);
		expect((await get("/forslag/serie/findes-ikke_1")).status).toBe(404);
	});

	test("is known by the page that plays one", async () => {
		const episode = await get("/rejseholdet_503605/rejseholdet_503615");
		expect(episode.text).toContain('<video id="video" controls crossorigin="anonymous" data-episode-id="503615" data-suggest="/forslag/serie/rejseholdet_503605"');
		const film = await get("/program/lise-noergaard_-ikke-kun-en-pige_362031");
		expect(film.text).toContain('data-episode-id="362031" data-suggest="/forslag/program/lise-noergaard_-ikke-kun-en-pige_362031"');
	});
});

describe("links to DR", () => {
	test("aren't on series', episodes' or films' pages, only in the footer", async () => {
		for (const path of ["/rejseholdet_503605/", "/rejseholdet_503605/rejseholdet_503615", "/program/lise-noergaard_-ikke-kun-en-pige_362031"]) {
			const r = await get(path);
			expect(r.status).toBe(200);
			expect(r.text).not.toContain("Se originalen");
			expect(r.text).not.toContain("www.dr.dk/drtv");
		}
	});
});

describe("what's new", () => {
	test("has a bell in every page's header, which leads to /nyt/", async () => {
		for (const path of ["/", "/favoritter/", "/rejseholdet_503605/"]) {
			const r = await get(path);
			expect(r.text).toContain('<a class="bell-link js-bell" href="/nyt/" aria-label="Nyt til dig">');
			expect(r.text).toContain(`src="/static/news.js?v=`);
		}
	});

	test("has a page of its own, for phones, without asking DR", async () => {
		const r = await get("/nyt/");
		expect(r.status).toBe(200);
		expect(r.text).toContain("<title>Nyt til dig - ");
		expect(r.text).toContain('<div class="news js-news" id="news-page" data-full>');
		expect(r.text).toContain('aria-label="Nyt til dig" aria-current="page"');
		expect(dr.requested).toEqual([]);
	});
});

describe("search", () => {
	test("finds series, films and episodes", async () => {
		const r = await get("/search/?query=matador");
		expect(r.status).toBe(200);
		expect(r.text).toContain('href="/matador_540736/"');
		expect(r.text).toContain('href="/program/lise-noergaard_-ikke-kun-en-pige_362031"');
		expect(r.text).toContain('href="/557181/matadorerne_-den-foerste-kaempe_557186"');
		expect(r.text).not.toContain("Ingen resultater");
		// Labelled by kind
		expect(r.text).toContain('<span class="tag tag-type">Serie</span>');
		expect(r.text).toContain('<span class="tag tag-type">Film</span>');
		expect(r.text).toContain('<span class="tag tag-type">Afsnit</span>');
		// Films and episodes can be marked as seen, series can't from here
		expect(r.text).toContain('data-video-id="362031"');
		expect(r.text).not.toContain('data-video-id="540736"');
		// What was searched for stays in the header's search box
		expect(r.text).toContain('placeholder="Søg efter serier, film og afsnit" aria-label="Søg" value="matador"');
	});

	test("without a query asks for one", async () => {
		for (const path of ["/search/", "/search/?query=", "/search/?query=++"]) {
			const r = await get(path);
			expect(r.status).toBe(200);
			expect(r.text).toContain("Søg efter serier, film og afsnit");
		}
		expect(dr.requested.filter(p => p.startsWith("search:"))).toEqual([]);
	});

	test("without results", async () => {
		dr.answer = path => (path == "/search" ? {series: {items: []}, playable: {items: []}} : undefined);
		const r = await get("/search/?query=xyzzy");
		expect(r.status).toBe(200);
		expect(r.text).toContain("Ingen resultater for „xyzzy“");
	});

	test("is kept for a while", async () => {
		await get("/search/?query=matador");
		await get("/search/?query=matador&page=2");
		expect(dr.requested.filter(p => p.startsWith("search:"))).toEqual(["search:matador"]);
	});
});

describe("errors", () => {
	test("DR being down isn't a missing page", async () => {
		dr.down = true;
		// Even the channels can't be fetched, so the front page fails too
		for (const path of ["/", "/rejseholdet_503605/"]) {
			const r = await get(path);
			expect(r.status).toBe(503);
			expect(r.text).toContain("Programmerne kan ikke hentes lige nu");
		}
	});

	test("what was got before is used while DR is down", async () => {
		const before = (await get("/rejseholdet_503605/")).text;
		expireAll();
		dr.down = true;
		const r = await get("/rejseholdet_503605/");
		expect(r.status).toBe(200);
		expect(r.text).toBe(before);
	});

	test("a page that isn't anything", async () => {
		const r = await get("/a/b/c/d");
		expect(r.status).toBe(404);
		expect(r.text).toContain("Siden findes ikke");
	});
});
