// What the bell says, "Nyt til dig": its lines and its number, worked out by favorites.js and news.js in the browser,
// and run here in a context of their own, with a browser's storage and fetch stood in for

import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createContext, runInContext} from "node:vm";
import {beforeEach, describe, expect, test} from "vitest";

const STATIC = join(__dirname, "..", "..", "drtvrss", "static");
const SCRIPTS = ["progress.js", "favorites.js", "sync.js", "account.js", "news.js"];
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
		console, Event, structuredClone, setTimeout, clearTimeout,
		localStorage: storage,
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

/** What the bell has to say, at now: its lines, and how many are new since it was opened */
function news(favorites: unknown[], details: unknown, now = NOW) {
	b.storage.setItem("favorites", JSON.stringify(favorites));
	const lines = b.run(`newsLines(loadFavorites(), ${JSON.stringify(details)}, ${now})`);
	const leaving = b.run(`leavingNews(loadFavorites(), ${JSON.stringify(details)}, ${now})`);
	const {seen, since} = b.run(`newsTimes(${now})`);
	return {lines, leaving, count: b.run(`newsCount(${JSON.stringify(lines)}, ${JSON.stringify(leaving)}, ${seen}, ${since})`)};
}

const details = (shows: Record<string, unknown>, films: Record<string, unknown> = {}) =>
	({at: NOW, shows, films, pending: {shows: [], films: []}});

describe("the lines", () => {
	test("a whole season at once is one line", () => {
		const season = Array.from({length: 8}, (_, i) => episode(String(8 - i), NOW - DAY - i * 1000));
		const {lines} = news([favorite(0)], details({badehotellet_1: series(season)}));
		expect(lines).toHaveLength(1);
		expect(lines[0].title).toBe("Badehotellet: 8 nye afsnit");
		// To the first of them, as none are seen
		expect(lines[0].url).toBe("/badehotellet_1/afsnit_1");
		expect(lines[0].seen).toBe(false);
	});

	test("one episode says which, and each day has a line of its own, the newest first", () => {
		const {lines} = news([favorite(0)], details({badehotellet_1: series([episode("3", NOW - DAY), episode("2", NOW - 3 * DAY)])}));
		expect(lines.map((l: any) => l.title)).toEqual(["Badehotellet: S11 A3", "Badehotellet: S11 A2"]);
		expect(lines[0].image).toBe("https://example.com/3.jpg");
		expect(b.run(`daysAgo(${NOW - DAY}, ${NOW})`)).toBe("i går");
		expect(b.run(`daysAgo(${NOW}, ${NOW})`)).toBe("i dag");
		expect(b.run(`daysAgo(${NOW - 3 * DAY}, ${NOW})`)).toBe("for 3 dage siden");
	});

	test("only of the last two weeks", () => {
		const {lines} = news([favorite(0)], details({badehotellet_1: series([episode("3", NOW - 15 * DAY)])}));
		expect(lines).toEqual([]);
	});

	test("lead to the first episode not seen, and say Set when all are", () => {
		const season = [episode("3", NOW - DAY + 2), episode("2", NOW - DAY + 1), episode("1", NOW - DAY)];
		b.storage.setItem("progress_1", JSON.stringify({time: 0, watched: true, updated: 1}));
		let {lines} = news([favorite(0)], details({badehotellet_1: series(season)}));
		expect(lines[0].url).toBe("/badehotellet_1/afsnit_2");
		expect(lines[0].seen).toBe(false);
		b.storage.setItem("progress_2", JSON.stringify({time: 0, watched: true, updated: 1}));
		b.storage.setItem("progress_3", JSON.stringify({time: 0, watched: true, updated: 1}));
		({lines} = news([favorite(0)], details({badehotellet_1: series(season)})));
		// Still there, as seen, leading to the first of them
		expect(lines).toHaveLength(1);
		expect(lines[0].seen).toBe(true);
		expect(lines[0].url).toBe("/badehotellet_1/afsnit_1");
	});

	test("favourites leaving within a week say when, as the rest of the site does", () => {
		const {leaving} = news([favorite(0), favorite(0, "en-film_2", "film")], details(
			{badehotellet_1: series([], {expires: NOW + 3 * DAY})},
			{"en-film_2": {title: "En film", url: "/program/en-film_2", image: null, minutes: 90, expires: NOW + 20 * DAY}},
		));
		expect(leaving.map((l: any) => [l.title, l.label])).toEqual([["Badehotellet", "Udløber om 3 dage"]]);
	});
});

describe("the number", () => {
	test("is 0 the first time, whatever there is", () => {
		const season = Array.from({length: 12}, (_, i) => episode(String(i + 1), NOW - (i + 1) * DAY));
		expect(news([favorite(NOW - 100 * DAY)], details({badehotellet_1: series(season)})).count).toBe(0);
		// The bell's first use is the starting point, on this device
		expect(b.storage.getItem("newsSince")).toBe(String(NOW));
		expect(b.storage.getItem("newsSeen")).toBe(String(NOW));
	});

	test("counts lines new since the bell was opened, not episodes, and only once it's opened again", () => {
		b.storage.setItem("newsSince", String(NOW - 10 * DAY));
		b.storage.setItem("newsSeen", String(NOW - 2 * DAY));
		const season = Array.from({length: 8}, (_, i) => episode(String(8 - i), NOW - DAY - i));
		const other = series([episode("1", NOW - 3 * DAY)], {title: "Matador"});
		const found = news([favorite(NOW - 30 * DAY), favorite(NOW - 30 * DAY, "matador_2")], details({badehotellet_1: series(season), matador_2: other}));
		// The season, and not Matador's older one
		expect(found.count).toBe(1);
		// Opening the bell
		b.run(`Date.now = () => ${NOW}`);
		b.run("markNewsSeen()");
		expect(b.storage.getItem("newsSeen")).toBe(String(NOW));
		expect(news([favorite(NOW - 30 * DAY), favorite(NOW - 30 * DAY, "matador_2")], details({badehotellet_1: series(season), matador_2: other})).count).toBe(0);
	});

	test("says at most 9+", () => {
		b.storage.setItem("newsSince", String(NOW - 20 * DAY));
		b.storage.setItem("newsSeen", String(NOW - 13 * DAY));
		const season = Array.from({length: 10}, (_, i) => episode(String(i + 1), NOW - (i + 1) * DAY));
		expect(news([favorite(NOW - 30 * DAY)], details({badehotellet_1: series(season)})).count).toBe(10);
		// As updateBell shows it
		const badge = {hidden: true, textContent: ""};
		const bell = {querySelector: () => badge, label: "", setAttribute(_: string, value: string) { this.label = value; }};
		b.run("document").querySelectorAll = () => [bell];
		b.storage.setItem("favoriteDetails", JSON.stringify(details({badehotellet_1: series(season)})));
		b.run(`Date.now = () => ${NOW}`);
		b.run("updateBell()");
		expect(badge.textContent).toBe("9+");
		expect(badge.hidden).toBe(false);
		expect(bell.label).toBe("Nyt til dig, mere end 9 nye");
	});

	test("a new favourite's episodes from before it was one don't count, but those after do", () => {
		b.storage.setItem("newsSince", String(NOW - 10 * DAY));
		b.storage.setItem("newsSeen", String(NOW - DAY));
		// Heard of just now, since the series was only just made a favourite
		const old = episode("2", NOW - 3 * DAY, {known: NOW});
		expect(news([favorite(NOW - 2 * DAY)], details({badehotellet_1: series([old])})).count).toBe(0);
		const after = episode("3", NOW - 12 * 60 * 60 * 1000, {known: NOW});
		expect(news([favorite(NOW - 2 * DAY)], details({badehotellet_1: series([after, old])})).count).toBe(1);
	});

	test("an episode heard of after the bell was opened counts, though DR dates it from before", () => {
		b.storage.setItem("newsSince", String(NOW - 10 * DAY));
		b.storage.setItem("newsSeen", String(NOW - 60 * 60 * 1000));
		const late = episode("3", NOW - 2 * 60 * 60 * 1000, {known: NOW});
		expect(news([favorite(NOW - 30 * DAY)], details({badehotellet_1: series([late])})).count).toBe(1);
		const heard = episode("3", NOW - 2 * 60 * 60 * 1000, {known: NOW - 90 * 60 * 1000});
		expect(news([favorite(NOW - 30 * DAY)], details({badehotellet_1: series([heard])})).count).toBe(0);
	});

	test("what's seen already isn't news", () => {
		b.storage.setItem("newsSince", String(NOW - 10 * DAY));
		b.storage.setItem("newsSeen", String(NOW - 2 * DAY));
		b.storage.setItem("progress_3", JSON.stringify({time: 0, watched: true, updated: 1}));
		expect(news([favorite(NOW - 30 * DAY)], details({badehotellet_1: series([episode("3", NOW - DAY)])})).count).toBe(0);
	});

	test("a favourite leaving soon counts once, when it comes within the week", () => {
		b.storage.setItem("newsSince", String(NOW - 10 * DAY));
		b.storage.setItem("newsSeen", String(NOW - 2 * DAY));
		const leaving = details({badehotellet_1: series([], {expires: NOW + 6 * DAY})});
		expect(news([favorite(NOW - 30 * DAY)], leaving).count).toBe(1);
		b.storage.setItem("newsSeen", String(NOW));
		expect(news([favorite(NOW - 30 * DAY)], leaving).count).toBe(0);
		// A day later, still leaving, and not again
		expect(news([favorite(NOW - 30 * DAY)], leaving, NOW + DAY).count).toBe(0);
		// One that came within the week before the bell was opened doesn't either
		b.storage.setItem("newsSeen", String(NOW - DAY / 2));
		expect(news([favorite(NOW - 30 * DAY)], details({badehotellet_1: series([], {expires: NOW + 3 * DAY})})).count).toBe(0);
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
});
