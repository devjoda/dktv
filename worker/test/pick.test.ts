// "Vælg for mig": what it picks from, made of DR's categories' pages, and pick.js's questions about it,
// which are run here in a context of their own, with a browser's storage stood in for

import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createContext, runInContext} from "node:vm";
import {afterEach, describe, expect, test, vi} from "vitest";
import {cachedIfWhole, expireAll, forgetAll} from "../src/cache";
import {card, type Card, getPage, similarTo} from "../src/discover";
import * as dr from "../src/models";
import {kindOf, merge, type Pick, pickPool, picks} from "../src/pick";
import {getShow} from "../src/show";
import {ctx, dr as fakeDR, get, load} from "./helpers";

const STATIC = join(__dirname, "..", "..", "drtvrss", "static");
const SCRIPTS = ["progress.js", "favorites.js", "sync.js", "pick.js"];

/** The items of a page's fixture, of DR's rows */
function itemsOf(name: string): any[] {
	return load(name).entries.flatMap((e: any) => e.list?.items ?? []);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("what DR says a programme is like", () => {
	test("its categories and keywords, without DR's channels, people and how it can be watched", () => {
		const item = {
			categories: ["Fiktionsserie", "Krimi", "DR1", "acc_spoken_subtitles"],
			keywords: ["editorialptaxtop_serier", "editorialptaxsub_thriller/krimi", "mood_nervepirrende", "culturalorigin_ikke-dansk",
				"person_lise nørgaard", "thesaurus_bankvæsen", "agetargetgroup_familie", "editorialptaxsub_krimi"],
		};
		expect(dr.tags(item)).toEqual(["fiktionsserie", "krimi", "serier", "thriller/krimi", "nervepirrende", "ikke-dansk", "familie"]);
		expect(dr.tags({})).toEqual([]);
	});

	test("cards have it, with how long a film is, how many seasons a show has, and when it's from", () => {
		const show = itemsOf("page_kategorier_fiktionsserier.json").find(i => i.type == "show" && i.keywords?.some((k: string) => k.startsWith("mood_")));
		const c = card({...show, availableSeasonCount: 3, releaseYear: 2021}, {})!;
		expect(c.tags).toContain("fiktionsserie");
		expect(c.tags.some(t => ["nervepirrende", "autentisk/realistisk", "følelsesladet", "rå", "mørk/uhyggelig", "sjovt", "intellektuel/tankevækkende", "feel good/hyggelig", "eventyrlig/magisk"].includes(t))).toBe(true);
		expect([c.seasons, c.year, c.minutes]).toEqual([3, 2021, undefined]);
		const film = card({id: "1", type: "program", title: "Film", path: "/program/film_1", duration: 5430, categories: ["film"]}, {})!;
		expect(film.minutes).toBe(91);
	});
});

const base = (extra: Partial<Card>): Card => ({
	title: "", url: "/", description: "", tagline: "", category: "", detail: "", live: false, tags: [], ...extra,
});

describe("what's picked from", () => {
	test("series, films, documentaries and other programmes, but not news, sport, episodes or channels", () => {
		expect(kindOf(base({showId: "rejseholdet_503605", tags: ["fiktionsserie", "krimi"]}))).toBe("serie");
		expect(kindOf(base({showId: "bonderoeven_1", tags: ["dokumentar", "natur"]}))).toBe("dokumentar");
		expect(kindOf(base({filmId: "doc_2", tags: ["film", "dokumentar"]}))).toBe("dokumentar");
		expect(kindOf(base({filmId: "jagten_3", tags: ["film"]}))).toBe("film");
		expect(kindOf(base({showId: "bagedyst_4", tags: ["underholdning", "mad"]}))).toBe("program");
		expect(kindOf(base({showId: "tvavisen_5", tags: ["nyheder"]}))).toBeUndefined();
		expect(kindOf(base({showId: "fodbold_6", tags: ["sport"]}))).toBeUndefined();
		expect(kindOf(base({seriesId: "rejseholdet_503605", videoId: "7", tags: ["fiktionsserie"]}))).toBeUndefined();
		expect(kindOf(base({live: true}))).toBeUndefined();
	});

	test("what's on a row of what's new is new, and a programme on several pages is one, with what all of them say", () => {
		const page = {
			title: "Serier", featured: [],
			rows: [
				{title: "Netop tilføjet", cards: [base({title: "A", url: "/a_1/", showId: "1", tags: ["fiktionsserie"]})], more: "1", complete: true},
				{title: "Krimiserier", cards: [base({title: "B", url: "/b_2/", showId: "b_2", tags: ["fiktionsserie", "krimi"]})], more: "2", complete: true},
			],
		};
		const found = picks(page);
		expect(found.map(p => [p.title, p.fresh])).toEqual([["A", true], ["B", undefined]]);
		const other: Pick[] = [{title: "A", url: "/a_1/", showId: "a_1", kind: "serie", tags: ["fiktionsserie", "drama"]}];
		const merged = merge([found, other]);
		expect(merged).toHaveLength(2);
		// With the show's name in its address, and both pages' tags
		expect(merged[0]).toMatchObject({url: "/a_1/", showId: "a_1", fresh: true, tags: ["fiktionsserie", "drama"]});
	});

	test("/vaelg.json has DR's series from the categories' pages, each once, with what it's like, more with each visit", async () => {
		forgetAll();
		const r = await get("/vaelg.json");
		expect(r.status).toBe(200);
		expect(r.contentType).toContain("application/json");
		const first: Pick[] = JSON.parse(r.text);
		expect(first.length).toBeGreaterThan(10);
		// The visits after a minute or so add what the first left out
		const now = Date.now();
		let found = first;
		for (let i = 1; i <= 12; i++) {
			vi.spyOn(Date, "now").mockReturnValue(now + i * 2 * 60 * 1000);
			found = JSON.parse((await get("/vaelg.json")).text);
		}
		expect(found.length).toBeGreaterThan(first.length);
		expect(new Set(found.map(p => p.url)).size).toBe(found.length);
		expect(found.every(p => ["serie", "film", "dokumentar", "program"].includes(p.kind) && Array.isArray(p.tags))).toBe(true);
		expect(found.some(p => p.kind == "serie" && p.tags.includes("krimi") && p.image?.startsWith("https://"))).toBe(true);
		// From "Netop tilføjet"
		expect(found.some(p => p.fresh)).toBe(true);
	});

	test("a category's programmes that were made while the visit left some out are made again soon", async () => {
		forgetAll();
		const now = Date.now();
		vi.spyOn(Date, "now").mockReturnValue(now);
		let built = 0;
		const make = (whole: boolean) => async () => {
			built++;
			if (!whole) {
				c.incomplete = true;
			}
			return built;
		};
		let c = ctx();
		expect(await cachedIfWhole(c, "pick:test", 6 * 60 * 60, make(false))).toBe(1);
		expect(c.incomplete).toBe(true);
		// Two minutes later, it's made again, and whole this time, so it's kept
		vi.spyOn(Date, "now").mockReturnValue(now + 2 * 60 * 1000);
		c = ctx();
		expect(await cachedIfWhole(c, "pick:test", 6 * 60 * 60, make(true))).toBe(2);
		expect(c.incomplete).toBe(false);
		vi.spyOn(Date, "now").mockReturnValue(now + 60 * 60 * 1000);
		c = ctx();
		expect(await cachedIfWhole(c, "pick:test", 6 * 60 * 60, make(true))).toBe(2);
	});

	test("without DR, what was made before is used", async () => {
		const before = await pickPool(ctx());
		expect(before.length).toBeGreaterThan(20);
		expireAll();
		fakeDR.down = true;
		try {
			expect(await pickPool(ctx())).toEqual(before);
		} finally {
			fakeDR.down = false;
		}
	});
});

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

function browser() {
	const storage = new Storage();
	const listeners = {addEventListener() {}, removeEventListener() {}, dispatchEvent() {}};
	const sandbox: Record<string, unknown> = {
		console, Event, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams,
		localStorage: storage,
		sessionStorage: new Storage(),
		navigator: {userAgent: "Node"},
		document: {...listeners, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null},
		fetch: async () => ({ok: true, status: 200, json: async () => ({})}),
	};
	sandbox.window = {...listeners};
	const context = createContext(sandbox);
	for (const name of SCRIPTS) {
		runInContext(readFileSync(join(STATIC, name), "utf8"), context, {filename: name});
	}
	return {run: (code: string) => runInContext(code, context), storage};
}

/** Programmes like /vaelg.json's: n of each kind, with tags in turn */
function pool() {
	const items: Pick[] = [];
	const kinds = ["serie", "film", "dokumentar", "program"] as const;
	const tagged = [["krimi", "nervepirrende", "dansk"], ["humor/satire", "sjovt", "ikke-dansk"], ["drama", "følelsesladet", "dansk"], ["historie", "ikke-dansk"]];
	kinds.forEach((kind, k) => {
		for (let i = 0; i < 40; i++) {
			items.push({
				title: `${kind} ${i}`, url: `/${kind}_${i}/`, kind, tags: tagged[i % tagged.length],
				...(kind == "film" ? {minutes: 50 + i * 3, filmId: `${kind}_${i}`, videoId: `${k}${i}`} : {seasons: 1 + (i % 3), showId: `${kind}_${i}`}),
			});
		}
	});
	return items;
}

describe("the questions", () => {
	test("the first is always serie, film or dokumentar, and the answers are read from the address in order", () => {
		const b = browser();
		expect(b.run(`pickNext(${JSON.stringify(pool())}, []).id`)).toBe("type");
		expect(b.run(`pickAnswers("?type=serie&stemning=ligeglad&fra=dansk&findes=ikke&tid=nej")`)).toEqual([["type", "serie"], ["stemning", "ligeglad"], ["fra", "dansk"]]);
	});

	test("each answer leaves fewer, and Ligeglad leaves all of them", () => {
		const b = browser();
		const items = JSON.stringify(pool());
		expect(b.run(`pickLeft(${items}, [["type", "serie"]]).length`)).toBe(40);
		expect(b.run(`pickLeft(${items}, [["type", "serie"], ["stemning", "ligeglad"]]).length`)).toBe(40);
		expect(b.run(`pickLeft(${items}, [["type", "serie"], ["fra", "dansk"]]).length`)).toBe(20);
		expect(b.run(`pickLeft(${items}, [["type", "film"], ["tid", "kort"]]).every(i => i.minutes <= 60)`)).toBe(true);
	});

	test("an answer that would leave too few, or take nothing away, isn't given, and a question without two answers isn't asked", () => {
		const b = browser();
		const items = pool().filter(i => i.kind == "serie");
		// None for children, so nothing to split
		expect(b.run(`pickScore(pickQuestion("boern"), ${JSON.stringify(items)})`)).toBe(0);
		const choices = b.run(`pickChoices(pickQuestion("stemning"), ${JSON.stringify(items)}).map(c => [c.answer.id, c.count])`);
		expect(choices).toEqual([["spaending", 10], ["grin", 10], ["foelelser", 10]]);
		// All of them are Danish or not
		expect(b.run(`pickScore(pickQuestion("fra"), ${JSON.stringify(items)})`)).toBeCloseTo(1);
	});

	test("the next question is one of those that split what's left, each asked once, and none when few are left", () => {
		const b = browser();
		const items = JSON.stringify(pool().filter(i => i.kind == "serie"));
		const asked = new Set<string>();
		for (let i = 0; i < 30; i++) {
			asked.add(b.run(`pickNext(${items}, [["type", "serie"]], () => ${i / 30}).id`));
		}
		expect([...asked].every(id => ["stemning", "emne", "fra", "tid"].includes(id))).toBe(true);
		expect(asked.size).toBeGreaterThan(1);
		expect(b.run(`pickNext(${items}, [["type", "serie"], ["stemning", "ligeglad"], ["emne", "ligeglad"], ["fra", "ligeglad"], ["tid", "ligeglad"]])`)).toBeNull();
		expect(b.run(`pickNext(${items}.slice(0, 6), [["type", "serie"]])`)).toBeNull();
	});
});

describe("Overrask mig", () => {
	test("seldom picks what the viewer has seen or begun, and is likelier to pick what's like their favourites", () => {
		const b = browser();
		const items = pool().filter(i => i.kind == "film").slice(0, 8);
		for (const item of items.slice(0, 7)) {
			b.storage.setItem(`progress_${item.videoId}`, JSON.stringify({time: 0, watched: true, updated: 1}));
		}
		const picked = new Map<string, number>();
		for (let i = 0; i < 100; i++) {
			const url = b.run(`pickOne(${JSON.stringify(items)}, undefined, null, () => ${i / 100}).url`);
			picked.set(url, (picked.get(url) ?? 0) + 1);
		}
		expect(picked.get(items[7].url)).toBeGreaterThan(60);

		const liked = browser();
		const two = [items[0], {...items[1], tags: ["romantik/kærlighed"]}, {...items[2], tags: ["romantik/kærlighed"]}];
		liked.storage.setItem("favorites", JSON.stringify([{id: two[1].filmId, kind: "film", title: "", image: null, added: 1}]));
		const weights = liked.run(`(() => { const l = pickLiked(${JSON.stringify(two)}); return ${JSON.stringify(two)}.map(i => pickWeight(i, l)); })()`);
		// The favourite itself is less likely, and one like it more
		expect(weights[2]).toBeGreaterThan(weights[0]);
		expect(weights[1]).toBeLessThan(weights[0]);
	});

	test("again gives another one, when there is one, and a series starts where its play button would", () => {
		const b = browser();
		const items = JSON.stringify(pool().slice(0, 2));
		expect(b.run(`pickOne(${items}, ${items}, ${items}[0], () => 0).url`)).toBe("/serie_1/");
		expect(b.run(`pickTarget({url: "/serie_1/"})`)).toBe("/serie_1/#afspil");
		expect(b.run(`pickTarget({url: "/program/film_1"})`)).toBe("/program/film_1");
	});
});

describe("the page", () => {
	test("Vælg for mig has its place in the menu, and is linked from the categories and the front page", async () => {
		const r = await get("/vaelg/");
		expect(r.status).toBe(200);
		expect(r.text).toContain("<h1>Vælg for mig</h1>");
		expect(r.text).toContain('<a class="pick-link" href="/vaelg/" aria-label="Vælg for mig" title="Vælg for mig" aria-current="page">');
		expect(r.text).toContain('class="pick wrap js-pick"');
		expect(r.text).toContain('<dialog class="pick-result js-pick-result"');
		expect(r.text).toMatch(/<script src="\/static\/pick\.js\?v=\w+"><\/script>/);
		expect((await get("/vaelg")).location).toBe("/vaelg/");
		expect((await get("/kategorier/")).text).toContain('<a class="pick-promo wrap" href="/vaelg/">');
		expect((await get("/")).text).toContain('<p class="pick-line wrap"><a href="/vaelg/">');
		const category = (await get("/kategorier/fiktionsserier/")).text;
		expect(category).toContain('class="button button-secondary js-pick-surprise" hidden>');
		expect(category).toContain('<dialog class="pick-result js-pick-result"');
	});
});

describe("Hvad nu?", () => {
	test("suggests what's most like the series first, by what DR says it's like, like its mood", async () => {
		const show = await getShow(ctx(), "rejseholdet_503605");
		expect(show.tags).toContain("krimi");
		const similar = await similarTo(ctx(), show.categories ?? [], "503605", show.tags);
		const page = await getPage(ctx(), "/kategorier/fiktionsserier", 12);
		const tagsOf = new Map([...page!.featured, ...page!.rows.flatMap(row => row.cards)].map(c => [c.url, c.tags]));
		const broad = ["fiktionsserie", "serier", "dansk", "ikke-dansk", "gensyn", "dr gensyn"];
		const likeness = similar.cards.map(c => (tagsOf.get(c.url) ?? []).filter(t => show.tags!.includes(t) && !broad.includes(t)).length);
		expect(likeness[0]).toBeGreaterThan(0);
		expect(likeness).toEqual([...likeness].sort((a, b) => b - a));
		// Which isn't just the page's order: a mood that few on the page have comes first too
		const unsorted = await similarTo(ctx(), show.categories ?? [], "503605");
		expect(tagsOf.get(unsorted.cards[0].url)).not.toContain("følelsesladet");
		const moved = await similarTo(ctx(), show.categories ?? [], "503605", ["følelsesladet"]);
		expect(tagsOf.get(moved.cards[0].url)).toContain("følelsesladet");
	});
});
