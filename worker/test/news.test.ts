// What the bell says, "Nyt til dig": its lines and its number, worked out by favorites.js and news.js in the browser,
// and run here in a context of their own, with a browser's storage and fetch stood in for

import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createContext, runInContext} from "node:vm";
import {beforeEach, describe, expect, test} from "vitest";

const STATIC = join(__dirname, "..", "..", "drtvrss", "static");
const SCRIPTS = ["progress.js", "favorites.js", "sync.js", "account.js", "news.js", "next.js"];
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 14, 12);

/** A browser's localStorage, which only keeps text */
class Storage {
	items = new Map<string, string>();
	get length() {
		return this.items.size;
	}
	key(i: number) {
		return [...this.items.keys()][i] ?? null;
	}
	getItem(key: string) {
		return this.items.get(key) ?? null;
	}
	setItem(key: string, value: unknown) {
		this.items.set(key, String(value));
	}
	removeItem(key: string) {
		this.items.delete(key);
	}
}

interface Browser {
	run: (code: string) => any;
	storage: Storage;
	asked: string[];
	answers: unknown[];
}

function browser(): Browser {
	const storage = new Storage();
	const asked: string[] = [];
	const answers: unknown[] = [];
	const listeners = {addEventListener() {}, removeEventListener() {}, dispatchEvent() {}};
	const sandbox: Record<string, unknown> = {
		// The context's own Date and the rest, which tests may change
		console, Event, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams,
		localStorage: storage,
		sessionStorage: new Storage(),
		navigator: {userAgent: "Node"},
		document: {...listeners, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null},
		fetch: async (url: string) => {
			asked.push(url);
			const answer = answers.shift() ?? {shows: {}, films: {}};
			return {ok: true, status: 200, json: async () => structuredClone(answer)};
		},
	};
	sandbox.window = {...listeners};
	const context = createContext(sandbox);
	for (const name of SCRIPTS) {
		runInContext(readFileSync(join(STATIC, name), "utf8"), context, {filename: name});
	}
	return {run: code => runInContext(code, context), storage, asked, answers};
}

/** An episode, like /favorites.json has them */
function episode(id: string, published: number, extra: Record<string, unknown> = {}) {
	return {id, title: `Afsnit ${id}`, season: 11, number: Number(id), url: `/badehotellet_1/afsnit_${id}`, published, image: `https://example.com/${id}.jpg`, ...extra};
}

function series(newEpisodes: unknown[], extra: Record<string, unknown> = {}) {
	return {title: "Badehotellet", url: "/badehotellet_1/", image: "https://example.com/show.jpg", seasons: 11, episodes: 80, episode_ids: [], new: true, new_episodes: newEpisodes, expires: null, ...extra};
}

const favorite = (added: number, id = "badehotellet_1", kind = "show") => ({id, kind, title: "Badehotellet", image: null, added});

let b: Browser;

beforeEach(() => {
	b = browser();
});

/** What the bell has to say, at now: its lines, what's leaving, and its number */
function news(favorites: unknown[], details: unknown, now = NOW) {
	b.storage.setItem("favorites", JSON.stringify(favorites));
	const lines = b.run(`newsLines(loadFavorites(), ${JSON.stringify(details)}, ${now})`);
	const leaving = b.run(`leavingNews(loadFavorites(), ${JSON.stringify(details)}, ${now})`);
	return {lines, leaving, count: lines.length + leaving.length};
}

const details = (shows: Record<string, unknown>, films: Record<string, unknown> = {}) =>
	({at: NOW, shows, films, pending: {shows: [], films: []}});

const watched = (id: string, extra: Record<string, unknown> = {}) =>
	b.storage.setItem(`progress_${id}`, JSON.stringify({time: 0, watched: true, updated: 1, ...extra}));

describe("the lines", () => {
	test("a whole season at once is one line", () => {
		const season = Array.from({length: 8}, (_, i) => episode(String(8 - i), NOW - DAY - i * 1000));
		const {lines} = news([favorite(0)], details({badehotellet_1: series(season)}));
		expect(lines).toHaveLength(1);
		expect([lines[0].show, lines[0].title, lines[0].label]).toEqual(["Badehotellet", "8 nye afsnit", null]);
		// To the first of them, as none are seen
		expect(lines[0].url).toBe("/badehotellet_1/afsnit_1");
	});

	test("one episode says its name and which it is, and each day has a line of its own, the newest first", () => {
		const {lines} = news([favorite(0)], details({badehotellet_1: series([episode("3", NOW - DAY), episode("2", NOW - 3 * DAY)])}));
		expect(lines.map((l: any) => [l.show, l.title, l.label])).toEqual([["Badehotellet", "Afsnit 3", "S11 E3"], ["Badehotellet", "Afsnit 2", "S11 E2"]]);
		expect(lines[0].image).toBe("https://example.com/3.jpg");
		expect(b.run(`daysAgo(${NOW - DAY}, ${NOW})`)).toBe("i går");
		expect(b.run(`daysAgo(${NOW}, ${NOW})`)).toBe("i dag");
		expect(b.run(`daysAgo(${NOW - 3 * DAY}, ${NOW})`)).toBe("for 3 dage siden");
	});

	test("only of the last two weeks", () => {
		const {lines} = news([favorite(0)], details({badehotellet_1: series([episode("3", NOW - 15 * DAY)])}));
		expect(lines).toEqual([]);
	});

	test("only have what the viewer hasn't seen, started or opened from the bell", () => {
		const season = [episode("3", NOW - DAY + 2), episode("2", NOW - DAY + 1), episode("1", NOW - DAY)];
		watched("1");
		let {lines} = news([favorite(0)], details({badehotellet_1: series(season)}));
		expect([lines[0].title, lines[0].url]).toEqual(["2 nye afsnit", "/badehotellet_1/afsnit_2"]);
		// Started
		b.storage.setItem("progress_2", JSON.stringify({time: 120, duration: 2400, watched: false, updated: 1}));
		({lines} = news([favorite(0)], details({badehotellet_1: series(season)})));
		expect([lines[0].title, lines[0].label, lines[0].url]).toEqual(["Afsnit 3", "S11 E3", "/badehotellet_1/afsnit_3"]);
		// Opened from the bell
		b.run(`Date.now = () => ${NOW}`);
		b.run(`markNewsOpened("3")`);
		expect(news([favorite(0)], details({badehotellet_1: series(season)})).lines).toEqual([]);
	});

	test("favourites leaving within a week say when, as the rest of the site does", () => {
		b.run(`Date.now = () => ${NOW}`);
		const {leaving} = news([favorite(0), favorite(0, "en-film_2", "film")], details(
			{badehotellet_1: series([], {expires: NOW + 3 * DAY})},
			{"en-film_2": {title: "En film", url: "/program/en-film_2", image: null, minutes: 90, expires: NOW + 20 * DAY}},
		));
		expect(leaving.map((l: any) => [l.title, l.label])).toEqual([["Badehotellet", "Udløber om 3 dage"]]);
	});

	test("\"Ryd alle\" empties it of what's there, but not of what comes after", () => {
		const leavingSoon = {expires: NOW + 3 * DAY};
		const before = details({badehotellet_1: series([episode("3", NOW - DAY), episode("2", NOW - 2 * DAY)], leavingSoon)});
		expect(news([favorite(0)], before).count).toBe(3);
		b.run(`Date.now = () => ${NOW}`);
		b.run("scheduleSync = () => {}");
		b.run("clearNews()");
		expect(b.storage.getItem("newsCleared")).toBe(String(NOW));
		expect(news([favorite(0)], before).count).toBe(0);
		// An episode heard of since, though DR dates it from before
		const after = details({badehotellet_1: series([episode("4", NOW - DAY / 2, {known: NOW + 1000}), episode("3", NOW - DAY)], leavingSoon)});
		expect(news([favorite(0)], after, NOW + 2000).lines.map((l: any) => l.title)).toEqual(["Afsnit 4"]);
	});
});

describe("the number", () => {
	test("is how many lines there are, and says at most 9+", () => {
		const season = Array.from({length: 10}, (_, i) => episode(String(i + 1), NOW - (i + 1) * DAY));
		expect(news([favorite(NOW - 30 * DAY)], details({badehotellet_1: series(season)})).count).toBe(10);
		// As updateBell shows it
		const badge = {hidden: true, textContent: ""};
		const bell = {querySelector: () => badge, label: "", setAttribute(_: string, value: string) { this.label = value; }};
		b.run("document").querySelectorAll = () => [bell];
		b.storage.setItem("favoriteDetails", JSON.stringify(details({badehotellet_1: series(season)})));
		b.run(`Date.now = () => ${NOW}`);
		b.run("updateBell()");
		expect([badge.hidden, badge.textContent, bell.label]).toEqual([false, "9+", "Nyt til dig, mere end 9 nye"]);
		// A number, not a dot, however often the bell is opened
		for (let i = 1; i <= 7; i++) {
			watched(String(i));
		}
		b.run("updateBell()");
		expect([badge.hidden, badge.textContent, bell.label]).toEqual([false, "3", "Nyt til dig, 3 nye"]);
		// And nothing, once it's all seen
		for (let i = 8; i <= 10; i++) {
			watched(String(i));
		}
		b.run("updateBell()");
		expect([badge.hidden, bell.label]).toEqual([true, "Nyt til dig"]);
	});
});

describe("what's kept of /favorites.json", () => {
	const answer = (newEpisodes: unknown[], more?: unknown) => ({shows: {badehotellet_1: series(newEpisodes)}, films: {}, ...(more ? {more} : {})});

	beforeEach(() => {
		b.storage.setItem("favorites", JSON.stringify([favorite(NOW - 30 * DAY)]));
	});

	test("is used for half an hour, and the bell asks for nothing of its own while it is", async () => {
		b.answers.push(answer([episode("3", NOW - DAY)]));
		await b.run("loadFavoriteDetails(false)");
		expect(b.asked).toEqual(["/favorites.json?shows=badehotellet_1&films="]);
		const kept = JSON.parse(b.storage.getItem("favoriteDetails")!);
		expect(kept.shows.badehotellet_1.new_episodes[0].id).toBe("3");
		// Opening the bell, and other pages, use it
		await b.run("loadFavoriteDetails(true)");
		await b.run("loadFavoriteDetails(false)");
		expect(b.asked).toHaveLength(1);
		// Until it's half an hour old
		kept.at = Date.now() - 31 * 60 * 1000;
		b.storage.setItem("favoriteDetails", JSON.stringify(kept));
		await b.run("loadFavoriteDetails(false)");
		expect(b.asked).toHaveLength(2);
	});

	test("on most pages, only the first answer; the rest when all of them are shown", async () => {
		b.storage.setItem("favorites", JSON.stringify([favorite(1), favorite(1, "matador_2")]));
		b.answers.push(answer([], {shows: ["matador_2"], films: []}), {shows: {matador_2: series([], {title: "Matador"})}, films: {}});
		await b.run("loadFavoriteDetails(false)");
		expect(b.asked).toEqual(["/favorites.json?shows=badehotellet_1%3Amatador_2&films="]);
		expect(JSON.parse(b.storage.getItem("favoriteDetails")!).pending.shows).toEqual(["matador_2"]);
		await b.run("loadFavoriteDetails(false)");
		expect(b.asked).toHaveLength(1);
		// Like opening the bell: only what was left
		await b.run("loadFavoriteDetails(true)");
		expect(b.asked).toEqual(["/favorites.json?shows=badehotellet_1%3Amatador_2&films=", "/favorites.json?shows=matador_2&films="]);
		const kept = JSON.parse(b.storage.getItem("favoriteDetails")!);
		expect(kept.pending.shows).toEqual([]);
		expect(kept.shows.matador_2.title).toBe("Matador");
	});

	test("notes when the browser first heard of each episode", async () => {
		b.answers.push(answer([episode("2", NOW - 3 * DAY)]));
		await b.run("loadFavoriteDetails(false)");
		// The first time, there all along
		let kept = JSON.parse(b.storage.getItem("favoriteDetails")!);
		expect(kept.shows.badehotellet_1.new_episodes[0].known).toBe(NOW - 3 * DAY);
		kept.at = 0;
		b.storage.setItem("favoriteDetails", JSON.stringify(kept));
		b.answers.push(answer([episode("3", NOW - 2 * DAY), episode("2", NOW - 3 * DAY)]));
		const before = b.run("Date.now()");
		await b.run("loadFavoriteDetails(false)");
		kept = JSON.parse(b.storage.getItem("favoriteDetails")!);
		const [three, two] = kept.shows.badehotellet_1.new_episodes;
		// The new one just now, though DR dates it from before
		expect(three.known).toBeGreaterThanOrEqual(before);
		expect(two.known).toBe(NOW - 3 * DAY);
	});

	test("forgets what's no longer a favourite", async () => {
		b.storage.setItem("favoriteDetails", JSON.stringify({...details({gone_9: series([])}), at: 0}));
		b.answers.push(answer([]));
		await b.run("loadFavoriteDetails(false)");
		expect(Object.keys(JSON.parse(b.storage.getItem("favoriteDetails")!).shows)).toEqual(["badehotellet_1"]);
	});

	test("asks nothing without favourites", async () => {
		b.storage.setItem("favorites", "[]");
		await b.run("loadFavoriteDetails(true)");
		expect(b.asked).toEqual([]);
	});
});

describe("favourites", () => {
	test("a series made a favourite as both 503605 and rejseholdet_503605 is there once, by its name", () => {
		b.run(`scheduleSync = () => {}`);
		// From the front page's big picture, which has the series' number, and then from a row
		b.run(`setFavorite({id: "503605", kind: "show", title: "Rejseholdet", image: null}, true)`);
		expect(b.run(`isFavorite("rejseholdet_503605")`)).toBe(true);
		b.run(`setFavorite({id: "rejseholdet_503605", kind: "show", title: "Rejseholdet", image: null}, true)`);
		expect(b.run("loadFavorites()").map((f: any) => f.id)).toEqual(["rejseholdet_503605"]);
		// And the other way around, keeping the name
		b.run(`setFavorite({id: "503605", kind: "show", title: "Rejseholdet", image: null}, true)`);
		expect(b.run("loadFavorites()").map((f: any) => f.id)).toEqual(["rejseholdet_503605"]);
		// Removing it by either takes it away, on the other devices too
		b.run(`setFavorite({id: "503605", kind: "show", title: "Rejseholdet", image: null}, false)`);
		expect(b.run("loadFavorites()")).toEqual([]);
		expect(Object.keys(JSON.parse(b.storage.getItem("favoritesRemoved")!)).sort()).toEqual(["503605", "rejseholdet_503605"]);
	});

	test("both, as kept from before, or from another device, are shown once", () => {
		b.storage.setItem("favorites", JSON.stringify([favorite(2, "503605"), favorite(1, "rejseholdet_503605"), favorite(1, "matador_2")]));
		expect(b.run("loadFavorites()").map((f: any) => [f.id, f.added])).toEqual([["rejseholdet_503605", 2], ["matador_2", 1]]);
	});

	test("a tile says how many new episodes, up to 10+", () => {
		expect([0, 1, 2, 9, 10, 14].map(n => b.run(`newEpisodesTag(${n})`)))
			.toEqual([null, "Nyt afsnit", "2 nye afsnit", "9 nye afsnit", "10+ nye afsnit", "10+ nye afsnit"]);
	});
});

describe("the favourites page's filters", () => {
	const shows = (n: number, documentary: boolean | null = false) => Array.from({length: n}, (_, i) => [favorite(1, `serie_${documentary}_${i}`), series([], {documentary})] as const);
	const films = (n: number, documentary: boolean | null = false) => Array.from({length: n}, (_, i) => [favorite(1, `film_${documentary}_${i}`, "film"), {title: "En film", url: "/program/x", image: null, minutes: 90, documentary}] as const);

	/** The counts, and whether the filters show, for favourites with what the server said about them */
	function filters(...groups: (readonly (readonly [any, any])[])[]) {
		const all = groups.flat();
		const details = {at: NOW, pending: {shows: [], films: []}, shows: {} as Record<string, unknown>, films: {} as Record<string, unknown>};
		for (const [f, d] of all) {
			(f.kind == "film" ? details.films : details.shows)[f.id] = d;
		}
		const counts = b.run(`filterCounts(${JSON.stringify(all.map(([f]) => f))}, ${JSON.stringify(details)})`);
		return {counts, shown: b.run(`filtersWorthShowing(${JSON.stringify(counts)})`)};
	}

	test("a documentary series is under both Serier and Dokumentar", () => {
		expect(b.run(`favoriteFiltersOf(${JSON.stringify(favorite(1))}, {documentary: true})`)).toEqual(["alle", "serier", "dokumentar"]);
		expect(b.run(`favoriteFiltersOf(${JSON.stringify(favorite(1, "en-film_2", "film"))}, {documentary: true})`)).toEqual(["alle", "film", "dokumentar"]);
		expect(b.run(`favoriteFiltersOf(${JSON.stringify(favorite(1))}, {documentary: false})`)).toEqual(["alle", "serier"]);
	});

	test("count each", () => {
		expect(filters(shows(5), shows(2, true), films(3, true)).counts).toEqual({alle: 10, serier: 7, film: 3, dokumentar: 5});
	});

	test("show from 8 favourites, of more than one kind", () => {
		expect(filters(shows(5), films(3)).shown).toBe(true);
		expect(filters(shows(4), films(3)).shown).toBe(false);
		// Only series, of which none are documentaries, is one kind
		expect(filters(shows(12)).shown).toBe(false);
		// Series, some of them documentaries, are two
		expect(filters(shows(10), shows(1, true)).shown).toBe(true);
	});

	test("a favourite whose category isn't known yet is only under Alle and its kind, until it is", () => {
		// Not described yet, or kept from before DR's categories were
		expect(b.run(`favoriteFiltersOf(${JSON.stringify(favorite(1))}, undefined)`)).toEqual(["alle", "serier"]);
		expect(filters(shows(6, null), films(2, null)).counts).toEqual({alle: 8, serier: 6, film: 2, dokumentar: 0});
	});

	test("are only in the address", () => {
		expect(b.run(`chosenFilter("?vis=dokumentar")`)).toBe("dokumentar");
		expect(b.run(`chosenFilter("?vis=noget")`)).toBe("alle");
		expect(b.run(`chosenFilter("")`)).toBe("alle");
		expect([...b.storage.items.keys()].filter(key => key.includes("vis") || key.includes("filter"))).toEqual([]);
	});
});

describe("what to watch next", () => {
	const show = (id: string, title: string, extra: Record<string, unknown> = {}) => ({title, url: `/${id}/`, image: `https://example.com/${id}.jpg`, seasons: 1, episodes: 3, episode_ids: [], new: false, new_episodes: [], expires: null, ...extra});
	const started = (videoID: string, url: string, extra: Record<string, unknown> = {}) => ({videoID, time: 600, duration: 3600, watched: false, title: `Afsnit ${videoID}`, show: "Serie", url, image: null, updated: NOW - 1000, ...extra});
	const seen = (videoID: string, updated = NOW - 5000) => ({videoID, time: 0, duration: 3600, watched: true, updated});

	/** The suggestions after what plays at `current`, with the browser's favourites, progress and kept details */
	function suggest({current = "/badehotellet_1/afsnit_9", favorites = [] as any[], shows = {} as Record<string, unknown>, progress = [] as any[], related = null as unknown}) {
		return b.run(`whatNextSuggestions(${JSON.stringify({current, favorites, details: {at: NOW, shows, films: {}, pending: {shows: [], films: []}}, progress, related, now: NOW})})`);
	}

	test("come in order: halfway through, the next of what's being watched, new episodes, and DR's own", () => {
		const found = suggest({
			favorites: [favorite(1, "matador_2"), favorite(1, "rejseholdet_3"), favorite(1, "hoest_4"), favorite(1, "en-film_5", "film")],
			shows: {
				matador_2: show("matador_2", "Matador", {episode_ids: ["21", "22", "23"]}),
				rejseholdet_3: show("rejseholdet_3", "Rejseholdet", {new_episodes: [episode("31", NOW - DAY, {url: "/rejseholdet_3/afsnit_31"})]}),
				hoest_4: show("hoest_4", "Høst"),
			},
			progress: [seen("21"), started("51", "/program/en-film_5", {show: null, title: "En film"})],
			related: {label: "Krimi", cards: [{title: "Bron", url: "/bron_6/", image: null}, {title: "Forbrydelsen", url: "/forbrydelsen_7/", image: null}]},
		});
		expect(found.map((f: any) => [f.label, f.title, f.url])).toEqual([
			["Se videre", "En film", "/program/en-film_5"],
			// Its next episode's address isn't known, so the series'
			["Næste afsnit", "Matador", "/matador_2/"],
			["Nyt afsnit", "Rejseholdet: S11 E31", "/rejseholdet_3/afsnit_31"],
			["Krimi", "Bron", "/bron_6/"],
		]);
	});

	test("leave out the series just watched, what's seen to the end, and what leaves within a day", () => {
		const found = suggest({
			current: "/badehotellet_1/afsnit_9",
			favorites: [favorite(1, "badehotellet_1"), favorite(1, "matador_2"), favorite(1, "rejseholdet_3")],
			shows: {
				badehotellet_1: show("badehotellet_1", "Badehotellet", {new_episodes: [episode("10", NOW - DAY)]}),
				matador_2: show("matador_2", "Matador", {episode_ids: ["21", "22"], expires: NOW + 12 * 60 * 60 * 1000}),
				rejseholdet_3: show("rejseholdet_3", "Rejseholdet", {episode_ids: ["31", "32"], new_episodes: [episode("32", NOW - DAY, {url: "/rejseholdet_3/afsnit_32"})]}),
			},
			progress: [started("8", "/badehotellet_1/afsnit_8"), seen("21"), seen("31"), seen("32"), seen("9")],
			related: {label: "Krimi", cards: [{title: "Seen", url: "/program/en-film_9", image: null}]},
		});
		// Badehotellet was just watched, Matador leaves within a day, Rejseholdet is all seen, and so is the film
		expect(found).toEqual([]);
	});

	test("have each series only once, at most 4", () => {
		const found = suggest({
			favorites: [favorite(1, "rejseholdet_3")],
			shows: {rejseholdet_3: show("rejseholdet_3", "Rejseholdet", {new_episodes: [episode("33", NOW - DAY, {url: "/rejseholdet_3/afsnit_33"}), episode("32", NOW - 2 * DAY, {url: "/rejseholdet_3/afsnit_32"})]})},
			related: {label: "Krimi", cards: ["a_11", "b_12", "c_13", "d_14", "rejseholdet_3"].map(id => ({title: id, url: `/${id}/`, image: null}))},
		});
		expect(found.map((f: any) => f.url)).toEqual(["/rejseholdet_3/afsnit_33", "/a_11/", "/b_12/", "/c_13/"]);
	});

	test("are none, with nothing to suggest", () => {
		expect(suggest({})).toEqual([]);
	});
});

describe("asking whether the viewer still watches", () => {
	const due = (streak: number, idle: number, together = false) => b.run(`stillWatchingDue(${JSON.stringify({streak, lastInteraction: NOW - idle, now: NOW, together})})`);

	test("is after 3 episodes in a row that started by themselves, and an hour and a half without the viewer doing anything", () => {
		expect(due(3, 90 * 60 * 1000)).toBe(true);
		expect(due(5, 3 * 60 * 60 * 1000)).toBe(true);
		expect(due(2, 3 * 60 * 60 * 1000)).toBe(false);
		expect(due(3, 89 * 60 * 1000)).toBe(false);
	});

	test("is never when watching together", () => {
		expect(due(9, 9 * 60 * 60 * 1000, true)).toBe(false);
	});

	test("counts episodes that started by themselves, which one the viewer chose starts over, and notes clicks, keys and touches", () => {
		b.run(`next.video = {dataset: {}}; setSessionNumber("autoStreak", 2)`);
		expect(b.run(`sessionNumber("autoStreak")`)).toBe(2);
		// Without a browser to play it in, the next one is only asked for
		b.run(`switchEpisode = () => {}; playNext("/x_1/y_2", false)`);
		expect(b.run(`sessionNumber("autoStreak")`)).toBe(0);
		b.run(`Date.now = () => ${NOW}; setSessionNumber("lastInteraction", ${NOW - 60 * 60 * 1000}); noteInteraction()`);
		expect(b.run(`sessionNumber("lastInteraction")`)).toBe(NOW);
	});
});
