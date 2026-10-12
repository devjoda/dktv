// Notifications when viewers' favourite series get new episodes.
//
// Devices subscribe under a sync code, and follow the series among its favourites.
// Every minute, a few of the followed series are checked on DR, which takes two small
// requests each, and a new episode puts a notification in the outbox for each device
// that follows the series. The outbox is sent a few at a time, so each run stays within
// what the free plan allows.

import {type Ctx, type Env, getApi, type Json} from "./dr";
import * as dr from "./models";
import {itemId, thumbnail} from "./show";
import {clean, type Favorite} from "./sync";
import {send, type Subscription, type VapidKeys} from "./webpush";

// Each a request to a push service, of the 50 a run may make
const SENDS_PER_RUN = 15;
// Each two or three requests to DR
const SHOWS_PER_RUN = 6;
// How often each series is checked, at most, in seconds
const CHECK_EVERY = 15 * 60;
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
	const wanted = new Set(favorites.filter(f => f.kind == "show").map(f => f.id));
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
}

/**
 * Whether a series has new episodes since it was last checked, and puts a notification in the
 * outbox for each device that follows it. The first check only notes how far it is.
 */
export async function check(ctx: Ctx, row: Checked): Promise<Notice | undefined> {
	const db = ctx.env.SYNC;
	let id: string;
	try {
		id = itemId(row.show);
	} catch {
		ctx.budget.spend();
		await db.prepare("DELETE FROM shows WHERE show = ?").bind(row.show).run();
		return undefined;
	}
	const show = await getApi(ctx, `/items/${id}`);
	const seasons = dr.integer(show?.availableSeasonCount) ?? null;
	let season = row.season;
	// A new season, or the first check: which is the newest
	if (season === null || seasons !== row.seasons) {
		const full = await getApi(ctx, `/items/${id}`, {expand: "all"});
		season = dr.required(dr.items(full, "seasons").at(-1), "id");
	}
	const episodes = dr.integer((await getApi(ctx, `/items/${season}`))?.availableEpisodeCount) ?? 0;
	const added = row.season === null ? 0 : season != row.season ? episodes : episodes - (row.episodes ?? 0);

	let notice: Notice | undefined;
	if (added > 0) {
		const children = await getApi(ctx, `/items/${season}/children`);
		const newest: Json = Array.isArray(children?.items) ? children.items.at(-1) : undefined;
		if (newest?.path) {
			const title = dr.text(show.title) ?? "";
			notice = {
				title: added == 1 ? `Nyt afsnit af ${title}` : `${added} nye afsnit af ${title}`,
				body: dr.episodeTitle(newest),
				url: `/${row.show}/${dr.required(newest, "path").split("/").at(-1)}`,
				image: thumbnail(dr.wallpaper(newest) ?? dr.wallpaper(show)),
			};
			ctx.budget.spend();
			await db.prepare("INSERT INTO outbox (endpoint, payload, created) SELECT p.endpoint, ?, ? FROM push p JOIN follows f ON f.code = p.code WHERE f.show = ?")
				.bind(JSON.stringify(notice), seconds(), row.show)
				.run();
		}
	}
	ctx.budget.spend();
	await db.prepare("UPDATE shows SET season = ?, seasons = ?, episodes = ?, checked = ? WHERE show = ?")
		.bind(season, seasons, episodes, seconds(), row.show)
		.run();
	return notice;
}

/** Sends what's in the outbox, as much as there's time for, and forgets devices that are gone */
export async function sendWaiting(ctx: Ctx, keys: VapidKeys, most = SENDS_PER_RUN): Promise<number> {
	const db = ctx.env.SYNC;
	const room = Math.min(most, ctx.budget.left - 4);
	if (room <= 0) {
		return 0;
	}
	ctx.budget.spend();
	const waiting = await db.prepare("SELECT o.id, o.endpoint, o.payload, p.p256dh, p.auth FROM outbox o JOIN push p ON p.endpoint = o.endpoint ORDER BY o.id LIMIT ?")
		.bind(room)
		.all<{id: number; endpoint: string; payload: string} & Subscription>();
	if (waiting.results.length == 0) {
		return 0;
	}
	const done: number[] = [];
	const gone: string[] = [];
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
			done.push(message.id);
		} else if (result == "gone") {
			gone.push(message.endpoint);
		}
	}
	const changes = [
		...done.map(id => db.prepare("DELETE FROM outbox WHERE id = ?").bind(id)),
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
	await sendWaiting(ctx, keys);
	ctx.budget.spend();
	const due = await db.prepare(`SELECT show, season, seasons, episodes FROM shows s
		WHERE checked < ? AND EXISTS (SELECT 1 FROM follows f JOIN push p ON p.code = f.code WHERE f.show = s.show)
		ORDER BY checked LIMIT ?`)
		.bind(seconds() - CHECK_EVERY, SHOWS_PER_RUN)
		.all<Checked>();
	for (const row of due.results) {
		// Room for checking it, and for what's sent after
		if (ctx.budget.left < 12) {
			break;
		}
		try {
			await check(ctx, row);
		} catch (e) {
			console.log("Could not check", row.show, "for new episodes", String(e));
			// Not first in line again on the next run, whether DR doesn't have it any more or didn't answer
			ctx.budget.spend();
			await db.prepare("UPDATE shows SET checked = ? WHERE show = ?").bind(seconds(), row.show).run();
		}
	}
	await sendWaiting(ctx, keys);
	ctx.budget.spend();
	await db.batch([
		db.prepare("DELETE FROM outbox WHERE created < ?").bind(seconds() - OUTBOX_FOR),
		db.prepare("DELETE FROM challenges WHERE expires < ?").bind(seconds()),
		// Series nobody follows any more
		db.prepare("DELETE FROM shows WHERE NOT EXISTS (SELECT 1 FROM follows f WHERE f.show = shows.show)"),
	]);
}
