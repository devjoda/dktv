// "Vælg for mig": pick.js's questions about the catalogue, which are run here in a context of their own, with a
// browser's storage stood in for, and the page; and what DR says a programme is like, which it's asked about

import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createContext, runInContext} from "node:vm";
import {afterEach, describe, expect, test, vi} from "vitest";
import type {Entry} from "../src/entries";
import {card, getPage, similarTo} from "../src/discover";
import * as dr from "../src/models";
import {getShow} from "../src/show";
import {ctx, get, load} from "./helpers";

const STATIC = join(__dirname, "..", "..", "drtvrss", "static");
const SCRIPTS = ["progress.js", "favorites.js", "sync.js", "catalogue.js", "pick.js"];

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

/** Titles like the catalogue's: 40 of each kind, with filters in turn */
function pool(): Entry[] {
	const items: Entry[] = [];
	const kinds = ["serie", "film", "dokumentar", "program"] as const;
	const filters: Record<string, string[]>[] = [
		{genre: ["krimi"], stemning: ["spaending"], fra: ["dansk"], emne: ["politi"]},
		{genre: ["humor"], stemning: ["sjovt"], fra: ["udland"], emne: ["kongelige"]},
		{genre: ["drama"], stemning: ["foelelser"], fra: ["dansk"], emne: ["jul"]},
		{genre: ["historie"], fra: ["udland"], emne: ["2. verdenskrig"]},
	];
	kinds.forEach((kind, k) => {
		for (let i = 0; i < 40; i++) {
			const film = kind == "film";
			items.push({
				id: `${k}${i}`, t: `${kind} ${i}`, u: film ? `/program/${kind}_${k}${i}` : `/${kind}_${k}${i}/`, k: kind,
				m: film ? 50 + i * 3 : 20 + (i % 3) * 20, s: film ? undefined : 1 + (i % 3),
				f: {type: [kind], ...filters[i % filters.length], tid: [film ? (50 + i * 3 <= 60 ? "time" : 50 + i * 3 <= 90 ? "aften" : "lang") : "kort"]},
			});
		}
	});
	return items;
}

describe("the questions", () => {
	test("the first is always serie, film or dokumentar, and the answers are read from the address in order, each question once", () => {
		const b = browser();
		expect(b.run(`pickNext(${JSON.stringify(pool())}, []).id`)).toBe("type");
		expect(b.run(`pickAnswers("?type=serie&stemning=ligeglad&fra=dansk&findes=ikke&fra=udland&emne=2.%20verdenskrig")`))
			.toEqual([["type", "serie"], ["stemning", "ligeglad"], ["fra", "dansk"], ["emne", "2. verdenskrig"]]);
		// Only the kinds there are, for the first
		expect(b.run(`pickAnswers("?type=tegnefilm")`)).toEqual([]);
	});

	test("each answer leaves fewer, and Ligeglad leaves all of them", () => {
		const b = browser();
		const items = JSON.stringify(pool());
		expect(b.run(`pickLeft(${items}, [["type", "serie"]]).length`)).toBe(40);
		expect(b.run(`pickLeft(${items}, [["type", "serie"], ["stemning", "ligeglad"]]).length`)).toBe(40);
		expect(b.run(`pickLeft(${items}, [["type", "serie"], ["fra", "dansk"]]).length`)).toBe(20);
		expect(b.run(`pickLeft(${items}, [["type", "film"], ["tid", "time"]]).every(i => i.m <= 60)`)).toBe(true);
	});

	test("a question's answers are its facet's values that split what's left, and one without two isn't asked", () => {
		const b = browser();
		const items = JSON.stringify(pool().filter(i => i.k == "serie"));
		// Every series is short, so nothing to split
		expect(b.run(`pickScore(pickQuestion("tid"), ${items})`)).toBe(0);
		const choices = b.run(`pickChoices(pickQuestion("stemning"), ${items}).map(c => [c.answer.id, c.answer.label, c.count])`);
		expect(choices).toEqual([["spaending", "Nervepirrende", 10], ["sjovt", "Noget at grine af", 10], ["foelelser", "Store følelser", 10]]);
		// All of them are Danish or not
		expect(b.run(`pickScore(pickQuestion("fra"), ${items})`)).toBeCloseTo(1);
		// A series' length is its episodes'
		const films = pool().filter(i => i.k == "serie").map((item, i) => ({...item, f: {...item.f, tid: [i % 2 ? "kort" : "time"]}}));
		expect(b.run(`pickChoices(pickQuestion("tid"), ${JSON.stringify(films)})[0].answer.hint`)).toBe("Pr. afsnit");
	});

	test("an open facet's answers are the values there are most of, a few of them at random, so they vary", () => {
		const b = browser();
		const topics = ["a", "b", "c", "d", "e", "f", "g", "h"];
		const items = JSON.stringify(Array.from({length: 80}, (_, i) => ({id: String(i), t: String(i), u: `/x_${i}/`, k: "dokumentar",
			f: {type: ["dokumentar"], emne: [topics[i % topics.length]]}})));
		const seen = new Set<string>();
		for (let i = 0; i < 20; i++) {
			const answers: string[] = b.run(`pickChoices(pickQuestion("emne"), ${items}, null, () => ${i / 20}).map(c => c.answer.id)`);
			expect(answers).toHaveLength(4);
			answers.forEach(answer => seen.add(answer));
		}
		expect(seen.size).toBeGreaterThan(4);
		expect(b.run(`pickChoices(pickQuestion("emne"), ${items})[0].answer.label`)).toMatch(/^[A-H]$/);
	});

	test("the next question is one of those that split what's left, each asked once, of a group only one, and none when few are left", () => {
		const b = browser();
		const items = JSON.stringify(pool().filter(i => i.k == "film"));
		const asked = new Set<string>();
		for (let i = 0; i < 30; i++) {
			asked.add(b.run(`pickNext(${items}, [["type", "film"]], () => ${i / 30}).id`));
		}
		expect([...asked].every(id => ["stemning", "genre", "emne", "fra", "tid"].includes(id))).toBe(true);
		expect(asked.size).toBeGreaterThan(1);
		for (let i = 0; i < 10; i++) {
			expect(b.run(`pickNext(${items}, [["type", "film"], ["fra", "ligeglad"]], () => ${i / 10})?.id`)).not.toBe("land");
		}
		expect(b.run(`pickNext(${items}, [["type", "film"], ["stemning", "ligeglad"], ["genre", "ligeglad"], ["emne", "ligeglad"], ["fra", "ligeglad"]])`)).toBeNull();
		expect(b.run(`pickNext(${items}.slice(0, 6), [["type", "film"]])`)).toBeNull();
	});

	test("what was asked last time is asked less", () => {
		const b = browser();
		const items = JSON.stringify(pool().filter(i => i.k == "film"));
		const count = (memory: string[]) => {
			let found = 0;
			for (let i = 0; i < 100; i++) {
				found += b.run(`pickNext(${items}, [["type", "film"]], () => ${i / 100}, null, {asked: ${JSON.stringify(memory)}}).id`) == "stemning" ? 1 : 0;
			}
			return found;
		};
		expect(count(["stemning"])).toBeLessThan(count([]));
	});
});

describe("Overrask mig", () => {
	test("seldom picks what the viewer has seen, begun, or was picked for them lately, and is likelier to pick what's like their favourites", () => {
		const b = browser();
		const items = pool().filter(i => i.k == "film").slice(0, 8);
		for (const item of items.slice(0, 7)) {
			b.storage.setItem(`progress_${item.id}`, JSON.stringify({time: 0, watched: true, updated: 1}));
		}
		const picked = new Map<string, number>();
		for (let i = 0; i < 100; i++) {
			const url = b.run(`pickOne(${JSON.stringify(items)}, undefined, null, () => ${i / 100}).u`);
			picked.set(url, (picked.get(url) ?? 0) + 1);
		}
		expect(picked.get(items[7].u)).toBeGreaterThan(60);

		const liked = browser();
		const two = [items[0], {...items[1], f: {genre: ["kaerlighed"]}}, {...items[2], f: {genre: ["kaerlighed"]}}];
		liked.storage.setItem("favorites", JSON.stringify([{id: two[1].u.split("/").at(-1), kind: "film", title: "", image: null, added: 1}]));
		const at = "new Date('2026-10-14T15:00:00')";
		const weights = liked.run(`(() => { const l = pickLiked(${JSON.stringify(two)}); return ${JSON.stringify(two)}.map(i => pickWeight(i, l, ${at})); })()`);
		// The favourite itself is less likely, and one like it more
		expect(weights[2]).toBeGreaterThan(weights[0]);
		expect(weights[1]).toBeLessThan(weights[0]);
		const lately = liked.run(`pickWeight(${JSON.stringify(items[0])}, new Set(), ${at}, [${JSON.stringify(items[0].u)}])`);
		expect(lately).toBeLessThan(liked.run(`pickWeight(${JSON.stringify(items[0])}, new Set(), ${at}, [])`));
	});

	test("the time of day and of year count: something short late, a film at the weekend, and Christmas in December", () => {
		const b = browser();
		const weight = (item: object, at: string) => b.run(`pickWeight(${JSON.stringify(item)}, new Set(), new Date(${JSON.stringify(at)}))`);
		const short = {id: "1", u: "/a_1/", k: "serie", m: 25, f: {}};
		expect(weight(short, "2026-10-14T23:00:00")).toBeGreaterThan(weight(short, "2026-10-14T15:00:00"));
		const film = {id: "2", u: "/program/b_2", k: "film", m: 100, f: {}};
		expect(weight(film, "2026-10-16T20:00:00")).toBeGreaterThan(weight(film, "2026-10-14T20:00:00"));
		const christmas = {id: "3", u: "/c_3/", k: "program", f: {emne: ["jul"]}};
		expect(weight(christmas, "2026-12-10T15:00:00")).toBeGreaterThan(weight(christmas, "2026-10-14T15:00:00"));
	});

	test("again gives another one, when there is one, and a series starts where its play button would", () => {
		const b = browser();
		const items = JSON.stringify(pool().slice(0, 2));
		expect(b.run(`pickOne(${items}, ${items}, ${items}[0], () => 0).u`)).toBe("/serie_01/");
		expect(b.run(`pickTarget({u: "/serie_1/"})`)).toBe("/serie_1/#afspil");
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
