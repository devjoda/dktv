// The test video and the local test server in test/browser, which the deployed site never has

import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";
import {describe, expect, test} from "vitest";
import {get} from "./helpers";

const ROOT = join(__dirname, "..");

/** A Wrangler config, without its comments */
function config(path: string) {
	return JSON.parse(readFileSync(join(ROOT, path), "utf8").replace(/^\s*\/\/.*$/gm, ""));
}

function files(dir: string): string[] {
	return readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
}

describe("the deployed site", () => {
	test("plays DR's streams, never the test video", async () => {
		for (const path of ["/rejseholdet_503605/rejseholdet_503615", "/program/lise-noergaard_-ikke-kun-en-pige_362031"]) {
			const r = await get(path);
			expect(r.status).toBe(200);
			expect(r.text).toContain("playVideo(");
			expect(r.text).not.toContain("data-test-stream");
			expect(r.text).not.toContain("testvideo");
		}
		expect((await get("/testvideo/video.m3u8")).status).toBe(404);
	});

	test("is the site's own Worker, without the test video among its files", () => {
		expect(config("wrangler.jsonc").main).toBe("src/index.ts");
		const served = files(join(ROOT, "public")).map(path => relative(join(ROOT, "public"), path));
		expect(served.filter(path => /testvideo|\.(m3u8|mp4|m4s|vtt)$/.test(path))).toEqual([]);
	});
});

test("the local test server can't be deployed to workers.dev", () => {
	const local = config("test/browser/wrangler.jsonc");
	expect(local.name).not.toBe("dktv");
	expect(local.workers_dev).toBe(false);
	expect(local.account_id).toBeUndefined();
	expect(local.routes ?? local.route).toBeUndefined();
});
