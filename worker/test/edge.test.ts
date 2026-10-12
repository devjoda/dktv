// Keeping pages and DR's data in Cloudflare's cache, with a stand-in for it

import {beforeEach, describe, expect, test, vi} from "vitest";
import {forgetAll} from "../src/cache";
import {dr, get} from "./helpers";

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

	test("doesn't keep errors", async () => {
		expect((await get("/findes-ikke_1/")).status).toBe(404);
		dr.down = true;
		expect((await get("/rejseholdet_503605/")).status).toBe(503);
		expect(pages()).toEqual([]);
	});
});
