// The site as it runs on this computer for trying the player without DR's streams, which only
// play in Denmark, and for the browser tests: DR's answers come from the fixtures in
// ../../../tests/fixtures, and every programme plays the test video in ./video, which
// `node scripts/test-video.mjs` makes. Only with ./wrangler.jsonc, which is never deployed;
// and even then, it only answers on localhost.

import {app} from "../../src/index";
import type {Env} from "../../src/dr";
import {fixtureName} from "../fixtures";
import items_362031 from "../../../tests/fixtures/items_362031.json";
import items_503605 from "../../../tests/fixtures/items_503605.json";
import items_503606 from "../../../tests/fixtures/items_503606.json";
import items_503607 from "../../../tests/fixtures/items_503607.json";
import items_503611 from "../../../tests/fixtures/items_503611.json";
import items_503612 from "../../../tests/fixtures/items_503612.json";
import items_540744 from "../../../tests/fixtures/items_540744.json";
import lists_155156 from "../../../tests/fixtures/lists_155156.json";
import lists_376779 from "../../../tests/fixtures/lists_376779.json";
import page_front from "../../../tests/fixtures/page_front.json";
import page_kategorier_fiktionsserier from "../../../tests/fixtures/page_kategorier_fiktionsserier.json";
import schedules from "../../../tests/fixtures/schedules.json";
import searched from "../../../tests/fixtures/search.json";
import playlist from "./video/video.m3u8";
import subtitles from "./video/subtitles.vtt";
import video from "./video/video.mp4";

export {Room} from "../../src/room";

const LOCAL = ["localhost", "127.0.0.1"];

const FIXTURES: Record<string, unknown> = {
	"items_362031.json": items_362031,
	"items_503605.json": items_503605,
	"items_503606.json": items_503606,
	"items_503607.json": items_503607,
	"items_503611.json": items_503611,
	"items_503612.json": items_503612,
	"items_540744.json": items_540744,
	"lists_155156.json": lists_155156,
	"lists_376779.json": lists_376779,
	"page_front.json": page_front,
	"page_kategorier_fiktionsserier.json": page_kategorier_fiktionsserier,
	"schedules.json": schedules,
};

// What the player gets instead of DR's stream, like getStream() in player.js
export const TEST_STREAM = {
	url: "/testvideo/video.m3u8",
	subtitles: [{link: "/testvideo/subtitles.vtt", language: "da", format: "text/vtt"}],
};

const json = (blob: unknown, status = 200) => new Response(JSON.stringify(blob), {status, headers: {"Content-Type": "application/json"}});

/** DR, as the fixtures have it, and as the unit tests' stand-in answers */
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.hostname == "isl.dr-massive.com") {
		return json([
			{type: "Catalog", value: "catalog", expirationDate: "2099-01-01T00:00:00Z"},
			{type: "UserProfile", value: "profile", expirationDate: "2099-01-01T00:00:00Z"},
		]);
	}
	if (url.hostname == "prod95.dr-massive.com") {
		return json(searched);
	}
	if (url.hostname == "production-cdn.dr-massive.com") {
		const path = url.pathname.replace(/^\/api/, "");
		const found = FIXTURES[fixtureName(path, url.searchParams)];
		return found === undefined ? json({message: `Item '${path}' not found`}, 404) : json(found);
	}
	return realFetch(input, init);
};

/** The test video's files, with the parts of the video that the playlist asks for */
function testVideo(request: Request, name: string): Response {
	if (name == "video.m3u8") {
		return new Response(playlist, {headers: {"Content-Type": "application/vnd.apple.mpegurl"}});
	}
	if (name == "subtitles.vtt") {
		return new Response(subtitles, {headers: {"Content-Type": "text/vtt; charset=utf-8"}});
	}
	if (name != "video.mp4") {
		return new Response("Not found", {status: 404});
	}
	const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("Range") ?? "");
	if (range == null) {
		return new Response(video, {headers: {"Content-Type": "video/mp4", "Accept-Ranges": "bytes"}});
	}
	const start = Number(range[1]);
	const end = Math.min(range[2] ? Number(range[2]) : video.byteLength - 1, video.byteLength - 1);
	return new Response(video.slice(start, end + 1), {
		status: 206,
		headers: {"Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${video.byteLength}`},
	});
}

/** Every programme's page plays the test video */
const withTestVideo = new HTMLRewriter().on("video#video[data-title]", {
	element(element) {
		element.setAttribute("data-test-stream", JSON.stringify(TEST_STREAM));
	},
});

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		if (!LOCAL.includes(url.hostname)) {
			return new Response("Only on this computer", {status: 403});
		}
		if (url.pathname.startsWith("/testvideo/")) {
			return testVideo(request, url.pathname.slice("/testvideo/".length));
		}
		const response = await app.fetch(request, env, ctx);
		return (response.headers.get("Content-Type") ?? "").startsWith("text/html") ? withTestVideo.transform(response) : response;
	},
} satisfies ExportedHandler<Env>;
