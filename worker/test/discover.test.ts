import {describe, expect, test} from "vitest";
import {cached, expireAll, forgetAll} from "../src/cache";
import {card, cards, getCategories, getPage} from "../src/discover";
import {Budget, DRUnavailable, OverBudget} from "../src/dr";
import {getChannels, getSchedules, percentDone, type Programme, whatsOn} from "../src/live";
import {ctx, dr} from "./helpers";

const CHANNELS = {"20875": "DR1"};

const item = (fields: Record<string, unknown>) => card({id: "1", title: "Titel", ...fields}, CHANNELS);

describe("DR's rows", () => {
	test("where DR's items go here", () => {
		expect(item({type: "show", path: "/serie/matador_540736"})).toMatchObject({url: "/matador_540736/", showId: "matador_540736"});
		// A season goes to its show
		expect(item({type: "season", path: "/saeson/hoest_623828", showId: "623827"})!.url).toBe("/623827/");
		expect(item({type: "episode", path: "/episode/matador_-foedselsdagen_540744", showId: "540736"})).toMatchObject({url: "/540736/matador_-foedselsdagen_540744", videoId: "540744"});
		expect(item({type: "episode", path: "/episode/noget_5"})!.url).toBe("/program/noget_5");
		expect(item({type: "program", path: "/program/lise-noergaard_-ikke-kun-en-pige_362031"})).toMatchObject({url: "/program/lise-noergaard_-ikke-kun-en-pige_362031", filmId: "lise-noergaard_-ikke-kun-en-pige_362031"});
		expect(item({type: "link", path: "/kanal/dr1_20875"})).toMatchObject({url: "/live/DR1", live: true});
		// Nothing here for these
		expect(item({type: "link", path: "/kategorier/film"})).toBeUndefined();
		expect(item({type: "link", path: "/kanal/ukendt_1"})).toBeUndefined();
		expect(item({type: "season", path: "/saeson/x_1"})).toBeUndefined();
	});

	test("taglines are split", () => {
		const c = item({type: "show", path: "/serie/hoest_1", tagline: "Episode 1:7 | Stor ny dansk dramaserie",
			customFields: {DisplayCategory: "Fiktionsserie,DR1", ShortVideoUrl: "https://example.com/clip.m3u8"}})!;
		expect([c.detail, c.tagline, c.category]).toEqual(["Episode 1:7", "Stor ny dansk dramaserie", "Fiktionsserie"]);
		expect(c.preview).toBe("https://example.com/clip.m3u8");
	});

	test("a row has each programme once, and leaves out what it can't read", () => {
		const show = {id: "1", type: "show", title: "Mors dreng", path: "/serie/mors-dreng_1"};
		const season = {id: "2", type: "season", title: "Mors dreng", path: "/saeson/mors-dreng_2", showId: "mors-dreng_1"};
		// A show and its season go to the same page
		expect(cards([show, season, show], CHANNELS)).toHaveLength(1);
		const other = {id: "3", type: "show", title: "Høst", path: "/serie/hoest_3"};
		expect(cards([show, {type: "show"}, other, show], CHANNELS).map(c => c.title)).toEqual(["Mors dreng", "Høst"]);
	});

	test("DR's front page, a couple of rows at a time while nothing's kept", async () => {
		const first = ctx();
		const start = (await getPage(first, "/", 8))!;
		expect(first.incomplete).toBe(true);
		expect(start.featured.length).toBeGreaterThanOrEqual(3);
		expect(start.rows.length).toBeLessThanOrEqual(2);
		let visits = 1;
		let visit = ctx();
		let page = (await getPage(visit, "/", 8))!;
		while (visit.incomplete) {
			visits++;
			visit = ctx();
			page = (await getPage(visit, "/", 8))!;
		}
		// Two rows at a time, of eight at most
		expect(visits).toBeGreaterThan(1);
		expect(visits).toBeLessThanOrEqual(4);
		expect(page.featured.every(c => c.url.startsWith("/"))).toBe(true);
		expect(page.rows.length).toBeGreaterThanOrEqual(start.rows.length);
		const titles = page.rows.map(row => row.title);
		expect(titles).not.toContain("Se live tv");
		expect(titles).not.toContain("Kategorier");
		expect(page.rows.every(row => row.cards.length >= 3)).toBe(true);
		// Kept
		dr.requested = [];
		const again = ctx();
		expect(await getPage(again, "/", 8)).toEqual(page);
		expect(again.incomplete).toBe(false);
		expect(dr.requested).toEqual([]);
	});

	test("when DR doesn't answer, the last it gave is used", async () => {
		const page = await getPage(ctx(), "/", 8);
		expireAll();
		dr.down = true;
		expect(await getPage(ctx(), "/", 8)).toEqual(page);
		expect(await getPage(ctx(), "/kategorier/film", 8)).toBeUndefined();
	});

	test("DR's categories", async () => {
		const categories = await getCategories(ctx());
		expect(categories.slice(0, 3).map(c => c.title)).toEqual(["Serier", "Film", "Dokumentar"]);
		expect(categories.every(c => c.url.startsWith("/kategorier/") && c.url.endsWith("/"))).toBe(true);
		expect(categories.map(c => c.url)).not.toContain("/kategorier/a-aa/");
	});
});

describe("keeping what's got", () => {
	test("for a while", async () => {
		let built = 0;
		const build = async () => ++built;
		expect(await cached(ctx(), "x", 60, build)).toBe(1);
		expect(await cached(ctx(), "x", 60, build)).toBe(1);
		expireAll();
		expect(await cached(ctx(), "x", 60, build)).toBe(2);
	});

	test("a visit only gets a couple of what ran out again, and uses what was kept of the rest", async () => {
		const visit = ctx();
		for (const key of ["a", "b", "c", "d"]) {
			await cached(visit, key, 60, async () => `${key} 1`);
		}
		expireAll();
		const next = ctx();
		const got = [];
		for (const key of ["a", "b", "c", "d"]) {
			got.push(await cached(next, key, 60, async () => `${key} 2`));
		}
		expect(got).toEqual(["a 2", "b 2", "c 1", "d 1"]);
		// And the next visit the rest
		const after = ctx();
		expect(await cached(after, "c", 60, async () => "c 2")).toBe("c 2");
	});

	test("with nothing kept, it's got whatever", async () => {
		const visit = ctx();
		visit.refreshes = 0;
		expect(await cached(visit, "new", 60, async () => "got")).toBe("got");
	});

	test("when DR doesn't answer, or a visit can't ask more, what was kept is used", async () => {
		await cached(ctx(), "x", 60, async () => "old");
		expireAll();
		expect(await cached(ctx(), "x", 60, async () => { throw new DRUnavailable("down"); })).toBe("old");
		expireAll();
		expect(await cached(ctx(), "x", 60, async () => { throw new OverBudget("no more"); })).toBe("old");
		// But not when something's wrong with what DR sent, or nothing was kept
		expireAll();
		await expect(cached(ctx(), "x", 60, async () => { throw new TypeError("odd"); })).rejects.toThrow(TypeError);
		forgetAll();
		await expect(cached(ctx(), "x", 60, async () => { throw new DRUnavailable("down"); })).rejects.toThrow(DRUnavailable);
	});

	test("a visit's requests are counted", () => {
		const budget = new Budget(2);
		budget.spend();
		budget.spend();
		expect(() => budget.spend()).toThrow(OverBudget);
	});
});

describe("live", () => {
	const AT = Date.UTC(2026, 9, 12, 11, 50);
	const MINUTE = 60 * 1000;
	const programme = (start: number, end: number, title = "Program"): Programme =>
		({title, start: AT + start * MINUTE, end: AT + end * MINUTE, description: ""});

	test("what's on", () => {
		const earlier = programme(-60, -10, "Før");
		const current = programme(-10, 20, "Nu");
		const later = programme(20, 50, "Derefter");
		expect(whatsOn([earlier, current, later], AT)).toEqual([current, [later]]);
		// Between programmes, nothing's on
		expect(whatsOn([earlier, later], AT)).toEqual([undefined, [later]]);
		expect(whatsOn([], AT)).toEqual([undefined, []]);
	});

	test("how far a programme has got", () => {
		const p = programme(-10, 30);
		expect(percentDone(p, AT)).toBe(25);
		expect(percentDone(p, AT - 60 * MINUTE)).toBe(0);
		expect(percentDone(p, AT + 60 * MINUTE)).toBe(100);
	});

	test("the channels' schedules", async () => {
		const channels = await getChannels(ctx());
		const schedules = await getSchedules(ctx(), channels);
		const dr1 = schedules["20875"];
		expect(dr1[0].title).toBe("Hammerslag 2022 - Lejlighed i storbyen");
		expect(dr1[0].start).toBe(Date.UTC(2026, 9, 12, 11, 40));
		expect(dr1[0].end).toBeGreaterThan(dr1[0].start);
		expect(dr1[0].image?.startsWith("https://")).toBe(true);
		expect(dr.requested.some(r => r.startsWith("/schedules?"))).toBe(true);
		// Kept
		dr.requested = [];
		expect(await getSchedules(ctx(), channels)).toEqual(schedules);
		expect(dr.requested).toEqual([]);
	});

	test("schedules are only extra", async () => {
		const channels = await getChannels(ctx());
		dr.down = true;
		expect(await getSchedules(ctx(), channels)).toEqual({});
	});
});
