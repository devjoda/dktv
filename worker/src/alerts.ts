// Notifications when viewers' favourite series get new episodes.
//
// Devices subscribe under a sync code, and follow the series among its favourites.
// Every minute, a few of the followed series are checked on DR, which mostly takes one small
// request each, and a new episode puts a notification in the outbox for each device
// that follows the series. The outbox is sent a few at a time, so each run stays within
// what the free plan allows.

import {type Ctx, type Env, getApi, type Json} from "./dr";
import * as dr from "./models";
import {itemId, thumbnail} from "./show";
import {clean, type Favorite} from "./sync";
import {send, type Subscription, type VapidKeys} from "./webpush";

// How much a run does, since a run, like a visit, may only use about 10 ms of the processor on
// the free plan: each request to DR counts 1, and sending a notification, which is encrypted for
// its device, 2. Checking a series is mostly one request. What a run doesn't do, the next does,
// a minute later. With a check every 15 minutes, that's enough for about 90 followed series;
// with more, each is checked less often. Runs take what they do in hand, so more schedules
// in wrangler.jsonc would do more at once.
const WORK_PER_RUN = 6;
const SEND_WORK = 2;
// How often each series is checked for new episodes, at most, and for new seasons, in seconds
const CHECK_EVERY = 15 * 60;
const CHECK_SEASONS_EVERY = 6 * 60 * 60;
// How long a notification may wait to be sent, in seconds
const OUTBOX_FOR = 24 * 60 * 60;
// Per sync code
export const MAX_DEVICES = 10;

const seconds = () => Date.now() / 1000;

/** Our keys for Web Push, or undefined where they aren't set up */
export function vapidKeys(env: Env): VapidKeys | undefined {
	if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
		return undefined;
	}
	return {publicKey: env.VAPID_PUBLIC_KEY, privateKey: JSON.parse(env.VAPID_PRIVATE_KEY), subject: env.SOURCE_URL || "https://github.com/devjoda/dktv"};
}

/** Follows the series among a code's favourites, and no others */
export async function updateFollows(ctx: Ctx, code: string, favorites: Favorite[]): Promise<void> {
	const db = ctx.env.SYNC;
	// By DR's id, since a series can be a favourite as both rejseholdet_503605 and 503605
	const wanted = new Set(favorites.filter(f => f.kind == "show").flatMap(f => {
		try {
			return [itemId(f.id)];
		} catch {
			return [];
		}
	}));
	ctx.budget.spend();
	const found = await db.prepare("SELECT show FROM follows WHERE code = ?").bind(code).all<{show: string}>();
	const existing = new Set(found.results.map(row => row.show));
	const changes: D1PreparedStatement[] = [];
	for (const show of existing) {
		if (!wanted.has(show)) {
			changes.push(db.prepare("DELETE FROM follows WHERE code = ? AND show = ?").bind(code, show));
		}
	}
	for (const show of wanted) {
		if (!existing.has(show)) {
			changes.push(db.prepare("INSERT OR IGNORE INTO follows (code, show) VALUES (?, ?)").bind(code, show));
			changes.push(db.prepare("INSERT OR IGNORE INTO shows (show) VALUES (?)").bind(show));
		}
	}
	if (changes.length) {
		ctx.budget.spend();
		await db.batch(changes);
	}
}

export type Subscribed = "subscribed" | "unknown code" | "too many";

/** Notifies a device about new episodes of the series among the code's favourites */
export async function subscribe(ctx: Ctx, code: string, subscription: Subscription): Promise<Subscribed> {
	const db = ctx.env.SYNC;
	ctx.budget.spend();
	const row = await db.prepare("SELECT data, (SELECT count(*) FROM push WHERE code = sync.code AND endpoint != ?) AS devices FROM sync WHERE code = ?")
		.bind(subscription.endpoint, code)
		.first<{data: string; devices: number}>();
	if (row === null) {
		return "unknown code";
	}
	if (row.devices >= MAX_DEVICES) {
		return "too many";
	}
	ctx.budget.spend();
	await db.prepare("INSERT OR REPLACE INTO push (endpoint, code, p256dh, auth, created) VALUES (?, ?, ?, ?, ?)")
		.bind(subscription.endpoint, code, subscription.p256dh, subscription.auth, seconds())
		.run();
	await updateFollows(ctx, code, clean(JSON.parse(row.data)).favorites);
	return "subscribed";
}

export async function unsubscribe(ctx: Ctx, code: string, endpoint: string): Promise<void> {
	const db = ctx.env.SYNC;
	ctx.budget.spend();
	await db.batch([
		db.prepare("DELETE FROM outbox WHERE endpoint IN (SELECT endpoint FROM push WHERE endpoint = ? AND code = ?)").bind(endpoint, code),
		db.prepare("DELETE FROM push WHERE endpoint = ? AND code = ?").bind(endpoint, code),
	]);
}

/** What a device is shown: the title, a line about it, and the page it opens */
export interface Notice {
	title: string;
	body: string;
	url: string;
	image?: string;
}

interface Checked {
	show: string;
	season: string | null;
	seasons: number | null;
	episodes: number | null;
	title: string | null;
	seasons_checked: number;
}

/** What a check found: how to keep it, and the notification about it, if any */
export interface Found {
	statements: D1PreparedStatement[];
	notice?: Notice;
}

/**
 * Whether a series has new episodes since it was last checked, and how to keep what was found,
 * with a notification in the outbox for each device that follows it. Mostly, that's one small
 * request to DR, for its newest season; whether there's a new season is checked less often.
 * The first check only notes how far the series is.
 */
export async function check(ctx: Ctx, row: Checked): Promise<Found> {
	const db = ctx.env.SYNC;
	let id: string;
	try {
		id = itemId(row.show);
	} catch {
		return {statements: [db.prepare("DELETE FROM shows WHERE show = ?").bind(row.show)]};
	}
	const now = seconds();
	let {season, seasons, title} = row;
	let seasonsChecked = row.seasons_checked;
	if (season === null || now - seasonsChecked > CHECK_SEASONS_EVERY) {
		const show = await getApi(ctx, `/items/${id}`);
		title = dr.text(show?.title) ?? title;
		const count = dr.integer(show?.availableSeasonCount) ?? null;
		// A new season, or the first check: which is the newest
		if (season === null || count !== seasons) {
			const full = await getApi(ctx, `/items/${id}`, {expand: "all"});
			season = dr.required(dr.items(full, "seasons").at(-1), "id");
		}
		seasons = count;
		seasonsChecked = now;
	}
	const episodes = dr.integer((await getApi(ctx, `/items/${season}`))?.availableEpisodeCount) ?? 0;
	const added = row.season === null ? 0 : season != row.season ? episodes : episodes - (row.episodes ?? 0);

	const found: Found = {statements: []};
	if (added > 0) {
		const children = await getApi(ctx, `/items/${season}/children`);
		const newest: Json = Array.isArray(children?.items) ? children.items.at(-1) : undefined;
		if (newest?.path) {
			const name = title ?? dr.text(newest.title) ?? "";
			found.notice = {
				title: added == 1 ? `Nyt afsnit af ${name}` : `${added} nye afsnit af ${name}`,
				body: dr.episodeTitle(newest),
				url: `/${row.show}/${dr.required(newest, "path").split("/").at(-1)}`,
				image: thumbnail(dr.wallpaper(newest)),
			};
			found.statements.push(db.prepare(`INSERT INTO outbox (endpoint, p256dh, auth, payload, created)
				SELECT p.endpoint, p.p256dh, p.auth, ?, ? FROM push p JOIN follows f ON f.code = p.code WHERE f.show = ?`)
				.bind(JSON.stringify(found.notice), now, row.show));
		}
	}
	found.statements.push(db.prepare("UPDATE shows SET season = ?, seasons = ?, episodes = ?, title = ?, seasons_checked = ? WHERE show = ?")
		.bind(season, seasons, episodes, title, seasonsChecked, row.show));
	return found;
}

/** Sends what's in the outbox, as much as there's time for, and forgets devices that are gone */
export async function sendWaiting(ctx: Ctx, keys: VapidKeys, most = WORK_PER_RUN / SEND_WORK): Promise<number> {
	const db = ctx.env.SYNC;
	const room = Math.min(most, ctx.budget.left - 4);
	if (room <= 0) {
		return 0;
	}
	ctx.budget.spend();
	// Taken out of the outbox, so another run doesn't send them too
	const waiting = await db.prepare(`DELETE FROM outbox WHERE id IN (SELECT id FROM outbox WHERE p256dh IS NOT NULL ORDER BY id LIMIT ?)
		RETURNING endpoint, p256dh, auth, payload, created`)
		.bind(room)
		.all<Subscription & {payload: string; created: number}>();
	if (waiting.results.length == 0) {
		return 0;
	}
	const gone: string[] = [];
	const again: typeof waiting.results = [];
	let sent = 0;
	for (const message of waiting.results) {
		ctx.budget.spend();
		let result;
		try {
			result = await send(message, message.payload, keys);
		} catch (e) {
			console.log("Could not send a notification", String(e));
			result = "failed";
		}
		if (result == "sent") {
			sent++;
		} else if (result == "gone") {
			gone.push(message.endpoint);
		} else {
			again.push(message);
		}
	}
	const changes = [
		// Tried again on the next run, until it's been waiting too long
		...again.map(m => db.prepare("INSERT INTO outbox (endpoint, p256dh, auth, payload, created) VALUES (?, ?, ?, ?, ?)")
			.bind(m.endpoint, m.p256dh, m.auth, m.payload, m.created)),
		...gone.flatMap(endpoint => [
			db.prepare("DELETE FROM outbox WHERE endpoint = ?").bind(endpoint),
			db.prepare("DELETE FROM push WHERE endpoint = ?").bind(endpoint),
		]),
	];
	if (changes.length) {
		ctx.budget.spend();
		await db.batch(changes);
	}
	return sent;
}

/** What the scheduled run does every minute */
export async function run(ctx: Ctx, keys: VapidKeys): Promise<void> {
	const db = ctx.env.SYNC;
	let work = WORK_PER_RUN - SEND_WORK * await sendWaiting(ctx, keys);
	const now = seconds();
	if (work < 1) {
		return;
	}
	ctx.budget.spend();
	// Taken in hand, so another run doesn't check them too
	const due = await db.prepare(`UPDATE shows SET checked = ? WHERE show IN (
			SELECT show FROM shows s
			WHERE checked < ? AND EXISTS (SELECT 1 FROM follows f JOIN push p ON p.code = f.code WHERE f.show = s.show)
			ORDER BY checked LIMIT ?)
		RETURNING show, season, seasons, episodes, title, seasons_checked`)
		.bind(now, now - CHECK_EVERY, Math.floor(work))
		.all<Checked>();
	const statements: D1PreparedStatement[] = [];
	for (const row of due.results) {
		// Those not checked now are next in line, on the next run
		if (work < 1 || ctx.budget.left < 12) {
			statements.push(db.prepare("UPDATE shows SET checked = 0 WHERE show = ?").bind(row.show));
			continue;
		}
		const left = ctx.budget.left;
		try {
			statements.push(...(await check(ctx, row)).statements);
		} catch (e) {
			// Checked again in its turn, whether DR doesn't have it any more or didn't answer
			console.log("Could not check", row.show, "for new episodes", String(e));
		}
		work -= left - ctx.budget.left;
	}
	if (statements.length) {
		ctx.budget.spend();
		await db.batch(statements);
	}
	if (work >= SEND_WORK) {
		await sendWaiting(ctx, keys, Math.floor(work / SEND_WORK));
	}
	if (new Date().getUTCMinutes() == 0) {
		await cleanUp(ctx);
	}
}

/** Once an hour: forgets what's run out, and series nobody follows any more */
export async function cleanUp(ctx: Ctx): Promise<void> {
	const db = ctx.env.SYNC;
	ctx.budget.spend();
	await db.batch([
		db.prepare("DELETE FROM outbox WHERE created < ?").bind(seconds() - OUTBOX_FOR),
		db.prepare("DELETE FROM challenges WHERE expires < ?").bind(seconds()),
		db.prepare("DELETE FROM shows WHERE NOT EXISTS (SELECT 1 FROM follows f WHERE f.show = shows.show)"),
	]);
}
