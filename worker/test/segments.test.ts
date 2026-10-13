// Marking where intros and credits are, and what the player is told about them

import {describe, expect, test} from "vitest";
import {consensus, plausible, segmentsOf} from "../src/segments";
import {between, env, get, post, request} from "./helpers";

const json = (r: {text: string}) => JSON.parse(r.text);
const send = (path: string, data: unknown) => request(path, {method: "POST", body: JSON.stringify(data), headers: {"Content-Type": "application/json"}});

async function account(): Promise<string> {
	return json(await post("/sync/")).code;
}

// Rejseholdet's first season, as on its episodes' pages
const SEASON = ["503615", "503640", "503632", "503619", "503639", "503610", "503609", "503618", "503638"].map(id => `/rejseholdet_503605/rejseholdet_${id}`);
const DURATION = 3500;

const credits = (code: string, video: string, fromEnd: number, source = "marked") =>
	send(`/spring/${video}`, {code, kind: "credits", start: DURATION - fromEnd, end: DURATION, duration: DURATION, source});
const intro = (code: string, video: string, start: number, end: number, source = "marked") =>
	send(`/spring/${video}`, {code, kind: "intro", start, end, duration: DURATION, source});

/** What the player is told on an episode's page */
async function told(path: string) {
	const attribute = between((await get(path)).text, 'data-segments="', '"');
	return JSON.parse(attribute.replaceAll("&quot;", '"'));
}

describe("marks", () => {
	test("only what could be an intro, or credits", () => {
		expect(plausible("intro", 30, 90, DURATION)).toBe(true);
		expect(plausible("intro", 30, 32, DURATION)).toBe(false);
		expect(plausible("intro", 1500, 1560, DURATION)).toBe(false);
		expect(plausible("credits", DURATION - 60, DURATION, DURATION)).toBe(true);
		// Credits run to the end
		expect(plausible("credits", DURATION - 60, DURATION - 30, DURATION)).toBe(false);
		expect(plausible("credits", 100, DURATION, DURATION)).toBe(false);
		expect(plausible("intro", Number.NaN, 90, DURATION)).toBe(false);
	});

	test("one account's mark isn't shown, two that agree are", async () => {
		const [anna, bo] = [await account(), await account()];
		expect((await credits(anna, "503640", 45)).status).toBe(201);
		expect(await told(SEASON[1])).toEqual({});
		await credits(bo, "503640", 46.5);
		expect(await told(SEASON[1])).toEqual({credits: {fromEnd: 45.8}});
	});

	test("a trusted account's mark is shown on its own", async () => {
		const mine = await account();
		env.TRUSTED_ACCOUNTS = mine.match(/.{4}/g)!.join("-").toLowerCase();
		await intro(mine, "503615", 62, 118);
		expect(await told(SEASON[0])).toEqual({intro: {start: 62, end: 118}});
	});

	test("when three episodes of a season agree, the others are suggested the same", async () => {
		const mine = await account();
		env.TRUSTED_ACCOUNTS = mine;
		for (const video of ["503615", "503640"]) {
			await credits(mine, video, 40);
		}
		expect((await told(SEASON[3])).credits).toBeUndefined();
		await credits(mine, "503632", 41);
		expect(await told(SEASON[3])).toEqual({credits: {fromEnd: 40.3, suggested: true}});
		// Not in other seasons
		expect(await told("/rejseholdet_503605/rejseholdet_503624")).toEqual({});
	});

	test("Forkert? from two accounts hides a mark", async () => {
		const [anna, bo, carl, dina] = [await account(), await account(), await account(), await account()];
		await credits(anna, "503640", 45);
		await credits(bo, "503640", 45);
		await send("/spring/503640/stem", {code: carl, kind: "credits", vote: -1});
		expect((await told(SEASON[1])).credits).toBeDefined();
		await send("/spring/503640/stem", {code: dina, kind: "credits", vote: -1});
		expect(await told(SEASON[1])).toEqual({});
	});

	test("only accounts that exist, and only so many a day", async () => {
		expect((await credits("ABCDEFGHJKMNPQRS", "503640", 45)).status).toBe(404);
		expect((await credits("not a code", "503640", 45)).status).toBe(404);
		const anna = await account();
		expect((await intro(anna, "503640", 30, 31)).status).toBe(400);
		expect((await send("/spring/503640", {code: anna, kind: "outro", start: 1, end: 2, duration: DURATION, source: "marked"})).status).toBe(400);
		await env.SYNC.prepare("INSERT INTO segments (video, kind, code, start, \"end\", duration, source, created) SELECT 'x' || value, 'intro', ?, 1, 60, 3500, 'marked', ? FROM json_each(?)")
			.bind(anna, Date.now() / 1000, JSON.stringify(Array.from({length: 300}, (_, i) => i))).run();
		expect((await credits(anna, "503640", 45)).status).toBe(429);
	});

	test("are deleted along with the account", async () => {
		const anna = await account();
		await credits(anna, "503640", 45);
		await send("/spring/503640/stem", {code: anna, kind: "credits", vote: 1});
		await request(`/sync/${anna}`, {method: "DELETE"});
		expect((await env.SYNC.prepare("SELECT count(*) AS n FROM segments").first<{n: number}>())!.n).toBe(0);
		expect((await env.SYNC.prepare("SELECT count(*) AS n FROM segment_votes").first<{n: number}>())!.n).toBe(0);
	});

	test("agreeing intros agree on both start and length", () => {
		const mark = (code: string, start: number, end: number) => ({video: "1", kind: "intro" as const, code, start, end, duration: DURATION});
		expect(consensus([mark("a", 60, 120), mark("b", 61, 121)], [], [], new Set())).toEqual([60.5, 60]);
		expect(consensus([mark("a", 60, 120), mark("b", 61, 140)], [], [], new Set())).toBeUndefined();
		// A season's intros at different times, after openings of different lengths, aren't suggested for the others
		const season = ["1", "2", "3", "4"];
		const marks = [["1", 60], ["2", 95], ["3", 130]].map(([video, start]) => ({video: video as string, kind: "intro" as const, code: "t", start: start as number, end: (start as number) + 45, duration: DURATION}));
		expect(segmentsOf("4", season, marks, [], new Set(["t"]))).toEqual({});
	});
});
