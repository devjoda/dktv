// Where intros and credits are in DR's videos, as viewers with accounts have marked them, so the
// player can offer to skip the intro, and offer the next episode as the credits start.
//
// Only times are kept, never anything of the video. A mark is shown when an account trusted
// with it made it, or when two accounts agree; and in a season where at least three episodes
// agree, it's suggested for the others too, since many series have the same intro and credits.
// "Forkert?" from two accounts hides a mark again.

import type {Ctx, Env} from "./dr";

export type Kind = "intro" | "credits";
export const KINDS: Kind[] = ["intro", "credits"];

// How close two marks must be to agree, in seconds
const AGREE = 2;
// How many episodes of a season must agree before it's suggested for the others
const SEASON_AGREES = 3;
// How many marks an account may make in a day
const MARKS_PER_DAY = 300;

/** What the player gets: the intro from start to end, and the credits as how long before the end they start */
export interface Segments {
	intro?: {start: number; end: number; suggested?: boolean};
	credits?: {fromEnd: number; suggested?: boolean};
}

interface Mark {
	video: string;
	kind: Kind;
	code: string;
	start: number;
	end: number;
	duration: number;
}

/** The accounts whose marks count on their own, like the site's own, from TRUSTED_ACCOUNTS */
function trusted(env: Env): Set<string> {
	return new Set((env.TRUSTED_ACCOUNTS ?? "").split(/[\s,]+/).map(code => code.toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean));
}

/** What a mark says, comparable between videos of different lengths */
function measure(mark: Mark): [number, number] {
	return mark.kind == "intro" ? [mark.start, mark.end - mark.start] : [mark.duration - mark.start, 0];
}

function agree(a: [number, number], b: [number, number]): boolean {
	return Math.abs(a[0] - b[0]) <= AGREE && Math.abs(a[1] - b[1]) <= AGREE;
}

const average = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

/** What the marks of one video agree on, if they agree enough: a trusted account's, or two that agree */
export function consensus(marks: Mark[], downvotes: string[], upvotes: string[], trustedCodes: Set<string>): [number, number] | undefined {
	// Two accounts finding it wrong, more than found it right, or a trusted account, hides it
	const down = new Set(downvotes);
	if ([...down].some(code => trustedCodes.has(code)) || (down.size >= 2 && down.size > new Set(upvotes).size)) {
		return undefined;
	}
	const own = marks.find(mark => trustedCodes.has(mark.code));
	if (own) {
		return measure(own);
	}
	const measured = marks.map(measure);
	for (let i = 0; i < measured.length; i++) {
		const agreeing = measured.filter(other => agree(measured[i], other));
		if (agreeing.length >= 2) {
			return [average(agreeing.map(m => m[0])), average(agreeing.map(m => m[1]))];
		}
	}
	return undefined;
}

/** What the intro and credits of `video` are, from its own marks, or from those of the other videos in its season */
export function segmentsOf(video: string, season: string[], marks: Mark[], votes: {video: string; kind: Kind; code: string; vote: number}[], trustedCodes: Set<string>): Segments {
	const found: Segments = {};
	for (const kind of KINDS) {
		const agreed = new Map<string, [number, number]>();
		for (const id of season.includes(video) ? season : [video, ...season]) {
			const these = votes.filter(v => v.video == id && v.kind == kind);
			const result = consensus(marks.filter(m => m.video == id && m.kind == kind), these.filter(v => v.vote < 0).map(v => v.code), these.filter(v => v.vote > 0).map(v => v.code), trustedCodes);
			if (result) {
				agreed.set(id, result);
			}
		}
		let result = agreed.get(video);
		let suggested = false;
		if (!result) {
			// The others in the season, if enough of them agree
			const others = [...agreed.values()];
			const agreeing = others.map(m => others.filter(o => agree(m, o))).sort((a, b) => b.length - a.length)[0] ?? [];
			// And not if this video's own marks were found wrong
			const wrong = votes.some(v => v.video == video && v.kind == kind && v.vote < 0);
			if (agreeing.length >= SEASON_AGREES && !wrong) {
				result = [average(agreeing.map(m => m[0])), average(agreeing.map(m => m[1]))];
				suggested = true;
			}
		}
		if (result) {
			const round = (n: number) => Math.round(n * 10) / 10;
			if (kind == "intro") {
				found.intro = {start: round(result[0]), end: round(result[0] + result[1]), ...(suggested ? {suggested} : {})};
			} else {
				found.credits = {fromEnd: round(result[0]), ...(suggested ? {suggested} : {})};
			}
		}
	}
	return found;
}

/** The intro and credits of a video, given the videos of its season, which one request to the database finds */
export async function getSegments(ctx: Ctx, video: string, season: string[]): Promise<Segments> {
	const ids = [...new Set([video, ...season])].slice(0, 90);
	const marks = `?${",?".repeat(ids.length - 1)}`;
	ctx.budget.spend();
	const [found, votes] = await ctx.env.SYNC.batch([
		ctx.env.SYNC.prepare(`SELECT video, kind, code, start, "end", duration FROM segments WHERE video IN (${marks})`).bind(...ids),
		ctx.env.SYNC.prepare(`SELECT video, kind, code, vote FROM segment_votes WHERE video IN (${marks})`).bind(...ids),
	]);
	return segmentsOf(video, ids, found.results as unknown as Mark[], votes.results as never, trusted(ctx.env));
}

/** Whether a mark could be what it says, in seconds */
export function plausible(kind: Kind, start: number, end: number, duration: number): boolean {
	if (![start, end, duration].every(Number.isFinite) || duration < 60 || duration > 6 * 60 * 60 || start < 0 || end > duration + 1 || end <= start) {
		return false;
	}
	const length = end - start;
	return kind == "intro"
		// In the first 20 minutes, and between 5 seconds and 4 minutes long
		? end <= 20 * 60 && length >= 5 && length <= 240
		// In the second half, to the end, and at most 15 minutes long
		: start >= duration / 2 && end >= duration - 2 && length >= 5 && length <= 15 * 60;
}

export type Marked = "marked" | "unknown code" | "too many" | "implausible";

/** Keeps an account's mark of a video, replacing its earlier one */
export async function mark(ctx: Ctx, code: string, video: string, kind: Kind, start: number, end: number, duration: number, source: "marked" | "answered"): Promise<Marked> {
	if (!plausible(kind, start, end, duration)) {
		return "implausible";
	}
	const db = ctx.env.SYNC;
	ctx.budget.spend();
	const row = await db.prepare(`SELECT (SELECT count(*) FROM segments WHERE code = sync.code AND created > ?) AS today FROM sync WHERE code = ?`)
		.bind(Date.now() / 1000 - 24 * 60 * 60, code)
		.first<{today: number}>();
	if (row === null) {
		return "unknown code";
	}
	if (row.today >= MARKS_PER_DAY) {
		return "too many";
	}
	ctx.budget.spend();
	await db.batch([
		db.prepare(`INSERT OR REPLACE INTO segments (video, kind, code, start, "end", duration, source, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
			.bind(video, kind, code, start, end, duration, source, Date.now() / 1000),
		// A new mark replaces the account's view of the old one
		db.prepare("DELETE FROM segment_votes WHERE video = ? AND kind = ? AND code = ?").bind(video, kind, code),
	]);
	return "marked";
}

/** An account finding a video's intro or credits right, or wrong */
export async function vote(ctx: Ctx, code: string, video: string, kind: Kind, value: 1 | -1): Promise<boolean> {
	const db = ctx.env.SYNC;
	ctx.budget.spend();
	const found = await db.prepare("SELECT 1 AS found FROM sync WHERE code = ?").bind(code).first();
	if (found === null) {
		return false;
	}
	ctx.budget.spend();
	await db.prepare("INSERT OR REPLACE INTO segment_votes (video, kind, code, vote, created) VALUES (?, ?, ?, ?, ?)")
		.bind(video, kind, code, value, Date.now() / 1000)
		.run();
	return true;
}
