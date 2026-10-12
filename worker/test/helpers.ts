// A stand-in for DR, which serves the fixtures in ../tests/fixtures, and for the database

import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterEach, beforeEach, vi} from "vitest";
import app from "../src/index";
import {forgetAll} from "../src/cache";
import {Budget, type Ctx, forgetToken} from "../src/dr";
import {clock} from "../src/time";

const FIXTURES = join(__dirname, "..", "..", "tests", "fixtures");
const MIGRATIONS = join(__dirname, "..", "migrations");
// What get_api adds to every request, which the tests leave out of what was requested
const STANDARD = new Set(["device", "ff", "lang", "segments", "sub"]);

export function load(name: string): any {
	return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

/** Named after its path in the API, as tests/update_fixtures.py saves them */
function fixtureName(path: string, params: URLSearchParams): string {
	if (path == "/page") {
		return "page_" + (params.get("path")!.replace(/^\/+|\/+$/g, "").replaceAll("/", "_") || "front") + ".json";
	}
	return path.replace(/^\/+|\/+$/g, "").replaceAll("/", "_") + ".json";
}

/** The rows' lists, which the pages' fixtures have the start of */
function listsInPages(): Map<string, any> {
	const lists = new Map<string, any>();
	for (const name of readdirSync(FIXTURES).filter(n => n.startsWith("page_"))) {
		for (const entry of load(name).entries ?? []) {
			if (entry.list?.id && entry.list.items?.length) {
				lists.set(String(entry.list.id), entry.list);
			}
		}
	}
	return lists;
}

const json = (blob: unknown, status = 200) => new Response(JSON.stringify(blob), {status, headers: {"Content-Type": "application/json"}});

export const dr = {
	// What was asked of DR, like "/items/503605?expand=all", and "search:matador" for searches
	requested: [] as string[],
	// Answers in place of the fixtures', as JSON or a whole response, or undefined for the fixture's
	answer: undefined as ((path: string, params: URLSearchParams) => unknown) | undefined,
	// DR answering every request with an error of its own
	down: false,
};

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.hostname == "isl.dr-massive.com") {
		return json([
			{type: "Catalog", value: "catalog", expirationDate: "2099-01-01T00:00:00Z"},
			{type: "UserProfile", value: "profile", expirationDate: "2099-01-01T00:00:00Z"},
		]);
	}
	if (url.hostname == "prod95.dr-massive.com") {
		dr.requested.push("search:" + url.searchParams.get("term"));
		if (dr.down) {
			return json({}, 503);
		}
		return json(dr.answer?.("/search", url.searchParams) ?? load("search.json"));
	}
	const path = url.pathname.replace(/^\/api/, "");
	const extra = new URLSearchParams([...url.searchParams].filter(([k]) => !STANDARD.has(k)));
	dr.requested.push(path + (extra.size ? "?" + extra : ""));
	if (dr.down) {
		return json({message: "Oops"}, 503);
	}
	const answer = dr.answer?.(path, url.searchParams);
	if (answer instanceof Response) {
		return answer;
	}
	if (answer !== undefined) {
		return json(answer);
	}
	const name = fixtureName(path, url.searchParams);
	if (existsSync(join(FIXTURES, name))) {
		return json(load(name));
	}
	const list = /^\/lists\/(\d+)$/.exec(path);
	if (list && listsInPages().has(list[1])) {
		return json(listsInPages().get(list[1]));
	}
	return json({message: `Item '${path}' not found`}, 404);
}

/** A stand-in for Cloudflare's D1, on Node's own SQLite */
export function fakeD1(): D1Database {
	const db = new DatabaseSync(":memory:");
	for (const name of readdirSync(MIGRATIONS).sort()) {
		db.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
	}
	return {
		prepare(sql: string) {
			let args: any[] = [];
			const statement = {
				bind(...values: any[]) {
					args = values;
					return statement;
				},
				async first() {
					return db.prepare(sql).get(...args) ?? null;
				},
				async run() {
					const result = db.prepare(sql).run(...args);
					return {success: true, meta: {changes: Number(result.changes)}};
				},
			};
			return statement;
		},
	} as unknown as D1Database;
}

export const env = {
	SYNC: undefined as unknown as D1Database,
	SERVICE_NAME: "dktv",
	SOURCE_URL: "https://github.com/devjoda/dktv",
	RECOMMENDED_SHOWS: "",
};

/** What a visit has, for calling the Worker's parts on their own */
export function ctx(): Ctx {
	return {env, budget: new Budget(), refreshes: 2, incomplete: false, pending: new Map(), waitUntil() {}, origin: "http://localhost"};
}

export interface Got {
	status: number;
	text: string;
	contentType: string;
	location: string | null;
	headers: Headers;
}

/** Asks the Worker for a page, and waits for what it does after answering */
export async function request(path: string, init: RequestInit = {}): Promise<Got> {
	const waiting: Promise<unknown>[] = [];
	const ctx = {waitUntil: (p: Promise<unknown>) => waiting.push(p), passThroughOnException() {}, props: {}};
	const r = await app.request(path, init, env, ctx as unknown as ExecutionContext);
	const text = await r.text();
	await Promise.all(waiting);
	return {status: r.status, text, contentType: r.headers.get("Content-Type") ?? "", location: r.headers.get("Location"), headers: r.headers};
}

export const get = (path: string) => request(path);

export function post(path: string, data?: unknown, contentType = "application/json") {
	return request(path, {
		method: "POST",
		body: data === undefined ? undefined : typeof data == "string" ? data : JSON.stringify(data),
		headers: data === undefined ? {} : {"Content-Type": contentType},
	});
}

/** Between two strings, like the part of a page between two of its tags */
export function between(text: string, start: string, end: string): string {
	const from = text.indexOf(start);
	if (from < 0) {
		throw new Error(`No ${start}`);
	}
	return text.slice(from + start.length).split(end)[0];
}

const realNow = clock.now;

beforeEach(() => {
	dr.requested = [];
	dr.answer = undefined;
	dr.down = false;
	env.SYNC = fakeD1();
	env.SOURCE_URL = "https://github.com/devjoda/dktv";
	env.RECOMMENDED_SHOWS = "";
	clock.now = realNow;
	forgetAll();
	forgetToken();
	vi.stubGlobal("fetch", fakeFetch);
	vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
