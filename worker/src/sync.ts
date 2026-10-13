// Keeps viewers' favourites, and how far they got with each video, the same on
// all their devices.
//
// It's kept under a code the viewer makes on one device and types on the others.
// Anyone with the code can read and change what's kept under it, so it's too long
// to be guessed. Without a code, nothing about a viewer is kept here.
//
// Each device sends everything it knows, and gets back that merged with what the
// others sent: for each video, the newest progress wins, and for each show, the
// newest of being made a favourite or not.

import {updateFollows} from "./alerts";
import {type Ctx} from "./dr";

// Without I, O, 0 and 1, which are easily mixed up
export const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// 80 bits
export const CODE_LENGTH = 16;

const MAX_PROGRESS = 2000;
const MAX_FAVORITES = 500;
// How often to try again, when another device changed it at the same time
const ATTEMPTS = 5;

const VIDEO_ID = /^\d{1,12}$/;
const SHOW_ID = /^[\w-]{1,200}$/;

export interface Favorite {
	id: string;
	kind: "show" | "film";
	title: string;
	image: string | null;
	added: number;
}

export interface Progress {
	time: number;
	duration: number | null;
	watched: boolean;
	dismissed: boolean;
	title: string | null;
	show: string | null;
	url: string | null;
	image: string | null;
	// When the video leaves DR
	expires: number | null;
	updated: number;
}

export interface SyncData {
	favorites: Favorite[];
	removed_favorites: Record<string, number>;
	progress: Record<string, Progress>;
}

export function newCode(): string {
	// The alphabet has 32 letters, which a byte divides into evenly
	return Array.from(crypto.getRandomValues(new Uint8Array(CODE_LENGTH)), b => ALPHABET[b % ALPHABET.length]).join("");
}

/** A code as the viewer typed it, like "abcd-efgh-jkmn-pqrs", or undefined if it can't be one */
export function normalizeCode(code: string): string | undefined {
	const letters = [...code.toUpperCase()].filter(c => /[\p{L}\p{N}]/u.test(c)).join("");
	return letters.length == CODE_LENGTH && [...letters].every(c => ALPHABET.includes(c)) ? letters : undefined;
}

export function empty(): SyncData {
	return {favorites: [], removed_favorites: {}, progress: {}};
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	value != null && typeof value == "object" && !Array.isArray(value);

function number(value: unknown): number | null {
	return typeof value == "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown, limit = 500): string | null {
	return typeof value == "string" ? value.slice(0, limit) : null;
}

/** Only links within this site, so a code can't carry a javascript: link to another device */
function localURL(value: unknown): string | null {
	return typeof value == "string" && value.startsWith("/") && !value.startsWith("//") ? value.slice(0, 500) : null;
}

function imageURL(value: unknown): string | null {
	return typeof value == "string" && value.startsWith("https://") ? value.slice(0, 1000) : null;
}

/** What a device sent, keeping only what looks like what progress.js and favorites.js keep */
export function clean(data: unknown): SyncData {
	if (!isObject(data)) {
		throw new TypeError("Expected an object");
	}
	const favorites: Favorite[] = [];
	for (const f of Array.isArray(data.favorites) ? data.favorites : []) {
		if (isObject(f) && typeof f.id == "string" && SHOW_ID.test(f.id)) {
			favorites.push({
				id: f.id,
				kind: f.kind == "film" ? "film" : "show",
				title: text(f.title) || f.id,
				image: imageURL(f.image),
				added: number(f.added) || 0,
			});
		}
	}
	const removed: Record<string, number> = {};
	if (isObject(data.removed_favorites)) {
		for (const [showId, when] of Object.entries(data.removed_favorites)) {
			if (SHOW_ID.test(showId) && number(when) !== null) {
				removed[showId] = number(when)!;
			}
		}
	}
	const progress: Record<string, Progress> = {};
	if (isObject(data.progress)) {
		for (const [videoId, p] of Object.entries(data.progress)) {
			if (!VIDEO_ID.test(videoId) || !isObject(p) || number(p.time) === null) {
				continue;
			}
			progress[videoId] = {
				time: number(p.time)!,
				duration: number(p.duration),
				watched: p.watched === true,
				dismissed: p.dismissed === true,
				title: text(p.title),
				show: text(p.show),
				url: localURL(p.url),
				image: imageURL(p.image),
				expires: number(p.expires),
				updated: number(p.updated) || 0,
			};
		}
	}
	return {favorites, removed_favorites: removed, progress};
}

export function merge(a: SyncData, b: SyncData): SyncData {
	let progress = {...a.progress};
	for (const [videoId, p] of Object.entries(b.progress)) {
		if (!(videoId in progress) || p.updated > progress[videoId].updated) {
			progress[videoId] = p;
		}
	}
	if (Object.keys(progress).length > MAX_PROGRESS) {
		const newest = Object.entries(progress).sort(([, x], [, y]) => y.updated - x.updated);
		progress = Object.fromEntries(newest.slice(0, MAX_PROGRESS));
	}

	// The newest thing that happened to each show: made a favourite, or not
	const latest = new Map<string, [number, Favorite | null]>();
	for (const data of [a, b]) {
		for (const f of data.favorites) {
			if (!latest.has(f.id) || f.added > latest.get(f.id)![0]) {
				latest.set(f.id, [f.added, f]);
			}
		}
		for (const [showId, when] of Object.entries(data.removed_favorites)) {
			if (!latest.has(showId) || when > latest.get(showId)![0]) {
				latest.set(showId, [when, null]);
			}
		}
	}
	const favorites = [...latest.values()]
		.flatMap(([, f]) => (f ? [f] : []))
		.sort((x, y) => y.added - x.added)
		.slice(0, MAX_FAVORITES);
	const removed: Record<string, number> = {};
	for (const [showId, [when, f]] of latest) {
		if (f === null) {
			removed[showId] = when;
		}
	}
	return {favorites, removed_favorites: removed, progress};
}

const seconds = () => Date.now() / 1000;

export async function create(ctx: Ctx): Promise<string> {
	const code = newCode();
	ctx.budget.spend();
	await ctx.env.SYNC.prepare("INSERT INTO sync (code, data, updated, version) VALUES (?, ?, ?, 0)")
		.bind(code, JSON.stringify(empty()), seconds())
		.run();
	return code;
}

/**
 * Merges what a device sent with what's kept under the code, and keeps the result.
 * Undefined if there's nothing under the code.
 */
export async function sync(ctx: Ctx, code: string, data: unknown): Promise<SyncData | undefined> {
	const sent = clean(data);
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		ctx.budget.spend();
		const row = await ctx.env.SYNC.prepare("SELECT data, version FROM sync WHERE code = ?")
			.bind(code)
			.first<{data: string; version: number}>();
		if (row === null) {
			return undefined;
		}
		const merged = merge(clean(JSON.parse(row.data)), sent);
		ctx.budget.spend();
		// Only if no other device changed it since it was read; otherwise, merge with theirs too
		const result = await ctx.env.SYNC.prepare("UPDATE sync SET data = ?, updated = ?, version = version + 1 WHERE code = ? AND version = ?")
			.bind(JSON.stringify(merged), seconds(), code, row.version)
			.run();
		if (result.meta.changes == 1) {
			try {
				await updateFollows(ctx, code, merged.favorites);
			} catch (e) {
				// Only for notifications, which the next sync tries again
				console.log("Could not update which series", code.slice(0, 4), "follows", String(e));
			}
			return merged;
		}
	}
	throw new Error(`Could not sync ${code.slice(0, 4)}…, which kept changing`);
}

/** Everything kept under a code: its favourites and progress, its devices' notifications, and its passkeys */
export async function remove(ctx: Ctx, code: string): Promise<void> {
	const db = ctx.env.SYNC;
	ctx.budget.spend();
	await db.batch([
		db.prepare("DELETE FROM outbox WHERE endpoint IN (SELECT endpoint FROM push WHERE code = ?)").bind(code),
		db.prepare("DELETE FROM push WHERE code = ?").bind(code),
		db.prepare("DELETE FROM follows WHERE code = ?").bind(code),
		db.prepare("DELETE FROM passkeys WHERE code = ?").bind(code),
		db.prepare("DELETE FROM segments WHERE code = ?").bind(code),
		db.prepare("DELETE FROM segment_votes WHERE code = ?").bind(code),
		db.prepare("DELETE FROM challenges WHERE code = ?").bind(code),
		db.prepare("DELETE FROM sync WHERE code = ?").bind(code),
	]);
}
