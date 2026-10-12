import {describe, expect, test} from "vitest";
import {NotFound} from "../src/dr";
import * as dr from "../src/models";
import {buildSearchResult, search} from "../src/search";
import {buildShow, getLongDescription, getProgram, getShow, MAX_SEASONS, rssFeed, thumbnail} from "../src/show";
import {clock, copenhagen, danishDate, danishDatetime, duration, isNew, isoTime} from "../src/time";
import {ctx, dr as fakeDR, load} from "./helpers";

const SEASON_IDS = ["503606", "503607", "503611", "503612"];

function seasons(): Map<string, unknown> {
	return new Map(SEASON_IDS.map(id => {
		const blob = load(`items_${id}.json`);
		return [blob.path, blob];
	}));
}

describe("DR's data", () => {
	test("lengths", () => {
		expect(dr.parseLength("43M")).toBe(43);
		expect(dr.parseLength("1T 5M")).toBe(65);
		expect(dr.parseLength("1T 0M")).toBe(60);
		expect(dr.parseLength("2T 30M")).toBe(150);
		expect(dr.parseLength("1T")).toBe(60);
		expect(dr.parseLength("")).toBeUndefined();
		expect(dr.parseLength("lang")).toBeUndefined();
	});

	test.each([
		["SÆSON 1 EPISODE 10 | 1T 5M", 65],
		["1. DEC 2021 | 38M", 38],
		["Fiktionsserie", undefined],
		["SÆSON 1 | ", undefined],
		[null, undefined],
	])("an episode's length from %s", (details, minutes) => {
		expect(dr.lengthInMinutes({customFields: {ExtraDetails: details}})).toBe(minutes);
	});

	test("publication dates, from the best there is", () => {
		const fields = {ExtraDetails: "1. DEC 2021 | 38M", AvailableFrom: "2000-10-01T18:00:08.0000000Z"};
		expect(dr.pubdate({releaseYear: 1999, customFields: fields})).toBe(Date.UTC(2000, 9, 1, 18, 0, 8));
		// Midnight in Denmark
		expect(dr.pubdate({releaseYear: 1999, customFields: {ExtraDetails: "1. DEC 2021 | 38M"}})).toBe(Date.UTC(2021, 10, 30, 23));
		expect(dr.pubdate({releaseYear: 1999, customFields: {ExtraDetails: "SÆSON 1 EPISODE 1 | 59M"}})).toBe(Date.UTC(1998, 11, 31, 23));
		// What isn't a date is left out
		expect(dr.pubdate({releaseYear: 1999, customFields: {AvailableFrom: "i går"}})).toBe(Date.UTC(1998, 11, 31, 23));
		const before = Date.now();
		expect(dr.pubdate({releaseYear: 0})).toBeGreaterThanOrEqual(before);
	});

	test("an episode's title", () => {
		expect(dr.episodeTitle({contextualTitle: "1. episode", title: "Titel"})).toBe("1. episode");
		expect(dr.episodeTitle({contextualTitle: "", title: "Titel"})).toBe("Titel");
		expect(dr.episodeTitle({id: "42", path: "/episode/x_42"})).toBe("42");
	});

	test("DR's true and false, as text", () => {
		expect(dr.geoRestricted({customFields: {IsGeoRestricted: "True"}})).toBe(true);
		expect(dr.geoRestricted({customFields: {IsGeoRestricted: "False"}})).toBe(false);
		expect(dr.geoRestricted({})).toBe(false);
	});

	test("a missing field is named", () => {
		expect(() => dr.required({}, "title")).toThrow(/title/);
	});
});

describe("a show", () => {
	test("is built from its latest season, which carries the show, and all the seasons", () => {
		const show = buildShow(load("items_503612.json"), seasons());
		expect(show.title).toBe("Rejseholdet");
		expect(show.url).toBe("rejseholdet_503605");
		expect(show.description.startsWith("Dansk krimiserie")).toBe(true);
		expect(show.wallpaper?.startsWith("https://")).toBe(true);
		expect(show.geoRestricted).toBe(false);
		expect(show.nextEpisode).toBeUndefined();
		// Seasons titled like the show are named by their number instead, and the others don't repeat the show's name
		expect(show.seasons.map(s => s.title)).toEqual(["Sæson 1", "Sæson 2", "Sæson 3", "Sæson 4"]);
		expect(show.seasons.map(s => s.episodes.length)).toEqual([9, 7, 14, 2]);
		const first = show.seasons[0].episodes[0];
		expect(first).toMatchObject({title: "1. episode", url: "/episode/rejseholdet_503615", link: "rejseholdet_503615", videoId: "503615", minutes: 59});
		expect(first.pubdate).toBe(Date.UTC(2000, 9, 1, 18, 0, 8));
		expect(first.shortDescription.startsWith("Dansk krimiserie fra 2000")).toBe(true);
	});

	test("its next episode", () => {
		const blob = load("items_503612.json");
		blob.show.nextEpisode = {availableUTC: "1760000000"};
		expect(buildShow(blob, seasons()).nextEpisode).toBe(1760000000 * 1000);
	});

	test("seasons without a number are named by their year", () => {
		const blob = load("items_503612.json");
		delete blob.show.seasons.items[0].seasonNumber;
		expect(buildShow(blob, seasons()).seasons[0].title).toBe("2000");
	});

	test("an episode DR sends without what it needs is left out", () => {
		const all = seasons();
		const first = all.get("/saeson/rejseholdet_503606") as {episodes: {items: unknown[]}};
		first.episodes.items[0] = {title: "No path"};
		expect(buildShow(load("items_503612.json"), all).seasons[0].episodes).toHaveLength(8);
	});

	test("is got with all of its seasons, and kept", async () => {
		const show = await getShow(ctx(), "rejseholdet_503605");
		expect(show.seasons).toHaveLength(4);
		// The show's wallpaper is the latest season's, like on DR's own site
		expect(show.wallpaper).toBe(load("items_503612.json").images.wallpaper);
		expect(fakeDR.requested.sort()).toEqual(["/items/503605?expand=all", ...SEASON_IDS.map(id => `/items/${id}?expand=all`)].sort());
		fakeDR.requested = [];
		expect(await getShow(ctx(), "rejseholdet_503605")).toBe(show);
		expect(fakeDR.requested).toEqual([]);
	});

	test("only so many seasons, the newest", async () => {
		const blob = load("items_503605.json");
		const season = blob.seasons.items[0];
		blob.seasons.items = Array.from({length: MAX_SEASONS + 5}, (_, i) => ({...season, id: String(1000 + i), path: `/saeson/x_${1000 + i}`}));
		fakeDR.answer = path => (path == "/items/503605" ? blob : /^\/items\/1\d\d\d$/.test(path) ? load("items_503606.json") : undefined);
		await getShow(ctx(), "rejseholdet_503605");
		expect(fakeDR.requested).toHaveLength(MAX_SEASONS + 1);
		expect(fakeDR.requested.at(-1)).toBe(`/items/${1000 + MAX_SEASONS + 4}?expand=all`);
	});

	test("something else isn't one", async () => {
		await expect(getShow(ctx(), "lise-noergaard_-ikke-kun-en-pige_362031")).rejects.toThrow(NotFound);
		await expect(getShow(ctx(), "ikke-et-tal")).rejects.toThrow(NotFound);
	});

	test("its RSS feed", () => {
		const feed = rssFeed(buildShow(load("items_503612.json"), seasons()), "https://dktv.example");
		expect(feed).toContain("<channel><title>Rejseholdet</title>");
		expect(feed).toContain("<link>https://dktv.example/rejseholdet_503605/</link>");
		expect(feed.split("<item>")).toHaveLength(9 + 7 + 14 + 2 + 1);
		const first = feed.split("<item>")[1];
		expect(first).toContain("<title>1. episode</title>");
		expect(first).toContain("<link>https://dktv.example/rejseholdet_503605/rejseholdet_503615</link>");
		expect(first).toContain('<guid isPermaLink="false">DRTV:rejseholdet_503615</guid>');
		expect(first).toContain("<pubDate>Sun, 01 Oct 2000 18:00:08 +0000</pubDate>");
		expect(first).toContain("<description>Dansk krimiserie fra 2000");
		expect(first).toMatch(/<media:thumbnail url="[^"]*Width=640&#38;Height=360/);
	});
});

describe("descriptions and programmes", () => {
	const episode = (url: string) => ({title: "x", shortDescription: "Kort", url, link: url.split("/").at(-1)!, videoId: url.split("_").at(-1)!, pubdate: 0, geoRestricted: false});

	test("an episode's long description", async () => {
		expect(await getLongDescription(ctx(), episode("/episode/matador_-foedselsdagen_540744"))).toMatch(/^Dansk dramaserie fra 1979\./);
	});

	test("falls back to the short description", async () => {
		expect(await getLongDescription(ctx(), episode("/episode/findes-ikke_1"))).toBe("Kort");
		const blob = load("items_540744.json");
		delete blob.description;
		fakeDR.answer = () => blob;
		expect(await getLongDescription(ctx(), episode("/episode/matador_-foedselsdagen_540744"))).toBe("Kort");
	});

	test("a programme", async () => {
		const program = await getProgram(ctx(), "lise-noergaard_-ikke-kun-en-pige_362031");
		expect(program).toMatchObject({title: "Lise Nørgaard: Ikke kun en pige", minutes: 48, pubdate: Date.UTC(2023, 0, 7, 17), videoId: "362031"});
		expect(program.wallpaper?.startsWith("https://")).toBe(true);
	});
});

describe("search", () => {
	test("its results", () => {
		const result = buildSearchResult(load("search.json"));
		const matador = result.series.find(s => s.title == "Matador")!;
		expect(matador.url).toBe("/matador_540736/");
		expect(result.movies.length).toBeGreaterThan(0);
		expect(result.movies.every(m => m.url.startsWith("/program/"))).toBe(true);
		// Played on their show's page
		expect(result.episodes.find(e => e.title == "Matadorerne: Den første kæmpe")!.url).toBe("/557181/matadorerne_-den-foerste-kaempe_557186");
	});

	test("an episode without its show", () => {
		const blob = load("search.json");
		delete blob.playable.items.find((i: {id: string}) => i.id == "557186").showId;
		expect(buildSearchResult(blob).episodes.find(e => e.title == "Matadorerne: Den første kæmpe")!.url).toBe("/program/matadorerne_-den-foerste-kaempe_557186");
	});

	test("what's searched for is sent as it is", async () => {
		const queries: string[] = [];
		fakeDR.answer = (path, params) => {
			if (path == "/search") {
				queries.push(params.get("term")!);
			}
			return undefined;
		};
		for (const query of ["Matador & co", "Bonderøven #1", "a+b"]) {
			await search(ctx(), query);
		}
		expect(queries).toEqual(["Matador & co", "Bonderøven #1", "a+b"]);
	});
});

describe("pictures and time", () => {
	test("thumbnails", () => {
		const image = "https://example.com/ResizeImage/$value?Format='jpg'&Width=1920&Height=1080&ImageId='1'";
		expect(thumbnail(image)).toBe(image.replace("Width=1920&Height=1080", "Width=640&Height=360"));
		// Keeps the image's proportions
		expect(thumbnail(image.replace("Height=1080", "Height=2880"))).toContain("Width=640&Height=960");
		// Leaves alone what it doesn't know how to resize, or what's small already
		expect(thumbnail("https://example.com/image.jpg")).toBe("https://example.com/image.jpg");
		const small = image.replace("Width=1920&Height=1080", "Width=320&Height=180");
		expect(thumbnail(small)).toBe(small);
		expect(thumbnail(null)).toBeUndefined();
		// Photos as JPEG
		expect(thumbnail(image.replace("'jpg'", "'png'"))).toContain("Format='jpg'");
	});

	test("Danish dates and times", () => {
		expect(danishDate(Date.UTC(2000, 9, 1, 12))).toBe("1. okt. 2000");
		expect(danishDate(Date.UTC(2023, 4, 17, 12))).toBe("17. maj 2023");
		// As it was in Denmark, where it was already the next day
		expect(danishDate(Date.UTC(2000, 11, 31, 23, 30))).toBe("1. jan. 2001");
		// Summer time, from the last Sunday of March to that of October
		expect(danishDatetime(Date.UTC(2025, 2, 30, 0, 59))).toBe("30. mar. kl. 01.59");
		expect(danishDatetime(Date.UTC(2025, 2, 30, 1, 0))).toBe("30. mar. kl. 03.00");
		expect(danishDatetime(Date.UTC(2025, 9, 26, 0, 59))).toBe("26. okt. kl. 02.59");
		expect(danishDatetime(Date.UTC(2025, 9, 26, 1, 0))).toBe("26. okt. kl. 02.00");
		expect(copenhagen(Date.UTC(2026, 9, 12, 11, 40))).toMatchObject({hour: 13, minute: 40});
		expect(isoTime(Date.UTC(2026, 9, 12, 11, 40))).toBe("2026-10-12T11:40:00+00:00");
	});

	test("lengths", () => {
		expect(duration(59)).toBe("59 min.");
		expect(duration(60)).toBe("1 t.");
		expect(duration(75)).toBe("1 t. 15 min.");
	});

	test("what's new came out within two weeks", () => {
		clock.now = () => Date.UTC(2026, 9, 12);
		expect(isNew(Date.UTC(2026, 9, 1))).toBe(true);
		expect(isNew(Date.UTC(2026, 8, 20))).toBe(false);
		expect(isNew(Date.UTC(2026, 9, 13))).toBe(false);
		expect(isNew(undefined)).toBe(false);
	});
});
