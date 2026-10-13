// Getting things from DR's API

export interface Env {
	SYNC: D1Database;
	// "Se sammen": a Durable Object for each room
	ROOMS?: DurableObjectNamespace;
	VERSION?: {id: string};
	SERVICE_NAME?: string;
	SOURCE_URL?: string;
	RECOMMENDED_SHOWS?: string;
	// Accounts whose marks of intros and credits count on their own, as a secret, like "ABCD-EFGH-JKMN-PQRS"
	TRUSTED_ACCOUNTS?: string;
	// For notifications: our public key, uncompressed and base64url, and the private one as a JWK
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
}

/** DR doesn't have it, or it isn't anything here */
export class NotFound extends Error {}

/** DR didn't answer, or answered with an error of its own */
export class DRUnavailable extends Error {}

/** A visit would need to ask other servers for more than a Worker may */
export class OverBudget extends Error {}

/**
 * How many more requests a visit may make to other servers and to Cloudflare's own services,
 * like its cache and database. Cloudflare's free plan allows 50 per visit; a few are kept
 * spare, so a visit that runs out can still answer.
 */
export class Budget {
	constructor(public left = 46) {}

	spend(count = 1) {
		if (this.left < count) {
			throw new OverBudget(`Needed ${count} more requests, with ${this.left} left`);
		}
		this.left -= count;
	}
}

/** What's needed to fetch and keep things during one visit */
export interface Ctx {
	env: Env;
	budget: Budget;
	// How many more things that ran out this visit may get again, instead of using what was kept,
	// or things a page can do without
	refreshes: number;
	// Whether the visit left something out, which its page then isn't kept without
	incomplete: boolean;
	// What the visit is getting already, by its key
	pending: Map<string, Promise<unknown>>;
	waitUntil(promise: Promise<unknown>): void;
	// Where the visit came to, like https://dktv.example, for keys in Cloudflare's cache
	origin: string;
}

export const API = "https://production-cdn.dr-massive.com/api";
// The parameters DR's own website sends along
const API_PARAMS = {
	device: "web_browser",
	ff: "idp,ldp,rpt",
	lang: "da",
	segments: "drtv,optedout",
	sub: "Anonymous",
};
const TIMEOUT = 5000;

export type Json = any;
export type Params = Record<string, string | number>;

async function request(ctx: Ctx, url: string, init: RequestInit, what: string): Promise<Response> {
	ctx.budget.spend();
	try {
		return await fetch(url, {...init, signal: AbortSignal.timeout(TIMEOUT)});
	} catch (e) {
		throw new DRUnavailable(`Could not reach DR for ${what}: ${e}`);
	}
}

/** Gets something from DR's API, like `/items/{id}` */
export async function getApi(ctx: Ctx, path: string, params: Params = {}): Promise<Json> {
	const query = new URLSearchParams({...API_PARAMS, ...stringify(params)});
	const r = await request(ctx, `${API}${path}?${query}`, {}, path);
	// DR doesn't have it, or doesn't think we asked for anything sensible
	if (r.status >= 400 && r.status < 500) {
		throw new NotFound(`DR responded ${r.status} to ${path}`);
	}
	if (r.status != 200) {
		throw new DRUnavailable(`DR responded ${r.status} to ${path}`);
	}
	try {
		return await r.json();
	} catch (e) {
		throw new DRUnavailable(`DR's answer to ${path} wasn't JSON: ${e}`);
	}
}

function stringify(params: Params): Record<string, string> {
	return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]));
}

// Searching needs a token, which DR gives anyone
const TOKEN_API = "https://isl.dr-massive.com/api/authorization/anonymous-sso?device=web_browser&lang=da&supportFallbackToken=true";
let token = {value: "", expires: 0};

async function getToken(ctx: Ctx): Promise<string> {
	// A minute early, so it doesn't run out on the way
	if (Date.now() < token.expires - 60_000) {
		return token.value;
	}
	const r = await request(ctx, TOKEN_API, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({deviceId: crypto.randomUUID(), scopes: ["Catalog"], optout: true}),
	}, "a token");
	if (r.status != 200) {
		throw new DRUnavailable(`DR responded ${r.status} when asked for a token`);
	}
	const tokens: Json[] = await r.json();
	// DR gives two tokens. The UserProfile one is used for search
	const profile = Array.isArray(tokens) ? tokens.find(t => t && t.type == "UserProfile") : undefined;
	const expires = Date.parse(profile?.expirationDate);
	if (typeof profile?.value != "string" || Number.isNaN(expires)) {
		throw new DRUnavailable("DR gave no token for searching");
	}
	token = {value: profile.value, expires};
	return token.value;
}

export const SEARCH_API = "https://prod95.dr-massive.com/api/search";
// The parameters DR's own website sends along when searching
const SEARCH_PARAMS = {
	device: "web_browser",
	ff: "idp,ldp,rpt",
	group: "true",
	lang: "da",
	segments: "drtv,optedout",
};

export async function fetchSearch(ctx: Ctx, term: string): Promise<Json> {
	const query = new URLSearchParams({...SEARCH_PARAMS, term});
	const r = await request(ctx, `${SEARCH_API}?${query}`, {
		headers: {"X-Authorization": `Bearer ${await getToken(ctx)}`},
	}, "a search");
	if (r.status != 200) {
		throw new DRUnavailable(`DR responded ${r.status} to a search`);
	}
	return await r.json();
}

/** For tests: forgets the token, as a new Worker would */
export function forgetToken() {
	token = {value: "", expires: 0};
}
