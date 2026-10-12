// How much CPU each page takes to build, in Node: the first time (as in a new copy of the Worker),
// again without what's kept (as when DR's data has run out), and with it.
// Run with `npm run bench`, which asks DR itself.
import app from "../src/index";
import {expireAll, forgetAll} from "../src/cache";

const env = {SERVICE_NAME: "dktv", SOURCE_URL: "https://github.com/devjoda/dktv", RECOMMENDED_SHOWS: ""};
const ctx = {waitUntil() {}, passThroughOnException() {}, props: {}};

// DR's answers, got once and then given again without the network, which isn't counted on Cloudflare
const real = globalThis.fetch;
const recorded = new Map<string, Promise<[string, number]>>();
const key = (url: string) => url.replace(/date=[^&]*&hour=\d+/, "");
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input instanceof Request ? input.url : input);
	if (!recorded.has(key(url))) {
		recorded.set(key(url), real(url, init).then(async r => [await r.text(), r.status]));
	}
	const [body, status] = await recorded.get(key(url))!;
	return new Response(body, {status});
};

async function cpu(path: string): Promise<string> {
	const before = process.cpuUsage();
	const response = await app.request(path, {}, env, ctx as any);
	await response.text();
	const spent = process.cpuUsage(before);
	return `${((spent.user + spent.system) / 1000).toFixed(1).padStart(6)} ms`;
}

// Records DR's answers for all of them first
for (const path of process.argv.slice(2).length ? process.argv.slice(2) : ["/", "/rejseholdet_503605/", "/kategorier/film/", "/liste/355817/", "/search/?query=matador", "/live/DR1"]) {
	await app.request(path, {}, env, ctx as any);
}
forgetAll();
console.log = () => {};

const paths = process.argv.slice(2).length ? process.argv.slice(2) : ["/", "/rejseholdet_503605/", "/kategorier/film/", "/liste/355817/", "/search/?query=matador", "/live/DR1"];
for (const path of paths) {
	const first = await cpu(path);
	forgetAll();
	const again = await cpu(path);
	const kept = await cpu(path);
	expireAll();
	const expired = await cpu(path);
	process.stdout.write(`${path.padEnd(26)} first ${first}   fresh from DR ${again}   kept ${kept}   ran out ${expired}\n`);
}
