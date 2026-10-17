// The catalogue: DR's list from A to Å, gone through by its cron a page at a time, with each title's own item looked up,
// and what the browser gets of it, from the fixtures of three of its letters, L, M and R

import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, test} from "vitest";
import * as catalogue from "../src/catalogue";
import * as entries from "../src/entries";
import worker from "../src/index";
import {clock} from "../src/time";
import {ctx, dr as fakeDR, env, get, load, request} from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
// A morning after the sweep's hour, the day the fixtures were got
const MORNING = Date.parse("2026-10-17T06:00:00Z");

/** The catalogue's cron, run as many times as it takes to go through DR's list and look up every title */
async function runCatalogue(times = 150) {
	for (let i = 0; i < times; i++) {
		await catalogue.run(ctx());
	}
}

async function rows(sql: string, ...params: unknown[]): Promise<any[]> {
	return (await env.SYNC.prepare(sql).bind(...params).all()).results;
}

async function katalog(): Promise<{version: number; facets: any[]; titles: entries.Entry[]}> {
	const r = await get("/katalog.json");
	expect(r.status).toBe(200);
	return JSON.parse(r.text);
}

const titleOf = (found: {titles: entries.Entry[]}, title: string) => found.titles.find(e => e.t == title)!;

/** The first minute after the morning whose run does a kind of work first, as each kind of work is first in turn */
function minuteOf(kind: string): number {
	for (let minute = MORNING; ; minute += 60_000) {
		if (["sweep", "look up", "entries"][Math.floor(minute / 60_000) % 3] == kind) {
			return minute;
		}
	}
}

describe("what's kept of DR's titles", () => {
	test("an item of DR's list, with what it's like, when it leaves, and who it's for", () => {
		const item = entries.keptItem(load("lists_348_m.json").items.find((i: any) => i.title == "Matador"))!;
		expect(item).toMatchObject({id: "540736", type: "show", title: "Matador", path: "/serie/matador_540736", seasons: 1, universes: ["drtv"]});
		expect(item.categories).toContain("fiktionsserie");
		expect(item.keywords).toContain("editorialptaxsub_historisk drama");
		expect(entries.keptItem({type: "episode", id: 1, title: "A", path: "/a"})).toBeUndefined();
		expect(entries.keptItem({type: "show", title: "Uden id", path: "/a"})).toBeUndefined();
		const kids = entries.keptItem(load("lists_348_m.json").items.find((i: any) => i.title == "Max Pinlig"))!;
		expect(kids.universes).toContain("ramasjang");
	});

	test("the names after Medvirkende and Instruktion in a film's description, without m.fl. and what follows on the line", () => {
		const text = "Dansk spillefilm fra 2023.\nMarie tager til Velling.\nMedvirkende: Sofie Torp, Thomas Hwan, Anders Agger og Lotte Andersen m.fl.\nInstruktør: Hella Joof. Udløber: 20. okt 2026";
		expect(entries.namesAfter(text, ["Medvirkende"])).toEqual(["Sofie Torp", "Thomas Hwan", "Anders Agger", "Lotte Andersen"]);
		expect(entries.namesAfter(text, ["Instruktion", "Instruktør"])).toEqual(["Hella Joof"]);
		expect(entries.namesAfter("Ingen medvirkende her.", ["Medvirkende"])).toEqual([]);
		const film = entries.programmeDetails(load("items_619917.json"));
		expect(film.cast).toContain("Karen-Lise Mynster");
		expect(film.directors).toEqual(["Jacob Møller"]);
		expect(film.expires).toBeGreaterThan(Date.parse("2026-10-17"));
	});

	test("a series' years, seasons, episodes, how long they are and where it's from, from its item and newest season", () => {
		const details = entries.seriesDetails(load("items_540736.json"), load("items_540737.json"));
		expect(details).toMatchObject({years: [1978, 1978], seasons: 1, episodes: 24, country: "DANMARK"});
		expect(details.minutes).toBeGreaterThan(40);
		expect(entries.seriesDetails({}, undefined)).toEqual({});
	});

	test("names written as names, and DR's own odd ones as they're known", () => {
		expect(entries.properName("margrethe ii, dronning, danmark")).toBe("Margrethe II, Dronning, Danmark");
		expect(entries.properName("lars von trier")).toBe("Lars von Trier");
		expect(entries.properName("anne og anders")).toBe("Anne og Anders");
		expect(entries.properName("mgp")).toBe("MGP");
	});
});

describe("what the browser gets of a title", () => {
	const item = (extra: Partial<entries.Item>): entries.Item => ({
		id: "1", type: "show", title: "A", path: "/serie/a_1", categories: [], keywords: [], universes: ["drtv"], access: [], ...extra,
	});

	test("its kind and filters, from what DR says it is, and where it is here", () => {
		const {entry, kind, kids} = entries.entryOf(item({
			categories: ["fiktionsserie", "krimi", "dr1", "acc_spoken_subtitles"],
			keywords: ["editorialptaxtop_serier", "editorialptaxsub_thriller/krimi", "mood_nervepirrende", "culturalorigin_ikke-dansk", "thesaurus_politi", "thesaurus_danmark", "franchise_test1"],
			seasons: 3, rating: "MRAM-15",
		}), {years: [2009, 2014], episodes: 30, minutes: 58, country: "SVERIGE"}, ["Nordiske krimiserier"], 0);
		expect(kind).toBe("serie");
		expect(kids).toBe(false);
		expect(entry).toMatchObject({id: "1", t: "A", u: "/a_1/", k: "serie", y: 2009, m: 58, s: 3, e: 30, n: 0});
		expect(entry.f).toEqual({
			type: ["serie"], genre: ["krimi"], stemning: ["spaending"], fra: ["udland"], tilg: ["oplaest"], land: ["norden"], alder: ["15"],
			// Not "danmark", which says too little, nor DR's tests
			emne: ["politi"], aarti: ["2000"], tid: ["time"], omfang: ["flere"], udvalgt: ["Nordiske krimiserier"],
		});
	});

	test("a film's length and when it came, its people, and a country of its own", () => {
		const {entry, kind} = entries.entryOf(item({
			type: "program", path: "/program/film_2", id: "2", categories: ["film"], duration: 5430, year: 1983, availableFrom: 1000,
			keywords: ["person_dirch passer"],
		}), {cast: ["Ghita Nørby"], directors: ["Gabriel Axel"], country: "JAPAN", expires: 5000}, undefined, 0);
		expect(kind).toBe("film");
		expect(entry).toMatchObject({u: "/program/film_2", m: 91, y: 1983, n: 1000, x: 5000});
		expect(entry.f).toMatchObject({person: ["Dirch Passer", "Ghita Nørby", "Gabriel Axel"], land: ["verden"], aarti: ["1980"], tid: ["lang"]});
	});

	test("news and sport aren't shown, and children's programmes are told apart", () => {
		expect(entries.entryOf(item({categories: ["nyheder"]}), undefined, undefined, 0).kind).toBeUndefined();
		expect(entries.entryOf(item({keywords: ["editorialptaxtop_sport"]}), undefined, undefined, 0).kind).toBeUndefined();
		expect(entries.entryOf(item({universes: ["drtv", "ramasjang"]}), undefined, undefined, 0).kids).toBe(true);
		expect(entries.entryOf(item({categories: ["dokumentar"]}), undefined, undefined, 0).kind).toBe("dokumentar");
		expect(entries.entryOf(item({}), undefined, undefined, 0).kind).toBe("program");
	});
});

// What the fixtures' titles' entries are, which the Python app's tests check its own against, so both make them alike.
// UPDATE_ENTRIES=1 npm test writes them again, after the filters change.
const ENTRIES = join(__dirname, "..", "..", "tests", "fixtures", "catalogue_entries.json");

/** The fixtures' titles' entries, from their lists' items, and their own items, as the cron looks them up */
function fixtureEntries(): entries.Entry[] {
	const items: entries.Item[] = ["l", "m", "r"].flatMap(l => load(`lists_348_${l}.json`).items.map(entries.keptItem));
	const details: Record<string, entries.Details> = {
		"362031": entries.programmeDetails(load("items_362031.json")),
		"619917": entries.programmeDetails(load("items_619917.json")),
		"540736": entries.seriesDetails(load("items_540736.json"), load("items_540737.json")),
		"617585": entries.seriesDetails(load("items_617585.json"), load("items_617586.json")),
		"503605": entries.seriesDetails(load("items_503605.json"), load("items_503612.json")),
	};
	return items.map(item => entries.entryOf(item, details[item.id], item.id == "540736" ? ["Store danske serier"] : undefined, item.id == "540736" ? 0 : 1000).entry);
}

describe("the entries, as the Python app makes them too", () => {
	test("are the same as the fixture says", () => {
		const made = fixtureEntries();
		if (process.env.UPDATE_ENTRIES || !existsSync(ENTRIES)) {
			writeFileSync(ENTRIES, JSON.stringify(made, null, 1) + "\n");
		}
		expect(made).toEqual(load("catalogue_entries.json"));
	});
});

describe("the catalogue's cron", () => {
	test("goes through DR's list a page a run, looks up each title, and the browser gets what's shown", async () => {
		clock.now = () => MORNING;
		await catalogue.run(ctx());
		// The page with the letters first
		expect(fakeDR.requested[0]).toBe("/page?path=%2Fkategorier%2Fa-aa&list_page_size=1&max_list_prefetch=0");
		await runCatalogue();
		expect(fakeDR.requested).toContain("/lists/348?page_size=50&page=1&param=TitleGroupKey%3Am");
		const kept = await rows("SELECT id, letter, first_seen, kind, kids, missing_since FROM titles ORDER BY id");
		expect(kept.map(r => r.id).sort()).toEqual(["225290", "296793", "362031", "503605", "540736", "584100", "595127", "617585", "619917"]);
		// All there from the start
		expect(kept.every(r => r.first_seen == 0)).toBe(true);
		// Children's programmes and news aren't looked up
		expect(fakeDR.requested).not.toContain("/items/296793");
		expect(fakeDR.requested).not.toContain("/items/584100");
		expect(fakeDR.requested).toContain("/items/540736?expand=all");
		expect(fakeDR.requested).toContain("/items/540737?expand=all");

		const found = await katalog();
		expect(found.titles.map(e => e.t).sort()).toEqual(["Lise Nørgaard: Ikke kun en pige", "Madame Ida", "Maria Wern", "Matador", "Rejseholdet"]);
		expect(found.facets.find(f => f.id == "genre").values.find((v: any) => v.id == "krimi").label).toBe("Krimi");
		expect(found.version).toBeGreaterThan(0);
		const matador = titleOf(found, "Matador");
		expect(matador).toMatchObject({u: "/matador_540736/", k: "serie", y: 1978, e: 24});
		expect(matador.f.land).toEqual(["danmark"]);
		expect(titleOf(found, "Madame Ida").f.person).toContain("Karen-Lise Mynster");
		expect(titleOf(found, "Madame Ida").x).toBeGreaterThan(MORNING);
		// Red Rock West, whose item DR doesn't have, is gone
		expect(kept.find(r => r.id == "595127").missing_since).toBe(MORNING);
		// And DR's own rows say what its editors chose
		expect(fakeDR.requested).toContain("/lists/376779?page_size=50");
		const status = JSON.parse((await get("/status.json")).text).catalogue;
		expect(status).toMatchObject({titles: 5, sweep: null, lastSweep: {started: MORNING}});
	});

	test("a day later, writes only what changed: a new title is new, and one that's gone is looked up, then left out", async () => {
		clock.now = () => MORNING;
		await runCatalogue();
		const before = await rows("SELECT id, entry FROM titles ORDER BY id");
		// The next morning, Rejseholdet isn't on the list, and Matador has another picture, and a new film came
		const m = load("lists_348_m.json");
		const newFilm = {...m.items.find((i: any) => i.title == "Madame Ida"), id: "700001", title: "Ny film", path: "/program/ny-film_700001"};
		fakeDR.answer = (path, params) => {
			if (path == "/lists/348" && params.get("param") == "TitleGroupKey:m") {
				return {...m, items: [...m.items.map((i: any) => i.title == "Matador" ? {...i, images: {wallpaper: "https://example.com/ny.jpg"}} : i), newFilm]};
			}
			if (path == "/lists/348" && params.get("param") == "TitleGroupKey:r") {
				return {...load("lists_348_r.json"), items: load("lists_348_r.json").items.filter((i: any) => i.title != "Rejseholdet")};
			}
			if (path == "/items/700001") {
				return load("items_619917.json");
			}
			return undefined;
		};
		clock.now = () => MORNING + DAY;
		fakeDR.requested = [];
		await runCatalogue();
		const after = await rows("SELECT id, entry, first_seen, missing_since FROM titles ORDER BY id");
		// Unchanged, and so not made again
		expect(after.find(r => r.id == "362031").entry).toBe(before.find(r => r.id == "362031").entry);
		expect(after.find(r => r.id == "700001").first_seen).toBe(MORNING + DAY);
		expect(JSON.parse(after.find(r => r.id == "540736").entry).i).toContain("example.com/ny.jpg");
		// Rejseholdet was looked up, and DR still has it, so it was only moved
		expect(fakeDR.requested).toContain("/items/503605?expand=all");
		expect(after.find(r => r.id == "503605").missing_since).toBeNull();
		const found = await katalog();
		expect(titleOf(found, "Ny film").n).toBe(MORNING + DAY);
		expect(found.titles.some(e => e.t == "Rejseholdet")).toBe(true);
	});

	test("doesn't take a letter to be gone, when DR's list of it has far fewer than before", async () => {
		clock.now = () => MORNING;
		await runCatalogue();
		fakeDR.answer = (path, params) => path == "/lists/348" && params.get("param") == "TitleGroupKey:m" ? {...load("lists_348_m.json"), items: []} : undefined;
		clock.now = () => MORNING + DAY;
		await runCatalogue(8);
		expect((await rows("SELECT id FROM titles WHERE letter = 'M' AND missing_since IS NOT NULL"))).toEqual([]);
	});

	test("what leaves DR is left out as it does, and the catalogue's entries are made again after an update", async () => {
		clock.now = () => MORNING;
		await runCatalogue();
		const film = titleOf(await katalog(), "Madame Ida");
		clock.now = () => film.x! + 1000;
		expect((await katalog()).titles.some(e => e.t == "Madame Ida")).toBe(false);
		clock.now = () => MORNING;
		// As if an older version had made Matador's, which this one makes again
		await env.SYNC.batch([
			env.SYNC.prepare("UPDATE catalogue SET value = '\"old\"' WHERE key = 'entries'"),
			env.SYNC.prepare("UPDATE titles SET entry = '{\"id\":\"540736\",\"t\":\"Gammel\",\"f\":{}}' WHERE id = '540736'"),
		]);
		await catalogue.run(ctx());
		expect(titleOf(await katalog(), "Matador").f.type).toEqual(["serie"]);
		expect((await rows("SELECT count(*) AS n FROM titles WHERE stale > 0"))[0].n).toBe(0);
	});

	test("after an update, makes the entries of the titles that have none first, and then the others again", async () => {
		clock.now = () => MORNING;
		await runCatalogue();
		// Many more than a run makes, as if an older version had made them, and a title of DR's list's that has none yet,
		// after all of them in the table
		await env.SYNC.batch([
			env.SYNC.prepare("UPDATE catalogue SET value = '\"old\"' WHERE key = 'entries'"),
			env.SYNC.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 30)
				INSERT INTO titles (id, letter, item, hash, first_seen, details_due, entry, stale)
				SELECT 'kopi-' || i, letter, item, '', 0, 9e15, entry, 0 FROM titles, n WHERE id = '540736'`),
			env.SYNC.prepare("UPDATE titles SET entry = NULL, stale = 1 WHERE id = 'kopi-30'"),
		]);
		clock.now = () => minuteOf("entries");
		await catalogue.run(ctx());
		expect(await rows("SELECT stale, entry IS NOT NULL AS made FROM titles WHERE id = 'kopi-30'")).toEqual([{stale: 0, made: 1}]);
		expect((await rows("SELECT count(*) AS n FROM titles WHERE stale = 2"))[0].n).toBeGreaterThan(10);
	});

	test("when DR asks to be asked less, or turns it away, takes nothing to be gone, and asks DR nothing for a while", async () => {
		clock.now = () => MORNING;
		await runCatalogue();
		await env.SYNC.prepare("UPDATE titles SET details_due = 0 WHERE id IN ('362031', '619917', '540736')").run();
		fakeDR.answer = path => path.startsWith("/items/") ? new Response("{}", {status: 429}) : undefined;
		fakeDR.requested = [];
		await catalogue.run(ctx());
		// The first, and then not the rest
		expect(fakeDR.requested.filter(r => r.startsWith("/items/"))).toHaveLength(1);
		expect(await rows("SELECT id FROM titles WHERE missing_since IS NOT NULL AND id != '595127'")).toEqual([]);
		expect((await katalog()).titles).toHaveLength(5);
		// Nothing for half an hour
		fakeDR.requested = [];
		clock.now = () => MORNING + 20 * 60_000;
		await catalogue.run(ctx());
		expect(fakeDR.requested).toEqual([]);
		expect(JSON.parse((await get("/status.json")).text).catalogue.pausedUntil).toBe(MORNING + 30 * 60_000);
		// Then again, and with DR answering, as before
		fakeDR.answer = undefined;
		clock.now = () => MORNING + 31 * 60_000;
		await catalogue.run(ctx());
		expect(fakeDR.requested.some(r => r.startsWith("/items/"))).toBe(true);
		// A page of DR's turning the site away isn't a page that isn't there
		fakeDR.answer = () => new Response("{}", {status: 403});
		expect((await get("/rejseholdet_503605/")).status).toBe(503);
	});

	test("goes on another day after DR fails too often, trying again each half hour, and keeps what it had", async () => {
		fakeDR.down = true;
		// Asking DR once each time, after its pause
		for (let i = 0; i < 25; i++) {
			clock.now = () => MORNING + i * 31 * 60_000;
			fakeDR.requested = [];
			await catalogue.run(ctx());
			expect(fakeDR.requested.length).toBeLessThanOrEqual(1);
		}
		fakeDR.down = false;
		const last = JSON.parse((await rows("SELECT value FROM catalogue WHERE key = 'last'"))[0].value);
		expect(last.error).toBeTruthy();
		expect(catalogue.sweepDue(last, last.finished + 60_000)).toBe(false);
		expect(catalogue.sweepDue(last, last.finished + DAY)).toBe(true);
	});

	test("runs on its own schedules, of the even minutes and the odd, apart from the notifications'", async () => {
		clock.now = () => MORNING;
		const waiting: Promise<unknown>[] = [];
		const executionCtx = {waitUntil: (p: Promise<unknown>) => waiting.push(p), passThroughOnException() {}, props: {}} as unknown as ExecutionContext;
		await worker.scheduled({cron: "* * * * *", scheduledTime: MORNING, noRetry() {}} as ScheduledController, env as any, executionCtx);
		expect(fakeDR.requested).toEqual([]);
		for (const cron of catalogue.CRONS) {
			fakeDR.requested = [];
			await worker.scheduled({cron, scheduledTime: MORNING, noRetry() {}} as ScheduledController, env as any, executionCtx);
			expect(fakeDR.requested.length).toBeGreaterThan(0);
		}
	});

	test("is on the schedules wrangler.jsonc gives Cloudflare", () => {
		const crons = ["* * * * *", ...catalogue.CRONS].map(cron => `"${cron}"`).join(", ");
		expect(readFileSync(join(__dirname, "..", "wrangler.jsonc"), "utf8")).toContain(`"crons": [${crons}]`);
	});
});

describe("the pages", () => {
	test("the front page has rows of its own among DR's, from the catalogue, and gets the rest of DR's later", async () => {
		clock.now = () => MORNING;
		await runCatalogue();
		await catalogue.buildRows(ctx(), MORNING);
		const own = await catalogue.getOwnRows(ctx());
		// Too few titles in the fixtures for most rows
		expect(own.every(row => row.entries.length >= 4)).toBe(true);
		await env.SYNC.prepare("UPDATE catalogue SET value = ? WHERE key = 'rows'").bind(JSON.stringify({built: MORNING, rows: [
			{id: "stemning", title: "Store følelser", more: "/alle/?stemning=foelelser", entries: (await katalog()).titles.slice(0, 5)},
		]})).run();
		const front = (await get("/")).text;
		expect(front).toContain('<section class="shelf" data-own-row="stemning" aria-labelledby="own-stemning">');
		expect(front).toContain('href="/alle/?stemning=foelelser"');
		expect(front).toContain('href="/matador_540736/"');
	});

	test("Alle titler is a page of its own, linked from the categories, and each category leads to its titles", async () => {
		const all = await get("/alle/?genre=krimi");
		expect(all.status).toBe(200);
		expect(all.text).toContain('class="explore wrap js-explore"');
		expect(all.text).toMatch(/<script src="\/static\/explore\.js\?v=\w+"><\/script>/);
		expect((await get("/kategorier/")).text).toContain('<a class="pick-promo wrap" href="/alle/">');
		expect((await get("/kategorier/fiktionsserier/")).text).toContain('<a class="button button-secondary" href="/alle/?type=serie">');
		expect((await get("/alle")).location).toBe("/alle/");
	});

	test("what DR doesn't have any more says so, with something else of its kind, and the cron hears of it", async () => {
		clock.now = () => MORNING;
		await runCatalogue();
		await env.SYNC.prepare("UPDATE titles SET details_due = ? WHERE id = '595127'").bind(MORNING + DAY).run();
		const gone = await get("/program/red-rock-west_595127");
		expect(gone.status).toBe(404);
		expect(gone.text).toContain("<h1>Kan ikke længere ses</h1>");
		expect(gone.text).toContain('class="shelf js-gone-suggestions" data-kind="program"');
		expect((await rows("SELECT details_due FROM titles WHERE id = '595127'"))[0].details_due).toBe(-1);
		const episode = await get("/rejseholdet_503605/rejseholdet_1");
		expect(episode.status).toBe(404);
		expect(episode.text).toContain('href="/rejseholdet_503605/">Gå til Rejseholdet</a>');
	});

	test("a film kept from before it left DR says so, and doesn't start", async () => {
		const page = await get("/program/lise-noergaard_-ikke-kun-en-pige_362031");
		expect(page.text).toContain("playVideo(");
		clock.now = () => Date.parse("2029-01-01");
		const later = await get("/program/lise-noergaard_-ikke-kun-en-pige_362031");
		expect(later.text).toContain("Kan ikke længere ses");
		expect(later.text).not.toContain("playVideo(");
	});

	test("the catalogue says what it's like when the database doesn't answer", async () => {
		env.SYNC = {prepare() { throw new Error("No database"); }, batch() { throw new Error("No database"); }} as unknown as D1Database;
		const r = await request("/katalog.json");
		expect(r.status).toBe(503);
	});
});

describe("a run of the catalogue's cron", () => {
	test("does one kind of work only, a sweep's step, a few look-ups or some entries, each first in turn", async () => {
		const ran: string[] = [];
		const log = console.log as unknown as {mock: {calls: unknown[][]}};
		// A minute apart, as the cron runs, so turns change
		for (let i = 0; i < 60; i++) {
			clock.now = () => MORNING + i * 60_000;
			const before = log.mock.calls.length;
			fakeDR.requested = [];
			await catalogue.run(ctx());
			const said = log.mock.calls.slice(before).map(call => call.join(" ")).filter(line => line.startsWith("The catalogue's run:"));
			expect(said.length).toBeLessThanOrEqual(1);
			ran.push(said[0]?.slice("The catalogue's run: ".length) ?? "nothing");
			// A look-up asks DR about at most 4, and a sweep's step about one page, or at most 2 of DR's rows
			expect(fakeDR.requested.length).toBeLessThanOrEqual(said[0]?.endsWith("look up") ? 4 : 2);
		}
		// Until the sweep is done, and all of it looked up and made, and then the front page's rows are made
		expect(ran).toEqual(expect.arrayContaining(["sweep", "look up", "entries", "rows"]));
		// Titles are looked up, and entries made, while the sweep goes on, not only after it
		expect(new Set(ran.slice(0, 9))).toEqual(new Set(["sweep", "look up", "entries"]));
	});
});
