// Keeping pages and DR's data in Cloudflare's cache, with a stand-in for it

import {beforeEach, describe, expect, test, vi} from "vitest";
import {forgetAll} from "../src/cache";
import {dr, get as getLocal, request} from "./helpers";

// From a site's own address, since pages aren't kept when running locally
const get = (path: string) => getLocal("https://dktv.example" + path);

let kept: Map<string, Response>;

beforeEach(() => {
	kept = new Map();
	const cache = {
		async match(request: Request | string) {
			return kept.get(typeof request == "string" ? request : request.url)?.clone();
		},
		async put(request: Request | string, response: Response) {
			kept.set(typeof request == "string" ? request : request.url, response);
		},
	};
	vi.stubGlobal("caches", {default: cache});
});

const pages = () => [...kept.keys()].filter(key => !key.includes("/_kept/"));

describe("Cloudflare's cache", () => {
	test("keeps a page once it has all of it", async () => {
		// The first visits each get a couple of DR's rows, and their pages aren't kept
		let r = await get("/");
		expect(r.status).toBe(200);
		expect(r.headers.get("Cache-Control")).toBe("no-cache");
		expect(pages()).toEqual([]);
		for (let i = 0; i < 4 && r.headers.get("Cache-Control") == "no-cache"; i++) {
			r = await get("/");
		}
		expect(r.headers.get("Cache-Control")).toBe("public, max-age=60");
		expect(pages()).toHaveLength(1);
		expect(pages()[0]).toContain("_version=dev");

		// The next visit gets the page as it was kept, without asking DR
		dr.requested = [];
		const again = await get("/");
		expect(again.text).toBe(r.text);
		expect(dr.requested).toEqual([]);
	});

	test("keeps what's got from DR for other copies of the Worker", async () => {
		await get("/rejseholdet_503605/");
		expect([...kept.keys()].some(key => key.includes("/_kept/") && key.endsWith("show%3A503605"))).toBe(true);
		// A new copy, without anything in its memory, uses it
		forgetAll();
		dr.requested = [];
		const r = await get("/rejseholdet_503605/rejseholdet_503615");
		expect(r.status).toBe(200);
		expect(dr.requested.filter(p => p.includes("expand=all"))).toEqual([]);
	});

	test("keeps the favourites page once, whatever filter its address has", async () => {
		const plain = await get("/favoritter/");
		const filtered = await get("/favoritter/?vis=dokumentar");
		await get("/favoritter/?vis=serier");
		expect(filtered.text).toBe(plain.text);
		expect(pages()).toEqual(["https://dktv.example/favoritter/?_version=dev"]);
	});

	test("doesn't keep errors", async () => {
		expect((await get("/findes-ikke_1/")).status).toBe(404);
		dr.down = true;
		expect((await get("/rejseholdet_503605/")).status).toBe(503);
		expect(pages()).toEqual([]);
	});

	test("never keeps where Direkte sends a viewer", async () => {
		const r = await request("https://dktv.example/live/", {headers: {Cookie: "lastChannel=DR2"}});
		expect(r.location).toBe("/live/DR2");
		expect(r.headers.get("Cache-Control")).toBe("private, no-store");
		expect(pages()).toEqual([]);
		expect((await get("/live/")).location).toBe("/live/DR1");
		expect(pages()).toEqual([]);
	});

	test("keeps the schedule for the guide, like the pages", async () => {
		let r = await get("/live/plan.json");
		for (let i = 0; i < 4 && r.headers.get("Cache-Control") != "public, max-age=60"; i++) {
			r = await get("/live/plan.json");
		}
		expect(r.headers.get("Cache-Control")).toBe("public, max-age=60");
		expect(pages().some(key => key.includes("/live/plan.json"))).toBe(true);
		dr.requested = [];
		expect((await get("/live/plan.json")).text).toBe(r.text);
		expect(dr.requested).toEqual([]);
	});
});

describe("the catalogue in Cloudflare's cache", () => {
	test("isn't kept while it has only a little of DR's list, and is once it has most of it, with a 304 for what the browser has", async () => {
		const {env} = await import("./helpers");
		const r = await get("/katalog.json");
		expect(r.status).toBe(200);
		expect(r.headers.get("Cache-Control")).toBe("no-cache");
		expect(pages()).toEqual([]);
		// As many titles as most of DR's list
		const entry = (i: number) => JSON.stringify({id: String(i), t: `Titel ${i}`, u: `/titel_${i}/`, k: "serie", n: 0, f: {type: ["serie"]}});
		await env.SYNC.batch(Array.from({length: 1000}, (_, i) => env.SYNC.prepare(
			"INSERT INTO titles (id, letter, item, hash, first_seen, entry, stale, kind) VALUES (?, 'A', '{}', '', 0, ?, 0, 'serie')").bind(String(i), entry(i))));
		await env.SYNC.prepare("INSERT INTO catalogue (key, value) VALUES ('version', '7')").run();
		const whole = await get("/katalog.json");
		expect(JSON.parse(whole.text).titles).toHaveLength(1000);
		expect(whole.headers.get("Cache-Control")).toBe("public, max-age=60");
		expect(whole.headers.get("ETag")).toBe('"7"');
		expect(pages()).toHaveLength(1);
		const unchanged = await request("https://dktv.example/katalog.json", {headers: {"If-None-Match": '"7"'}});
		expect(unchanged.status).toBe(304);
	});
});
