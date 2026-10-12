// dktv: an unofficial way to watch DR's programmes, as a Cloudflare Worker

import {Hono, type Context, type MiddlewareHandler} from "hono";
import * as alerts from "./alerts";
import {vapidKeys} from "./alerts";
import {peek, REFRESHES_PER_VISIT} from "./cache";
import {getCategories, getList, getPage} from "./discover";
import {Budget, type Ctx, DRUnavailable, type Env, NotFound, OverBudget} from "./dr";
import {getChannels, getSchedules} from "./live";
import {search} from "./search";
import {allEpisodes, getLongDescription, getProgram, getShow, itemId, rssFeed, type Show, thumbnail} from "./show";
import * as passkeys from "./passkeys";
import * as syncStore from "./sync";
import {clock, copenhagen, isNew} from "./time";
import type {Html} from "./views/html";
import type {Site} from "./views/layout";
import * as pages from "./views/pages";
import {Refused} from "./webauthn";
import {isPushService} from "./webpush";

type App = {Bindings: Env; Variables: {ctx: Ctx}};

const DEFAULT_SOURCE_URL = "https://github.com/devjoda/dktv";

// How many of DR's rows the front page shows, and of its featured programmes, like DR's own
const FRONT_PAGE_ROWS = 8;
const FEATURED = 12;
// How many favourites to describe at once, of each kind
const MAX_FAVORITES = 50;
// Far more than a viewer's favourites and progress take up
const MAX_SYNC_SIZE = 2 * 1024 * 1024;
// Far more than a passkey or a subscription to notifications take up
const MAX_ACCOUNT_REQUEST = 64 * 1024;

const app = new Hono<App>();

app.use("*", async (c, next) => {
	c.set("ctx", {
		env: c.env,
		budget: new Budget(),
		refreshes: REFRESHES_PER_VISIT,
		incomplete: false,
		pending: new Map(),
		waitUntil: promise => c.executionCtx.waitUntil(promise),
		origin: new URL(c.req.url).origin,
	});
	await next();
});

/** If today is April 1st in Denmark, the age of Danmarks Radio in years */
function birthday(): number | undefined {
	const today = copenhagen(clock.now());
	return today.month == 3 && today.day == 1 ? today.year - 1925 : undefined;
}

function site(c: Context<App>, query?: string): Site {
	return {
		serviceName: c.env.SERVICE_NAME || "dktv",
		sourceURL: c.env.SOURCE_URL || DEFAULT_SOURCE_URL,
		path: c.req.path,
		query,
		birthday: birthday(),
	};
}

function render(c: Context<App>, page: Html, status: 200 | 404 | 500 | 503 = 200) {
	return c.html(page.text, status);
}

/**
 * Keeps the pages a visit gets in Cloudflare's cache for some seconds, since they're the
 * same for everyone: what's personal is filled in by the browser. Browsers keep them a minute.
 */
function edgeCached(seconds: number): MiddlewareHandler<App> {
	return async (c, next) => {
		const ctx = c.get("ctx");
		const cache = typeof caches != "undefined" ? caches.default : null;
		if (cache == null) {
			await next();
			return;
		}
		// A new version of the Worker has new pages
		const url = new URL(c.req.url);
		url.searchParams.set("_version", c.env.VERSION?.id ?? "dev");
		const key = new Request(url.toString());
		ctx.budget.spend();
		const hit = await cache.match(key);
		if (hit) {
			const response = new Response(hit.body, hit);
			response.headers.set("Cache-Control", "public, max-age=60");
			return response;
		}
		await next();
		if (c.res.status != 200) {
			return;
		}
		// The next visit gets what this one left out
		if (ctx.incomplete) {
			c.res.headers.set("Cache-Control", "no-cache");
			return;
		}
		if (ctx.budget.left > 0) {
			ctx.budget.spend();
			const kept = new Response(c.res.clone().body, c.res);
			kept.headers.set("Cache-Control", `public, max-age=${seconds}`);
			ctx.waitUntil(cache.put(key, kept).catch(e => console.log("Could not keep the page", c.req.url, String(e))));
		}
		c.res.headers.set("Cache-Control", "public, max-age=60");
	};
}

const MINUTE = 60;

// Like rejseholdet_503605, or fiktionsserier
const SLUG = /^[\w-]+$/;

/**
 * Sends the visitor to the page for a slug from the URL, like /rejseholdet_503605/.
 * Only for what could be one, since URLs like /serie/%2F%2Fexample.com would otherwise
 * lead to //example.com/, another site.
 */
function redirectTo(c: Context<App>, prefix: string, slug: string, status: 302 | 308) {
	if (!SLUG.test(slug)) {
		throw new NotFound(`${slug} isn't anything here`);
	}
	return c.redirect(`${prefix}${slug}/`, status);
}

app.get("/", edgeCached(2 * MINUTE), async c => {
	const ctx = c.get("ctx");
	const channels = await getChannels(ctx);
	const [page, schedules] = await Promise.all([getPage(ctx, "/", FRONT_PAGE_ROWS), getSchedules(ctx, channels)]);
	// Only the ones fetched already, so the front page never waits for them; the others are fetched for later
	const recommended = (c.env.RECOMMENDED_SHOWS ?? "").split(":").filter(Boolean);
	const shows: Show[] = [];
	for (const slug of recommended) {
		let id: string;
		try {
			id = itemId(slug);
		} catch {
			continue;
		}
		const show = peek<Show>(`show:${id}`);
		if (show) {
			shows.push(show);
		} else {
			ctx.waitUntil(getShow(ctx, slug).catch(e => console.log("Could not fetch recommended show", slug, String(e))));
		}
	}
	return render(c, pages.indexPage(site(c), {page, featured: page?.featured.slice(0, FEATURED) ?? [], shows, channels, schedules}));
});

app.get("/kategorier/", edgeCached(10 * MINUTE), async c => {
	return render(c, pages.categoriesPage(site(c), await getCategories(c.get("ctx"))));
});

app.get("/kategorier/:slug/", edgeCached(10 * MINUTE), async c => {
	const ctx = c.get("ctx");
	const slug = c.req.param("slug");
	const category = (await getCategories(ctx)).find(found => found.url == `/kategorier/${slug}/`);
	if (category === undefined) {
		throw new NotFound(`No category ${slug}`);
	}
	const page = await getPage(ctx, `/kategorier/${slug}`, 12);
	if (page === undefined) {
		throw new DRUnavailable(`No page for the category ${slug}`);
	}
	return render(c, pages.categoryPage(site(c), {category, page}));
});

app.get("/kategorier/:slug", c => redirectTo(c, "/kategorier/", c.req.param("slug"), 308));

/** All of a row of DR's, like all films from A to Å */
app.get("/liste/:id{[0-9]+}/", edgeCached(10 * MINUTE), async c => {
	const found = await getList(c.get("ctx"), c.req.param("id"));
	if (found === undefined) {
		throw new NotFound(`No list ${c.req.param("id")}`);
	}
	// The row's own title, which DR's list may not have, like "A - Å" for "Film | A - Å"
	const title = c.req.query("titel") || found.title.replaceAll(" | ", ": ");
	return render(c, pages.listPage(site(c), {title, cards: found.cards}));
});

app.get("/liste/:id{[0-9]+}", c => c.redirect(`/liste/${c.req.param("id")}/`, 308));

app.get("/live/", edgeCached(2 * MINUTE), async c => {
	const ctx = c.get("ctx");
	const channels = await getChannels(ctx);
	return render(c, pages.liveIndexPage(site(c), {channels, schedules: await getSchedules(ctx, channels)}));
});

app.get("/live/:channel", edgeCached(2 * MINUTE), async c => {
	const ctx = c.get("ctx");
	const channels = await getChannels(ctx);
	const slug = c.req.param("channel");
	if (!Object.hasOwn(channels, slug)) {
		throw new NotFound(`No channel ${slug}`);
	}
	const schedules = await getSchedules(ctx, channels);
	return render(c, pages.livePage(site(c), {slug, channels, programmes: schedules[channels[slug].id] ?? []}));
});

app.get("/favoritter/", edgeCached(60 * MINUTE), c => render(c, pages.favoritesPage(site(c))));

app.get("/sync/", edgeCached(60 * MINUTE), c => render(c, pages.syncPage(site(c))));

/** Each of ids described, until a visit can't ask DR about more. What's left is for the next visit. */
async function describeAll<T>(ids: string[], describe: (id: string) => Promise<T>): Promise<[Record<string, T>, string[]]> {
	const found: Record<string, T> = {};
	const more = ids.slice(MAX_FAVORITES);
	const results = await inBatches(ids.slice(0, MAX_FAVORITES), 4, async id => {
		try {
			return await describe(id);
		} catch (e) {
			if (e instanceof OverBudget) {
				more.push(id);
			} else {
				// One DR no longer has, or DR being down, shouldn't take the others with it
				console.log("Could not describe favourite", id, String(e));
			}
			return undefined;
		}
	});
	ids.slice(0, MAX_FAVORITES).forEach((id, i) => {
		if (results[i] !== undefined) {
			found[id] = results[i];
		}
	});
	return [found, more];
}

/** f for each of items, a few at a time */
async function inBatches<T, R>(items: T[], size: number, f: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const i = next++;
			results[i] = await f(items[i]);
		}
	}
	await Promise.all(Array.from({length: Math.min(size, items.length)}, worker));
	return results;
}

/**
 * Fresh details about the viewer's favourite shows and films, like
 * ?shows=rejseholdet_503605:matador_540736&films=lise-noergaard_-ikke-kun-en-pige_362031.
 * Which they are is kept in the viewer's browser, not here. Those there wasn't time for
 * are under "more", to ask about again.
 */
app.get("/favorites.json", async c => {
	const ctx = c.get("ctx");
	const ids = (param: string) => (c.req.query(param) ?? "").split(":").filter(Boolean);
	const [[shows, moreShows], [films, moreFilms]] = await Promise.all([
		describeAll(ids("shows"), async slug => {
			const show = await getShow(ctx, slug);
			const episodes = allEpisodes(show);
			return {
				title: show.title,
				url: `/${show.url}/`,
				image: thumbnail(show.wallpaper) ?? null,
				seasons: show.seasons.length,
				episodes: episodes.length,
				episode_ids: episodes.map(e => e.videoId),
				new: episodes.length > 0 && isNew(episodes.at(-1)!.pubdate),
				expires: show.expires ?? null,
			};
		}),
		describeAll(ids("films"), async slug => {
			const program = await getProgram(ctx, slug);
			return {title: program.title, url: `/program/${slug}`, image: thumbnail(program.wallpaper) ?? null, minutes: program.minutes ?? null, expires: program.expires ?? null};
		}),
	]);
	const more = moreShows.length || moreFilms.length ? {more: {shows: moreShows, films: moreFilms}} : {};
	return c.json({shows, films, ...more});
});

app.get("/program/:id", edgeCached(10 * MINUTE), async c => {
	const program = await getProgram(c.get("ctx"), c.req.param("id"));
	return render(c, pages.videoPage(site(c), {e: program, description: program.description}));
});

app.get("/serie/:showid", c => redirectTo(c, "/", c.req.param("showid"), 302));
app.get("/drtv/serie/:showid", c => redirectTo(c, "/", c.req.param("showid"), 302));

app.get("/search/", edgeCached(15 * MINUTE), async c => {
	const query = (c.req.query("query") ?? "").trim();
	const results = query ? await search(c.get("ctx"), query) : undefined;
	return render(c, pages.searchPage(site(c, query), {query, results}));
});

app.post("/sync/", async c => {
	try {
		return c.json({code: await syncStore.create(c.get("ctx"))}, 201);
	} catch (e) {
		console.log("Could not make a sync code", String(e));
		return c.json({error: "Serveren kan ikke gemme noget lige nu. Prøv igen senere."}, 503);
	}
});

/** Takes what a device knows, and gives back that merged with what the others knew */
app.post("/sync/:code", async c => {
	const code = syncStore.normalizeCode(c.req.param("code"));
	if (code === undefined) {
		return c.json({error: "Koden findes ikke."}, 404);
	}
	if (Number(c.req.header("Content-Length") ?? 0) > MAX_SYNC_SIZE) {
		return c.json({error: "For meget at synkronisere."}, 413);
	}
	// Only JSON, which other sites can't send here without the browser asking first
	let data: unknown;
	try {
		if (!(c.req.header("Content-Type") ?? "").startsWith("application/json")) {
			throw new TypeError("Not JSON");
		}
		data = await c.req.json();
	} catch {
		data = undefined;
	}
	if (data == null || typeof data != "object" || Array.isArray(data)) {
		return c.json({error: "Forventede JSON."}, 400);
	}
	let merged;
	try {
		merged = await syncStore.sync(c.get("ctx"), code, data);
	} catch (e) {
		console.log("Could not sync", String(e));
		return c.json({error: "Serveren kan ikke gemme noget lige nu. Prøv igen senere."}, 503);
	}
	if (merged === undefined) {
		return c.json({error: "Koden findes ikke."}, 404);
	}
	return c.json(merged);
});

app.delete("/sync/:code", async c => {
	const code = syncStore.normalizeCode(c.req.param("code"));
	if (code !== undefined) {
		try {
			await syncStore.remove(c.get("ctx"), code);
		} catch (e) {
			console.log("Could not delete synced data", String(e));
			return c.json({error: "Serveren kan ikke slette noget lige nu. Prøv igen senere."}, 503);
		}
	}
	return c.body(null, 204);
});

/** What this server can do besides syncing, which the browser's scripts ask before offering it */
app.get("/konto.json", c => c.json({push: vapidKeys(c.env)?.publicKey ?? null, passkeys: true}));

/** A request's JSON body, or undefined if it has none. Only JSON, which other sites can't send without the browser asking first. */
async function jsonBody(c: Context<App>): Promise<Record<string, unknown> | undefined> {
	if (!(c.req.header("Content-Type") ?? "").startsWith("application/json") || Number(c.req.header("Content-Length") ?? 0) > MAX_ACCOUNT_REQUEST) {
		return undefined;
	}
	try {
		const body = await c.req.json();
		return body && typeof body == "object" && !Array.isArray(body) ? body : undefined;
	} catch {
		return undefined;
	}
}

const BASE64URL = /^[\w-]{1,1024}$/;
const UNAVAILABLE = "Serveren kan ikke gemme noget lige nu. Prøv igen senere.";
const UNKNOWN_CODE = "Koden findes ikke.";

/** The code in a URL, or undefined if it can't be one */
const codeOf = (c: Context<App>) => syncStore.normalizeCode(c.req.param("code") ?? "");

/** Runs something that keeps or reads viewers' data, answering 503 when the database fails */
async function stored(c: Context<App>, f: () => Promise<Response>): Promise<Response> {
	try {
		return await f();
	} catch (e) {
		if (e instanceof Refused) {
			console.log("A passkey was refused:", String(e));
			return c.json({error: "Adgangsnøglen kunne ikke bruges. Prøv igen."}, 400);
		}
		console.log("Could not use the database", String(e));
		return c.json({error: UNAVAILABLE}, 503);
	}
}

/** Notifies this device about new episodes of the code's favourite series */
app.post("/push/:code", async c => {
	const code = codeOf(c);
	const body = await jsonBody(c);
	const keys = body?.keys as Record<string, unknown> | undefined;
	if (code === undefined) {
		return c.json({error: UNKNOWN_CODE}, 404);
	}
	if (typeof body?.endpoint != "string" || !isPushService(body.endpoint) || body.endpoint.length > 1024
		|| typeof keys?.p256dh != "string" || !BASE64URL.test(keys.p256dh) || typeof keys?.auth != "string" || !BASE64URL.test(keys.auth)) {
		return c.json({error: "Forventede et abonnement på beskeder."}, 400);
	}
	if (!vapidKeys(c.env)) {
		return c.json({error: "Serveren kan ikke sende beskeder."}, 501);
	}
	const subscription = {endpoint: body.endpoint, p256dh: keys.p256dh, auth: keys.auth};
	return stored(c, async () => {
		const result = await alerts.subscribe(c.get("ctx"), code, subscription);
		if (result == "unknown code") {
			return c.json({error: UNKNOWN_CODE}, 404);
		}
		if (result == "too many") {
			return c.json({error: `Beskeder kan være slået til på højst ${alerts.MAX_DEVICES} enheder.`}, 409);
		}
		return c.body(null, 201);
	});
});

app.delete("/push/:code", async c => {
	const code = codeOf(c);
	const body = await jsonBody(c);
	if (code === undefined || typeof body?.endpoint != "string") {
		return c.body(null, 204);
	}
	return stored(c, async () => {
		await alerts.unsubscribe(c.get("ctx"), code, body.endpoint as string);
		return c.body(null, 204);
	});
});

/** Where passkeys are made for: this site */
function passkeySite(c: Context<App>): passkeys.Site {
	const url = new URL(c.req.url);
	return {origin: url.origin, rpId: url.hostname, name: c.env.SERVICE_NAME || "dktv"};
}

app.post("/passkeys/:code/options", async c => {
	const code = codeOf(c);
	if (code === undefined) {
		return c.json({error: UNKNOWN_CODE}, 404);
	}
	return stored(c, async () => {
		const options = await passkeys.creationOptions(c.get("ctx"), passkeySite(c), code);
		return options ? c.json(options) : c.json({error: UNKNOWN_CODE}, 404);
	});
});

app.post("/passkeys/:code", async c => {
	const code = codeOf(c);
	const body = await jsonBody(c);
	const credential = body?.credential as passkeys.Creation | undefined;
	if (code === undefined) {
		return c.json({error: UNKNOWN_CODE}, 404);
	}
	if (typeof body?.user != "string" || !BASE64URL.test(body.user) || typeof credential?.id != "string" || !BASE64URL.test(credential.id)
		|| typeof credential.response?.clientDataJSON != "string" || typeof credential.response?.attestationObject != "string") {
		return c.json({error: "Forventede en adgangsnøgle."}, 400);
	}
	return stored(c, async () => c.json(await passkeys.register(c.get("ctx"), passkeySite(c), code, body.user as string, credential, c.req.header("User-Agent") ?? ""), 201));
});

app.get("/passkeys/:code", async c => {
	const code = codeOf(c);
	if (code === undefined) {
		return c.json([]);
	}
	return stored(c, async () => c.json(await passkeys.list(c.get("ctx"), code)));
});

app.delete("/passkeys/:code/:id", async c => {
	const code = codeOf(c);
	if (code === undefined) {
		return c.body(null, 204);
	}
	return stored(c, async () => {
		await passkeys.remove(c.get("ctx"), code, c.req.param("id"));
		return c.body(null, 204);
	});
});

app.post("/login/options", async c => stored(c, async () => c.json(await passkeys.requestOptions(c.get("ctx"), passkeySite(c)))));

/** Gives the browser the sync code of the passkey it logged in with */
app.post("/login", async c => {
	const body = await jsonBody(c);
	const credential = body?.credential as passkeys.Assertion | undefined;
	if (typeof credential?.id != "string" || !BASE64URL.test(credential.id) || typeof credential.response?.clientDataJSON != "string"
		|| typeof credential.response?.authenticatorData != "string" || typeof credential.response?.signature != "string") {
		return c.json({error: "Forventede en adgangsnøgle."}, 400);
	}
	return stored(c, async () => c.json({code: await passkeys.login(c.get("ctx"), passkeySite(c), credential)}));
});

app.get("/:feed{[^/]+\\.xml}", async c => {
	const slug = c.req.param("feed").slice(0, -".xml".length);
	const show = await getShow(c.get("ctx"), slug);
	return c.body(rssFeed(show, new URL(c.req.url).origin), 200, {"Content-Type": "application/rss+xml"});
});

/**
 * Plays a show's episode by its number in a season, like DR's "Episode 1:7" says:
 * in the season with the id ?saeson=, or the newest one
 */
app.get("/:showid/afsnit/:number{[0-9]+}", async c => {
	const show = await getShow(c.get("ctx"), c.req.param("showid"));
	const seasonId = c.req.query("saeson");
	const season = show.seasons.find(s => seasonId && s.id == seasonId) ?? show.seasons.at(-1)!;
	if (season.episodes.length == 0) {
		return c.redirect(`/${show.url}/`, 302);
	}
	const number = Math.min(Math.max(Number(c.req.param("number")), 1), season.episodes.length);
	return c.redirect(`/${show.url}/${season.episodes[number - 1].link}`, 302);
});

app.get("/:showid/", edgeCached(10 * MINUTE), async c => {
	return render(c, pages.showPage(site(c), await getShow(c.get("ctx"), c.req.param("showid"))));
});

app.get("/:showid/:episode", edgeCached(10 * MINUTE), async c => {
	const ctx = c.get("ctx");
	const show = await getShow(ctx, c.req.param("showid"));
	const wanted = c.req.param("episode");
	const episodes = show.seasons.flatMap(season => season.episodes.map(e => ({season, e})));
	const i = episodes.findLastIndex(({e}) => e.url.includes(wanted));
	if (i < 0) {
		throw new NotFound(`${show.url} has no episode ${wanted}`);
	}
	const {season, e} = episodes[i];

	/** The episode before or after this one, if there is one */
	function neighbour(j: number): pages.Neighbour | undefined {
		if (j < 0 || j >= episodes.length) {
			return undefined;
		}
		const other = episodes[j];
		return {
			url: `/${show.url}/${other.e.link}`,
			title: other.season === season ? other.e.title : `${other.season.title}, ${other.e.title}`,
			wallpaper: other.e.wallpaper,
			minutes: other.e.minutes,
		};
	}

	const description = await getLongDescription(ctx, e);
	return render(c, pages.videoPage(site(c), {show, e, description, previous: neighbour(i - 1), next: neighbour(i + 1)}));
});

// Like /rejseholdet_503605, for /rejseholdet_503605/
app.get("/:slug{[^/.]+}", c => redirectTo(c, "/", c.req.param("slug"), 308));

function errorPage(c: Context<App>, title: string, message: string, status: 404 | 500 | 503) {
	return render(c, pages.errorPage(site(c), {title, message}), status);
}

function notFound(c: Context<App>) {
	return errorPage(c, "Siden findes ikke", "Vi kunne ikke finde det, du leder efter. Måske er det ikke længere tilgængeligt på DRTV.", 404);
}

app.notFound(notFound);

app.onError((e, c) => {
	if (e instanceof NotFound) {
		return notFound(c);
	}
	if (e instanceof DRUnavailable || e instanceof OverBudget) {
		console.log("DR is unavailable:", String(e));
		return errorPage(c, "DR svarer ikke lige nu", "Siden kunne ikke hentes fra DR. Prøv igen om lidt.", 503);
	}
	console.error("Error on", c.req.url, e);
	return errorPage(c, "Noget gik galt", "Der skete en fejl, da siden skulle vises. Prøv igen om lidt.", 500);
});

export {app};

export default {
	fetch: app.fetch,

	/** Every minute: checks the followed series for new episodes, and sends notifications */
	async scheduled(_event: ScheduledController, env: Env, executionCtx: ExecutionContext) {
		const keys = vapidKeys(env);
		if (!keys) {
			return;
		}
		await alerts.run({
			env,
			budget: new Budget(),
			refreshes: 0,
			incomplete: false,
			pending: new Map(),
			waitUntil: promise => executionCtx.waitUntil(promise),
			origin: "https://scheduled.invalid",
		}, keys);
	},
} satisfies ExportedHandler<Env>;
