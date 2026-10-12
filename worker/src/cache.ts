// Keeps what's been got from DR, so visitors seldom wait for it: in the Worker's memory,
// which lasts as long as that copy of the Worker keeps running, and in Cloudflare's cache,
// which every copy in the same data centre shares.
//
// A visit may only use a little of the processor, so when much has run out at once,
// like all of the front page's rows, a visit only gets a couple of them again, and uses
// what was kept of the others. The visits after it get the rest.

import {type Ctx, DRUnavailable, OverBudget} from "./dr";
import keptVersion from "./kept-version.json";

interface Kept<T> {
	// When it should be got again, in milliseconds
	until: number;
	value: T;
}

const memory = new Map<string, Kept<unknown>>();
// Far more than is visited at once; each is at most a show's episodes
const MAX_IN_MEMORY = 400;
// How long something is kept past running out, for when DR doesn't answer, and for visits
// to use while they get other things, in seconds
const STALE_FOR = 7 * 24 * 60 * 60;
// How soon to ask DR again, when it didn't answer
const RETRY_AFTER = 60;
// How many things that ran out a visit gets again, when it has something kept to use instead
export const REFRESHES_PER_VISIT = 2;

function remember(key: string, kept: Kept<unknown>) {
	memory.delete(key);
	memory.set(key, kept);
	if (memory.size > MAX_IN_MEMORY) {
		// Maps keep the order things were put in, so this is the one used longest ago
		memory.delete(memory.keys().next().value!);
	}
}

/** Cloudflare's cache, which isn't there in tests */
function edgeCache(): Cache | null {
	return typeof caches != "undefined" ? caches.default : null;
}

function cacheKey(ctx: Ctx, key: string): string {
	// Changes with the code that makes what's kept, so a new version of it doesn't read what
	// an older one kept. Other updates keep it, so they needn't get everything from DR again.
	return `${ctx.origin}/_kept/${keptVersion.version}/${encodeURIComponent(key)}`;
}

async function fromEdge<T>(ctx: Ctx, key: string): Promise<Kept<T> | undefined> {
	const cache = edgeCache();
	if (cache == null || ctx.budget.left < 2) {
		return undefined;
	}
	try {
		ctx.budget.spend();
		const found = await cache.match(cacheKey(ctx, key));
		return found ? await found.json() : undefined;
	} catch (e) {
		console.log("Could not read", key, "from the cache", String(e));
		return undefined;
	}
}

function toEdge(ctx: Ctx, key: string, kept: Kept<unknown>) {
	const cache = edgeCache();
	if (cache == null || ctx.budget.left < 1) {
		return;
	}
	ctx.budget.spend();
	const seconds = Math.round((kept.until - Date.now()) / 1000) + STALE_FOR;
	const response = new Response(JSON.stringify(kept), {
		headers: {"Content-Type": "application/json", "Cache-Control": `max-age=${seconds}`},
	});
	ctx.waitUntil(cache.put(cacheKey(ctx, key), response).catch(e => console.log("Could not keep", key, String(e))));
}

/**
 * What build() gives, kept for about maxAge seconds: a little more or less, so what's
 * got at the same time doesn't run out at the same time. When DR doesn't answer, what
 * was got before is used for a while longer, if anything was.
 */
export async function cached<T>(ctx: Ctx, key: string, maxAge: number, build: () => Promise<T>): Promise<T> {
	return (await keep(ctx, key, maxAge, build, false))!;
}

/**
 * Like cached, for what a page can do without, like one of many rows: when nothing is kept,
 * and the visit has got all it may, it's undefined, and the page isn't kept, so the next
 * visit gets it.
 */
export async function cachedIfTime<T>(ctx: Ctx, key: string, maxAge: number, build: () => Promise<T>): Promise<T | undefined> {
	return keep(ctx, key, maxAge, build, true);
}

async function keep<T>(ctx: Ctx, key: string, maxAge: number, build: () => Promise<T>, optional: boolean): Promise<T | undefined> {
	const now = Date.now();
	let kept = memory.get(key) as Kept<T> | undefined;
	if (kept === undefined) {
		kept = await fromEdge<T>(ctx, key);
		if (kept !== undefined) {
			remember(key, kept);
		}
	}
	if (kept !== undefined && (now < kept.until || ctx.refreshes <= 0)) {
		return kept.value;
	}
	if (kept === undefined && optional && ctx.refreshes <= 0) {
		ctx.incomplete = true;
		return undefined;
	}
	if (kept !== undefined || optional) {
		ctx.refreshes--;
	}
	try {
		const value = await build();
		const fresh = {until: now + maxAge * (0.8 + 0.4 * Math.random()) * 1000, value};
		remember(key, fresh);
		toEdge(ctx, key, fresh);
		return value;
	} catch (e) {
		if (kept !== undefined && (e instanceof DRUnavailable || e instanceof OverBudget)) {
			console.log("Using what was kept of", key, "since", String(e));
			// Try again in a minute, instead of on every visit
			remember(key, {until: now + RETRY_AFTER * 1000, value: kept.value});
			return kept.value;
		}
		throw e;
	}
}

/** What's kept in this copy of the Worker's memory, without getting it */
export function peek<T>(key: string): T | undefined {
	return (memory.get(key) as Kept<T> | undefined)?.value;
}

/** For tests: lets everything run out, as if it had been kept long ago */
export function expireAll() {
	for (const kept of memory.values()) {
		kept.until = 0;
	}
}

/** For tests: forgets everything, as a new Worker would */
export function forgetAll() {
	memory.clear();
}
