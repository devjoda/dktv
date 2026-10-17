// DR's whole catalogue: every series, film and programme on DR's list of everything from A to Å, kept in the database,
// so Vælg for mig, Alle titler, the search field, Hvad nu? and the front page's own rows have all of what DR has, and the
// same on every device and in each of Cloudflare's data centres, instead of what visits there happened to get.
//
// Its own cron goes through DR's list once a day, a page of it a run, and writes only what changed. Between those, it
// looks up each title's own item, a few a run, for what DR's list doesn't say: when a film leaves DR, who's in it, and a
// series' years, seasons and episodes, how long they are and where they're from. What the list didn't have any more is
// looked up first, and left out once DR says it's gone.
//
// What the browser gets of each title, its entry, is made from all of that by entryOf(), and kept with it, so
// /katalog.json is the entries put together by the database, without the Worker reading them.

import facetsFile from "../../drtvrss/facets.json";
import catalogueVersion from "./catalogue-version.json";
import {CATEGORY_LIST} from "./discover";
import {type Ctx, DRUnavailable, getApi, type Json, NotFound} from "./dr";
import * as dr from "./models";
import {thumbnail} from "./show";
import {clock, copenhagen, parseTime} from "./time";

// When the catalogue's own cron runs, apart from the notifications' every minute, as wrangler.jsonc says. Not exported
// from index.ts, whose every export Cloudflare takes to be something to run.
export const CRON = "*/2 * * * *";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// DR's page with its list of everything from A to Å, a row for each letter
const A_TO_Å = "/kategorier/a-aa";
// How much of DR's list a run gets at once, of the 100 it would give
const PAGE_SIZE = 50;
// A run does only one kind of work, since on Cloudflare, where each run starts afresh, even a little of each was more
// than a run's 10 ms: a step of the sweep, a few titles looked up, or some entries made. How many titles a run looks up
// at most, by the requests to DR it takes, each one, and a series' own item two, with its newest season; and how many
// entries it makes at most.
const LOOK_UPS_PER_RUN = 4;
const ENTRIES_PER_RUN = 25;
// The hour, in UTC, after which a day's sweep starts: after DR has put out the day's programmes, at 4
const SWEEP_FROM_HOUR = 5;
// How many requests to DR may fail in a sweep before it's given up on, until the next day, and how long DR isn't asked
// anything after it doesn't answer, or asks to be asked less
const SWEEP_ERRORS = 20;
const PAUSE_FOR = 30 * MINUTE;
// How much of a letter must be found again for what wasn't to be taken as maybe gone, instead of DR leaving some out
const KEPT_SHARE = 0.8;
// How long what DR doesn't have any more is kept, in case it comes back
const GONE_FOR = 30 * DAY;
// How many of DR's own rows' titles are read, of each row, and how many rows a run reads
const ROW_SIZE = 30;
const ROWS_PER_RUN = 2;
// How often the front page's own rows are made again
const ROWS_EVERY = 6 * HOUR;
// A far future, for the items that aren't looked up, like children's programmes, which aren't shown yet
const NEVER = 9e15;

export type Kind = "serie" | "film" | "dokumentar" | "program";

/** What's kept of a title from DR's list: what the catalogue needs of it, and nothing else */
export interface Item {
	id: string;
	type: "show" | "program";
	title: string;
	path: string;
	image?: string;
	description?: string;
	// In small letters, like ["fiktionsserie", "krimi", "dr1", "acc_spoken_subtitles"]
	categories: string[];
	// Like ["editorialptaxsub_krimi", "mood_nervepirrende", "thesaurus_2. verdenskrig"]
	keywords: string[];
	year?: number;
	// In seconds
	duration?: number;
	seasons?: number;
	availableFrom?: number;
	availableUntil?: number;
	// Like ["drtv", "ramasjang"]
	universes: string[];
	// Like "MRAM-15"
	rating?: string;
	// Like "DANMARK"
	country?: string;
	// Like ["StandardVideo", "SpokenSubtitles"]
	access: string[];
	ongoing?: boolean;
}

/** What a title's own item says, that DR's list doesn't */
export interface Details {
	// When it leaves DR
	expires?: number;
	// A series' first and last year, its seasons and episodes, how long its newest season's episodes are, in minutes,
	// when the newest of them came, and when the next one comes
	years?: [number, number];
	seasons?: number;
	episodes?: number;
	minutes?: number;
	latest?: number;
	next?: number;
	country?: string;
	access?: string[];
	// A film's actors and director, from the end of its description
	cast?: string[];
	directors?: string[];
}

/**
 * What the browser gets of a title, with short names, since there are thousands: its title, where it is here, its
 * kind, picture, year, length in minutes (a film's, or a series' episodes'), seasons, episodes, when it leaves DR,
 * when it came (0 for what was there when the catalogue began), a series' newest and next episodes, and its
 * filters' values, by facet, like {genre: ["krimi"], stemning: ["spaending"]}
 */
export interface Entry {
	id: string;
	t: string;
	u: string;
	k: Kind;
	i?: string;
	y?: number;
	m?: number;
	s?: number;
	e?: number;
	x?: number;
	n?: number;
	l?: number;
	w?: number;
	f: Record<string, string[]>;
}

const text = dr.text;
const defined = <T>(value: T | undefined): value is T => value !== undefined;

/** What's kept of one of the items on DR's list, or undefined for what isn't a series or a programme */
export function keptItem(blob: Json): Item | undefined {
	if (blob?.type != "show" && blob?.type != "program") {
		return undefined;
	}
	const id = typeof blob.id == "number" ? String(blob.id) : text(blob.id);
	const title = text(blob.title);
	const path = text(blob.path);
	if (!id || !title || !path) {
		return undefined;
	}
	const fields = blob.customFields ?? {};
	const ranges = Array.isArray(fields.OfferDateTimeRanges) ? fields.OfferDateTimeRanges : [];
	const until = ranges.map((r: Json) => parseTime(r?.To)).filter(defined);
	const item: Item = {
		id, type: blob.type, title, path,
		image: dr.wallpaper(blob),
		description: text(blob.shortDescription) || undefined,
		categories: dr.categories(blob),
		keywords: Array.isArray(blob.keywords) ? blob.keywords.filter((k: unknown) => typeof k == "string") : [],
		year: dr.integer(blob.releaseYear),
		duration: typeof blob.duration == "number" && blob.duration > 0 ? blob.duration : undefined,
		seasons: dr.integer(blob.availableSeasonCount),
		availableFrom: dr.availableFrom(blob),
		availableUntil: until.length ? Math.max(...until) : undefined,
		universes: Array.isArray(fields.ContentUniverses) ? fields.ContentUniverses.filter((u: unknown) => typeof u == "string").map((u: string) => u.toLowerCase()) : [],
		rating: text(fields.ClassificationRating),
		country: text(fields.ProductionCountry),
		access: (text(fields.AccessServicesOffered) ?? "").split(",").filter(Boolean),
		ongoing: fields.PresentationTypeCode == "Ongoing" || undefined,
	};
	// Without what isn't there, so the same item is always the same text
	return JSON.parse(JSON.stringify(item));
}

/** The names after a label at the start of a line of a description, like "Medvirkende: Sofie Torp, Thomas Hwan m.fl." */
export function namesAfter(description: string, labels: string[]): string[] {
	const match = new RegExp(`(?:^|\\n)\\s*(?:${labels.join("|")}):\\s*([^\\n]+)`).exec(description);
	if (match == null) {
		return [];
	}
	// Up to what's said after it on the same line, like ". Udløber: 13. nov 2026"
	const line = match[1].split(/\.\s+(?=\p{Lu}[\p{Ll}]+:)/u)[0]
		.replace(/\s*(?:m\.\s?fl|med flere)\.?\s*$/i, "")
		.replace(/[.\s]+$/, "");
	return [...new Set(line.split(/\s*,\s*|\s+og\s+/).map(name => name.trim())
		.filter(name => name.length > 1 && name.length <= 60 && /^\p{Lu}/u.test(name)))].slice(0, 10);
}

/** What a programme's own item says, like a film's */
export function programmeDetails(blob: Json): Details {
	const description = text(blob?.description) ?? "";
	return clean({
		expires: dr.availableUntil(blob),
		country: text(blob?.customFields?.ProductionCountry),
		access: accessOf([blob]),
		cast: namesAfter(description, ["Medvirkende"]),
		directors: namesAfter(description, ["Instruktion", "Instruktør", "Instrueret af"]),
	});
}

/** What a series' own item says, with all of its seasons, and what its newest season's own item says */
export function seriesDetails(show: Json, season: Json | undefined): Details {
	const seasons: Json[] = Array.isArray(show?.seasons?.items) ? show.seasons.items : [];
	const years = seasons.map(s => dr.integer(s?.releaseYear)).filter(defined);
	const episodeCount = seasons.reduce((n, s) => n + (dr.integer(s?.availableEpisodeCount) ?? dr.integer(s?.episodeCount) ?? 0), 0);
	const episodes: Json[] = Array.isArray(season?.episodes?.items) ? season.episodes.items : [];
	const lengths = episodes.map(e => typeof e?.duration == "number" && e.duration > 0 ? e.duration / 60 : dr.lengthInMinutes(e)).filter(defined).sort((a, b) => a - b);
	const published = episodes.map(e => dr.availableFrom(e)).filter(defined);
	const next = dr.integer(show?.nextEpisode?.availableUTC);
	return clean({
		expires: dr.availableUntil(show) ?? (season ? dr.availableUntil(season) : undefined),
		years: years.length ? [Math.min(...years), Math.max(...years)] as [number, number] : undefined,
		seasons: seasons.length || undefined,
		episodes: episodeCount || undefined,
		minutes: lengths.length ? Math.round(lengths[Math.floor(lengths.length / 2)]) : undefined,
		latest: published.length ? Math.max(...published) : undefined,
		next: next !== undefined ? next * 1000 : undefined,
		country: episodes.map(e => text(e?.customFields?.ProductionCountry)).find(Boolean),
		access: accessOf(episodes),
	});
}

function accessOf(blobs: Json[]): string[] | undefined {
	const found = new Set(blobs.flatMap(b => (text(b?.customFields?.AccessServicesOffered) ?? "").split(",").filter(Boolean)));
	return found.size ? [...found] : undefined;
}

/** Without what isn't there */
function clean<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length == 0))) as T;
}

// The facets, and which of them each of DR's words gives, like "sub:krimi" the genre krimi
interface FacetValue {
	id: string;
	label: string;
	from?: string[];
	otherCountries?: boolean;
}

interface Facet {
	id: string;
	label: string;
	open?: boolean;
	values?: FacetValue[];
}

const FACETS: Facet[] = facetsFile.facets;
const BY_WORD = new Map<string, [string, string][]>();
for (const facet of FACETS) {
	for (const value of facet.values ?? []) {
		for (const word of value.from ?? []) {
			BY_WORD.set(word, [...(BY_WORD.get(word) ?? []), [facet.id, value.id]]);
		}
	}
}
const NOT_SHOWN = new Set(facetsFile.notShown);
const KIDS = new Set(facetsFile.kidsUniverses);
const NOT_TOPICS = new Set(facetsFile.notTopics);
const NOT_PEOPLE = new Set(facetsFile.notPeople as string[]);
const NOT_COUNTRIES = new Set(facetsFile.notCountries);
const NAMES: Record<string, string> = facetsFile.names;
const KNOWN_COUNTRIES = new Set(FACETS.find(f => f.id == "land")!.values!.flatMap(v => v.from ?? []).map(w => w.slice("country:".length)));

/** The facets' names and their values' labels, for the browser, which gets them with the catalogue */
export const FACET_LABELS = FACETS.map(f => ({id: f.id, label: f.label, ...(f.open ? {open: true} : {}),
	...(f.values ? {values: f.values.map(v => ({id: v.id, label: v.label}))} : {})}));

// DR's keywords that say what something is, by their prefix, and the facets' own words for them
const PREFIXES: Record<string, string> = {
	editorialptaxtop: "top", editorialptaxsub: "sub", mood: "mood", culturalorigin: "origin", agetargetgroup: "age",
};

const letters = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");

/** DR's words for a title, like ["cat:krimi", "sub:thriller/krimi", "mood:nervepirrende", "country:SVERIGE"] */
export function wordsOf(item: Item, details?: Details): string[] {
	const found = new Set<string>();
	for (const category of item.categories) {
		found.add(category.startsWith("acc_") ? "acc:" + letters(category.slice(4)) : "cat:" + category);
	}
	for (const keyword of item.keywords) {
		const at = keyword.indexOf("_");
		const prefix = PREFIXES[keyword.slice(0, at)];
		if (at > 0 && prefix) {
			found.add(`${prefix}:${keyword.slice(at + 1).toLowerCase()}`);
		}
	}
	for (const access of [...item.access, ...(details?.access ?? [])]) {
		found.add("acc:" + letters(access));
	}
	const country = details?.country ?? item.country;
	if (country) {
		found.add("country:" + country);
	}
	if (item.rating) {
		found.add("rating:" + item.rating.replace(/^MRAM-/i, "").toLowerCase());
	}
	return [...found];
}

/** What kind a title is, or undefined for what isn't shown, like news and sport */
export function kindOf(item: Item, words: string[]): Kind | undefined {
	const has = (...wanted: string[]) => wanted.some(w => words.includes(w));
	if (words.some(w => NOT_SHOWN.has(w))) {
		return undefined;
	}
	if (has("cat:dokumentar", "top:dokumentar", "sub:dokumentar")) {
		return "dokumentar";
	}
	if (item.type == "show") {
		return has("cat:fiktionsserie", "top:serier", "sub:serier") ? "serie" : "program";
	}
	return has("cat:film", "top:film", "sub:film") ? "film" : "program";
}

const SMALL_WORDS = new Set(["af", "og", "von", "van", "de", "der", "den", "la", "le", "du", "di", "da", "el", "al", "bin", "ibn"]);

/** A name as it's written, like "Margrethe II, Dronning, Danmark" for DR's "margrethe ii, dronning, danmark" */
export function properName(name: string): string {
	const known = NAMES[name];
	if (known) {
		return known;
	}
	let first = true;
	return name.replace(/[\p{L}'.]+/gu, word => {
		const wasFirst = first;
		first = false;
		if (/^(i{1,3}|iv|vi{0,3}|ix|x{1,2})$/.test(word)) {
			return word.toUpperCase();
		}
		if (!wasFirst && SMALL_WORDS.has(word)) {
			return word;
		}
		return word.charAt(0).toUpperCase() + word.slice(1);
	});
}

const keywordsOf = (item: Item, prefixes: string[]) => item.keywords
	.filter(k => prefixes.some(p => k.startsWith(p + "_")))
	.map(k => k.slice(k.indexOf("_") + 1).trim())
	.filter(value => value && !/^test/i.test(value));

function decade(year: number): string {
	return year < 1960 ? "aeldre" : String(Math.min(Math.floor(year / 10) * 10, 2020));
}

function length(minutes: number): string {
	return minutes <= 30 ? "kort" : minutes <= 60 ? "time" : minutes <= 90 ? "aften" : "lang";
}

/** What's made of a title for the browser, with what's needed to find it in the database */
export interface Made {
	entry: Entry;
	kind?: Kind;
	kids: boolean;
	expires?: number;
	added?: number;
}

/** A title's entry, from what's kept of it: DR's list's item, its own item's details, DR's rows it's on, and when it was first seen */
export function entryOf(item: Item, details: Details | undefined, rows: string[] | undefined, firstSeen: number): Made {
	const words = wordsOf(item, details);
	const kind = kindOf(item, words);
	const slug = item.path.replace(/\/+$/, "").split("/").at(-1)!;
	const f: Record<string, string[]> = {};
	const add = (facet: string, value: string) => {
		const values = f[facet] ??= [];
		if (!values.includes(value)) {
			values.push(value);
		}
	};
	if (kind) {
		add("type", kind);
	}
	for (const word of words) {
		for (const [facet, value] of BY_WORD.get(word) ?? []) {
			add(facet, value);
		}
	}
	const country = details?.country ?? item.country;
	if (country && !NOT_COUNTRIES.has(country) && !KNOWN_COUNTRIES.has(country)) {
		add("land", "verden");
	}
	for (const topic of keywordsOf(item, ["thesaurus", "controlled"]).map(t => t.toLowerCase())) {
		if (!NOT_TOPICS.has(topic) && (f.emne?.length ?? 0) < 8) {
			add("emne", topic);
		}
	}
	const people = [...keywordsOf(item, ["person", "franchise"]).map(properName), ...(details?.cast ?? []), ...(details?.directors ?? [])];
	for (const person of people) {
		if (!NOT_PEOPLE.has(person) && (f.person?.length ?? 0) < 12) {
			add("person", person);
		}
	}
	const year = details?.years?.[0] ?? item.year;
	if (year) {
		add("aarti", decade(year));
	}
	const minutes = item.type == "program" && item.duration ? Math.round(item.duration / 60) : details?.minutes;
	if (minutes) {
		add("tid", length(minutes));
	}
	const seasons = item.seasons ?? details?.seasons;
	if (item.type == "show" && seasons) {
		add("omfang", seasons == 1 ? "en" : seasons <= 4 ? "flere" : "mange");
	}
	for (const row of rows ?? []) {
		add("udvalgt", row);
	}
	const expires = details?.expires ?? item.availableUntil;
	// When it came: when it was first seen, which for what was there from the start is 0, or a programme when DR says it did
	const added = Math.max(item.type == "program" ? item.availableFrom ?? 0 : 0, firstSeen);
	const entry: Entry = clean({
		id: item.id,
		t: item.title,
		u: item.type == "show" ? `/${slug}/` : `/program/${slug}`,
		k: kind ?? "program",
		i: thumbnail(item.image),
		y: year,
		m: minutes,
		s: item.type == "show" ? seasons : undefined,
		e: details?.episodes,
		x: expires,
		n: added,
		l: details?.latest,
		w: details?.next,
		f,
	});
	return {entry, kind, kids: item.universes.some(u => KIDS.has(u)), expires, added};
}

// The catalogue's cron

/** Where a sweep of DR's list is, which a run goes on with */
interface Sweep {
	started: number;
	// Whether it's the first, whose titles were all there when the catalogue began
	first: boolean;
	errors: number;
	// The rows of DR's list from A to Å, each a letter, with its list and the parameter that gives the letter
	letters?: {title: string; list: string; param: string}[];
	letter: number;
	page: number;
	// How many titles the letter had before, and whether all of its pages were got, for the next run to note what wasn't
	// on any of them
	before?: number;
	finishing?: boolean;
	// After the letters, DR's own rows, on its front page and its categories' pages, whose titles are noted: the pages,
	// the rows on them, by name and list, and the titles on those
	pages?: string[];
	at: number;
	rows: [title: string, list: string][];
	row: number;
	featured: Record<string, string[]>;
}

/** How the last sweep went */
interface Last {
	started: number;
	finished: number;
	titles?: number;
	error?: string;
}

/** A title the catalogue looks up, and what's kept of it */
interface Due {
	id: string;
	item: string;
	missing_since: number | null;
}

async function getKey<T>(ctx: Ctx, key: string): Promise<T | undefined> {
	ctx.budget.spend();
	const row = await ctx.env.SYNC.prepare("SELECT value FROM catalogue WHERE key = ?").bind(key).first<{value: string}>();
	return row ? JSON.parse(row.value) : undefined;
}

function setKey(ctx: Ctx, key: string, value: unknown): D1PreparedStatement {
	return ctx.env.SYNC.prepare("INSERT INTO catalogue (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(key, JSON.stringify(value));
}

/** Whether a new day's sweep is due: once a day, from 5 in the morning, UTC */
export function sweepDue(last: Last | undefined, now: number): boolean {
	if (last === undefined) {
		return true;
	}
	const today = new Date(now);
	const from = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), SWEEP_FROM_HOUR);
	return now >= from ? last.started < from : last.started < from - DAY;
}

/** The rows of DR's list from A to Å: one for each letter, and the numbers */
async function getLetters(ctx: Ctx): Promise<Sweep["letters"]> {
	const page = await getApi(ctx, "/page", {path: A_TO_Å, list_page_size: 1, max_list_prefetch: 0});
	const found: NonNullable<Sweep["letters"]> = [];
	for (const entry of Array.isArray(page?.entries) ? page.entries : []) {
		const list = entry?.list;
		const title = (text(entry?.title) ?? "").trim();
		const param = text(list?.parameter);
		if (list?.id != null && param?.startsWith("TitleGroupKey:") && title && !found.some(l => l.title == title)) {
			found.push({title, list: String(list.id), param});
		}
	}
	if (found.length == 0) {
		throw new dr.FormatError(`DR's page ${A_TO_Å} has no letters`);
	}
	return found;
}

/** A page of DR's whose rows of programmes are noted, by their names: those chosen by DR's editors */
function addRows(sweep: Sweep, page: Json) {
	for (const entry of Array.isArray(page?.entries) ? page.entries : []) {
		const template = text(entry?.template) ?? "";
		const title = (text(entry?.title) ?? "").trim();
		const list = entry?.list?.id != null ? String(entry.list.id) : undefined;
		// Not the rows of everything from A to Å, which aren't chosen by anyone
		if (list && /^[PT]/.test(template) && !template.startsWith("TX") && title.length > 1 && !/\bA\s*-\s*Å\b/i.test(title)
			&& !sweep.rows.some(([, other]) => other == list)) {
			sweep.rows.push([title, list]);
		}
	}
}

/** What's kept of a title from DR's list, for the database */
function toRow(item: Item) {
	const kept = JSON.stringify(item);
	const shown = !item.universes.some(u => KIDS.has(u)) && kindOf(item, wordsOf(item)) !== undefined;
	// Children's programmes, news and sport aren't shown yet, so they're only looked up to see whether they're gone
	return {id: item.id, item: kept, due: shown ? 0 : NEVER};
}

/** One step of a sweep: how many requests to DR it took, and whether the sweep is done */
async function sweepStep(ctx: Ctx, sweep: Sweep, now: number): Promise<{requests: number; done: boolean}> {
	const db = ctx.env.SYNC;
	const step = (requests: number) => ({requests, done: false});
	if (sweep.letters === undefined) {
		sweep.letters = await getLetters(ctx);
		return step(1);
	}
	if (sweep.finishing) {
		await finishLetter(ctx, sweep.letters[sweep.letter].title, sweep.before ?? 0, now);
		sweep.finishing = false;
		sweep.letter++;
		sweep.page = 1;
		return step(0);
	}
	if (sweep.letter < sweep.letters.length) {
		const letter = sweep.letters[sweep.letter];
		let blob: Json;
		try {
			blob = await getApi(ctx, `/lists/${letter.list}`, {page_size: PAGE_SIZE, page: sweep.page, param: letter.param});
		} catch (e) {
			if (!(e instanceof NotFound)) {
				throw e;
			}
			// Left as it was, until the next sweep, since DR doesn't say what it has of the letter
			console.log("DR has no list of", letter.title, String(e));
			sweep.letter++;
			sweep.page = 1;
			return step(1);
		}
		const items = (Array.isArray(blob?.items) ? blob.items : []).map(keptItem).filter(defined);
		const pages = dr.integer(blob?.paging?.total) ?? 1;
		// What's new or changed is written, and the page's ids noted, for what's on none of them. What was missing is looked
		// up first, and shown again once its own item says DR has it.
		const statements = [
			// The database tells what changed, by the kept item's text, which costs a run nothing; hash is left empty
			db.prepare(`INSERT INTO titles (id, letter, item, hash, first_seen, details_due, stale)
				SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.item'), '', ?, json_extract(value, '$.due'), 1
				FROM json_each(?) WHERE true
				ON CONFLICT (id) DO UPDATE SET letter = excluded.letter, item = excluded.item, stale = 1,
					details_due = CASE WHEN titles.missing_since IS NOT NULL THEN -1
						WHEN titles.item != excluded.item THEN min(titles.details_due, excluded.details_due) ELSE titles.details_due END
				WHERE titles.item != excluded.item OR titles.letter != excluded.letter OR titles.missing_since IS NOT NULL`)
				.bind(letter.title, sweep.first ? 0 : now, JSON.stringify(items.map(toRow))),
			db.prepare("INSERT OR REPLACE INTO catalogue_pages (letter, page, ids) VALUES (?, ?, ?)").bind(letter.title, sweep.page, JSON.stringify(items.map((i: Item) => i.id))),
		];
		if (sweep.page == 1) {
			// Before the first page is written
			statements.unshift(db.prepare("SELECT count(*) AS n FROM titles WHERE letter = ? AND missing_since IS NULL").bind(letter.title));
		}
		ctx.budget.spend(statements.length);
		const results = await db.batch<Json>(statements);
		if (sweep.page == 1) {
			sweep.before = Number(results[0].results[0]?.n ?? 0);
		}
		if (sweep.page < pages) {
			sweep.page++;
		} else {
			sweep.finishing = true;
		}
		return step(1);
	}
	if (sweep.pages === undefined) {
		const categories = await getApi(ctx, `/lists/${CATEGORY_LIST}`, {page_size: 50});
		sweep.pages = ["/", ...(Array.isArray(categories?.items) ? categories.items : [])
			.map((i: Json) => text(i?.path) ?? "")
			.filter((path: string) => path.startsWith("/kategorier/") && path != A_TO_Å && !/nyheder|sport/.test(path))];
		return step(1);
	}
	if (sweep.at < sweep.pages.length) {
		const path = sweep.pages[sweep.at];
		try {
			addRows(sweep, await getApi(ctx, "/page", {path, list_page_size: 1, max_list_prefetch: 0}));
		} catch (e) {
			if (!(e instanceof NotFound)) {
				throw e;
			}
		}
		sweep.at++;
		return step(1);
	}
	let spent = 0;
	while (sweep.row < sweep.rows.length && spent < ROWS_PER_RUN) {
		const [title, list] = sweep.rows[sweep.row];
		spent++;
		let blob: Json;
		try {
			blob = await getApi(ctx, `/lists/${list}`, {page_size: ROW_SIZE});
		} catch (e) {
			if (!(e instanceof NotFound)) {
				throw e;
			}
			blob = undefined;
		}
		sweep.row++;
		for (const item of Array.isArray(blob?.items) ? blob.items : []) {
			const id = ["season", "episode"].includes(item?.type) ? item?.showId : ["show", "program"].includes(item?.type) ? item?.id : undefined;
			if (id != null) {
				const titles = sweep.featured[String(id)] ??= [];
				if (!titles.includes(title)) {
					titles.push(title);
				}
			}
		}
	}
	return {requests: spent, done: spent == 0};
}

/** Notes what of a letter wasn't on any of its pages, unless DR's list had far fewer of it than it had before */
async function finishLetter(ctx: Ctx, letter: string, before: number, now: number) {
	const db = ctx.env.SYNC;
	ctx.budget.spend();
	const pages = await db.prepare("SELECT ids FROM catalogue_pages WHERE letter = ?").bind(letter).all<{ids: string}>();
	const found = new Set<string>(pages.results.flatMap(page => JSON.parse(page.ids)));
	const statements = [db.prepare("DELETE FROM catalogue_pages WHERE letter = ?").bind(letter)];
	if (found.size >= before * KEPT_SHARE) {
		// Looked up first, to see whether they're gone, or only moved to another page while the letter was read
		statements.push(db.prepare(`UPDATE titles SET missing_since = ?, details_due = -1
			WHERE letter = ? AND missing_since IS NULL AND id NOT IN (SELECT value FROM json_each(?))`)
			.bind(now, letter, JSON.stringify([...found])));
	} else {
		console.log("DR's list of", letter, "had", found.size, "titles, of", before, "before, so none are taken to be gone");
	}
	ctx.budget.spend(statements.length);
	await db.batch(statements);
}

/** Notes which of DR's own rows each title is on, and forgets what's been gone long */
async function finishSweep(ctx: Ctx, sweep: Sweep, now: number) {
	const db = ctx.env.SYNC;
	const featured = JSON.stringify(sweep.featured);
	const statements = [
		// Only those whose rows changed, which the database writes the same way as JSON.stringify
		db.prepare(`UPDATE titles SET rows = j.value, stale = 1 FROM json_each(?) AS j
			WHERE titles.id = j.key AND titles.rows IS NOT j.value`).bind(featured),
		db.prepare("UPDATE titles SET rows = NULL, stale = 1 WHERE rows IS NOT NULL AND id NOT IN (SELECT key FROM json_each(?))").bind(featured),
		db.prepare("DELETE FROM titles WHERE missing_since < ?").bind(now - GONE_FOR),
	];
	ctx.budget.spend(statements.length + 1);
	await db.batch(statements);
	const count = await db.prepare("SELECT count(*) AS n FROM titles WHERE entry IS NOT NULL AND kids = 0 AND missing_since IS NULL").first<{n: number}>();
	ctx.budget.spend(3);
	await db.batch([
		setKey(ctx, "last", {started: sweep.started, finished: now, titles: count?.n ?? 0} satisfies Last),
		db.prepare("DELETE FROM catalogue WHERE key = 'sweep'"),
		// The front page's own rows are made again, from what the sweep found
		db.prepare("DELETE FROM catalogue WHERE key = 'rows_built'"),
	]);
}

/** When a title is looked up again: daily near its end, since DR sometimes lets it stay, often while a series is running */
function nextLookUp(item: Item, details: Details, now: number): number {
	const spread = Math.random() * DAY;
	if (details.expires !== undefined && details.expires - now < 8 * DAY) {
		return Math.min(now + DAY, Math.max(now + HOUR, details.expires + HOUR));
	}
	if (item.type == "show" && (details.next !== undefined || item.ongoing)) {
		return now + 3 * DAY + spread;
	}
	return now + 14 * DAY + spread;
}

/** Looks up a few titles' own items, those that might be gone first: how many, and whether DR answered them */
async function lookUp(ctx: Ctx, work: number, now: number): Promise<{looked: number; answered: boolean}> {
	const db = ctx.env.SYNC;
	ctx.budget.spend();
	const due = await db.prepare("SELECT id, item, missing_since FROM titles WHERE details_due <= ? ORDER BY details_due LIMIT ?")
		.bind(now, work).all<Due>();
	const statements: D1PreparedStatement[] = [];
	let spent = 0;
	let answered = true;
	for (const row of due.results) {
		const item: Item = JSON.parse(row.item);
		const cost = item.type == "show" ? 2 : 1;
		if (spent + cost > work || ctx.budget.left < 10) {
			break;
		}
		spent += cost;
		try {
			let details: Details;
			if (item.type == "show") {
				const show = await getApi(ctx, `/items/${item.id}`, {expand: "all"});
				const newest = Array.isArray(show?.seasons?.items) ? show.seasons.items.at(-1) : undefined;
				const season = newest?.id != null ? await getApi(ctx, `/items/${newest.id}`, {expand: "all"}).catch(e => {
					if (e instanceof NotFound) {
						return undefined;
					}
					throw e;
				}) : undefined;
				details = seriesDetails(show, season);
			} else {
				details = programmeDetails(await getApi(ctx, `/items/${item.id}`));
			}
			statements.push(db.prepare("UPDATE titles SET details = ?, details_due = ?, missing_since = NULL, stale = 1 WHERE id = ?")
				.bind(JSON.stringify(details), nextLookUp(item, details, now), item.id));
		} catch (e) {
			if (e instanceof NotFound) {
				// Gone: left out, and asked about again in a week, in case DR only lost it for a while
				statements.push(db.prepare("UPDATE titles SET missing_since = coalesce(missing_since, ?), details_due = ?, stale = 1 WHERE id = ?")
					.bind(now, now + 7 * DAY, item.id));
			} else if (e instanceof DRUnavailable || e instanceof dr.FormatError) {
				console.log("Could not look up", item.id, String(e));
				statements.push(db.prepare("UPDATE titles SET details_due = ? WHERE id = ?").bind(now + HOUR, item.id));
				// Not the rest either, when DR doesn't answer, or asks to be asked less
				if (e instanceof DRUnavailable) {
					answered = false;
					break;
				}
			} else {
				throw e;
			}
		}
	}
	if (statements.length) {
		ctx.budget.spend();
		await db.batch(statements);
	}
	return {looked: statements.length, answered};
}

/** Makes the entries of titles whose kept parts changed, and whether any were */
export async function makeEntries(ctx: Ctx, now: number): Promise<boolean> {
	const db = ctx.env.SYNC;
	ctx.budget.spend();
	const stale = await db.prepare("SELECT id, item, details, rows, first_seen FROM titles WHERE stale = 1 LIMIT ?").bind(ENTRIES_PER_RUN)
		.all<{id: string; item: string; details: string | null; rows: string | null; first_seen: number}>();
	if (stale.results.length == 0) {
		return false;
	}
	const made = stale.results.map(row => {
		const {entry, kind, kids, expires, added} = entryOf(JSON.parse(row.item), row.details ? JSON.parse(row.details) : undefined,
			row.rows ? JSON.parse(row.rows) : undefined, row.first_seen);
		return {id: row.id, entry: kind ? JSON.stringify(entry) : null, kind: kind ?? null, kids: kids ? 1 : 0, expires: expires ?? null, added: added ?? null};
	});
	ctx.budget.spend(2);
	await db.batch([
		db.prepare(`UPDATE titles SET entry = json_extract(j.value, '$.entry'), kind = json_extract(j.value, '$.kind'),
			kids = json_extract(j.value, '$.kids'), expires = json_extract(j.value, '$.expires'), added = json_extract(j.value, '$.added'), stale = 0
			FROM json_each(?) AS j WHERE titles.id = json_extract(j.value, '$.id')`).bind(JSON.stringify(made)),
		setKey(ctx, "version", now),
	]);
	return true;
}

/** After an update that makes entries differently, all of them are made again, a few at a time */
async function upgradeEntries(ctx: Ctx, made: string | undefined) {
	if (made == catalogueVersion.version) {
		return;
	}
	const db = ctx.env.SYNC;
	ctx.budget.spend(2);
	await db.batch([
		db.prepare("UPDATE titles SET stale = 1 WHERE stale = 0"),
		setKey(ctx, "entries", catalogueVersion.version),
	]);
}

/** What the cron keeps besides the titles, by name */
async function getState(ctx: Ctx): Promise<{entries?: string; last?: Last; sweep?: Sweep; rows?: {built: number}; paused?: number}> {
	ctx.budget.spend();
	const found = await ctx.env.SYNC.prepare("SELECT key, value FROM catalogue WHERE key IN ('entries', 'last', 'sweep', 'rows_built', 'paused')").all<{key: string; value: string}>();
	const state = Object.fromEntries(found.results.map(r => [r.key, JSON.parse(r.value)]));
	return {entries: state.entries, last: state.last, sweep: state.sweep, rows: state.rows_built, paused: state.paused};
}

/** DR isn't asked anything for a while, after it didn't answer, or asked to be asked less */
async function pause(ctx: Ctx, now: number) {
	console.log("The catalogue doesn't ask DR anything for", PAUSE_FOR / MINUTE, "minutes");
	ctx.budget.spend();
	await setKey(ctx, "paused", now + PAUSE_FOR).run();
}

/** A step of the day's sweep, if one is going on or due: whether there was one, and whether DR answered */
async function sweepRun(ctx: Ctx, state: Awaited<ReturnType<typeof getState>>, now: number): Promise<{swept: boolean; answered: boolean}> {
	const db = ctx.env.SYNC;
	let sweep = state.sweep;
	if (sweep === undefined && sweepDue(state.last, now)) {
		sweep = {started: now, first: state.last === undefined, errors: 0, letter: 0, page: 1, at: 0, rows: [], row: 0, featured: {}};
	}
	if (sweep === undefined) {
		return {swept: false, answered: true};
	}
	let answered = true;
	try {
		if ((await sweepStep(ctx, sweep, now)).done) {
			await finishSweep(ctx, sweep, now);
			return {swept: true, answered};
		}
	} catch (e) {
		if (!(e instanceof DRUnavailable || e instanceof NotFound || e instanceof dr.FormatError)) {
			throw e;
		}
		console.log("The catalogue's sweep failed at a step", String(e));
		sweep.errors++;
		answered = !(e instanceof DRUnavailable);
	}
	ctx.budget.spend();
	if (sweep.errors > SWEEP_ERRORS) {
		console.log("The catalogue's sweep is given up on until tomorrow");
		await db.batch([
			setKey(ctx, "last", {started: sweep.started, finished: now, error: "Too many errors"} satisfies Last),
			db.prepare("DELETE FROM catalogue WHERE key = 'sweep'"),
		]);
	} else {
		await setKey(ctx, "sweep", sweep).run();
	}
	return {swept: true, answered};
}

/**
 * Every other minute, one kind of work, the first of them that has any, and of the others in another order the next
 * time: a step of the day's sweep of DR's list, a few titles looked up, or their entries made; or, every few hours, the
 * front page's own rows. What a run doesn't do, the next does. Which it was is in the log, with what it cost.
 */
export async function run(ctx: Ctx): Promise<void> {
	const now = clock.now();
	const state = await getState(ctx);
	// Once there's a catalogue to make them from
	if (state.last !== undefined && (state.rows === undefined || now - state.rows.built > ROWS_EVERY)) {
		await buildRows(ctx, now);
		console.log("The catalogue's run: rows");
		return;
	}
	await upgradeEntries(ctx, state.entries);
	// While DR isn't asked anything, only entries
	const asking = state.paused === undefined || now >= state.paused;
	const work = Math.floor(now / (2 * MINUTE)) % 2 == 0 ? ["sweep", "look up", "entries"] : ["entries", "look up", "sweep"];
	for (const kind of work) {
		let done = false;
		let answered = true;
		if (kind == "sweep" && asking) {
			({swept: done, answered} = await sweepRun(ctx, state, now));
		} else if (kind == "look up" && asking) {
			const found = await lookUp(ctx, LOOK_UPS_PER_RUN, now);
			done = found.looked > 0;
			answered = found.answered;
		} else if (kind == "entries") {
			done = await makeEntries(ctx, now);
		}
		if (!answered) {
			await pause(ctx, now);
		}
		if (done) {
			console.log("The catalogue's run:", kind);
			return;
		}
	}
}

// The catalogue for the browser

// What's shown: not children's programmes, which have their own place later, and not what's gone or has left DR
const SHOWN = "entry IS NOT NULL AND kids = 0 AND missing_since IS NULL AND (expires IS NULL OR expires > ?)";

const FACETS_JSON = JSON.stringify(FACET_LABELS);

// How many titles the catalogue has, at least, once its first sweep is well under way
export const ALMOST_WHOLE = 1000;

/** The catalogue as the browser gets it, as JSON text, made by the database, with its version and how many titles it has */
export async function catalogueText(ctx: Ctx): Promise<{text: string; version: number; count: number}> {
	const db = ctx.env.SYNC;
	ctx.budget.spend(2);
	const [version, letters] = await db.batch<Json>([
		db.prepare("SELECT value FROM catalogue WHERE key = 'version'"),
		// A letter at a time, since what the database gives at once may be at most 2 MB
		db.prepare(`SELECT group_concat(entry, ',') AS entries, count(*) AS n FROM titles WHERE ${SHOWN} GROUP BY letter`).bind(clock.now()),
	]);
	const v = Number(version.results[0]?.value ?? 0);
	const titles = letters.results.map((r: Json) => r.entries).filter(Boolean).join(",");
	const count = letters.results.reduce((n: number, r: Json) => n + Number(r.n ?? 0), 0);
	return {text: `{"version":${v},"facets":${FACETS_JSON},"titles":[${titles}]}`, version: v, count};
}

/** How the catalogue is doing, for /status.json */
export async function status(ctx: Ctx): Promise<Json> {
	const db = ctx.env.SYNC;
	const now = clock.now();
	ctx.budget.spend(4);
	const [state, shown, due] = await db.batch<Json>([
		db.prepare("SELECT key, value FROM catalogue WHERE key IN ('last', 'sweep', 'version', 'rows_built', 'paused')"),
		db.prepare(`SELECT count(*) AS n FROM titles WHERE ${SHOWN}`).bind(now),
		db.prepare("SELECT count(*) AS n FROM titles WHERE details_due <= ?").bind(now),
	]);
	const kept = Object.fromEntries(state.results.map((r: Json) => [r.key, JSON.parse(r.value)]));
	const sweep: Sweep | undefined = kept.sweep;
	return {
		titles: shown.results[0]?.n ?? 0,
		waitingToBeLookedUp: due.results[0]?.n ?? 0,
		version: kept.version ?? 0,
		lastSweep: kept.last ?? null,
		sweep: sweep ? {started: sweep.started, letter: sweep.letters?.[sweep.letter]?.title ?? null, letters: sweep.letters?.length ?? null,
			rows: sweep.pages ? `${sweep.row} af ${sweep.rows.length}` : null, errors: sweep.errors} : null,
		rowsBuilt: kept.rows_built?.built ?? null,
		pausedUntil: kept.paused > now ? kept.paused : null,
	};
}

/** Marks a title that DR said wasn't there, as a visit to its page found, for the cron to look up first */
export function noteGone(ctx: Ctx, id: string) {
	if (ctx.budget.left < 2) {
		return;
	}
	ctx.budget.spend();
	ctx.waitUntil(ctx.env.SYNC.prepare("UPDATE titles SET details_due = -1 WHERE id = ? AND details_due > 0").bind(id).run()
		.catch(e => console.log("Could not note that", id, "is gone", String(e))));
}

// The front page's own rows, made from the catalogue every few hours

export interface OwnRow {
	id: string;
	title: string;
	// Alle titler, with the row's filter
	more: string;
	entries: Entry[];
}

// The moods the front page has a row of, one a day, and what the row is called
const MOOD_ROWS: [string, string][] = [
	["spaending", "Nervepirrende serier og film"],
	["foelelser", "Store følelser"],
	["sjovt", "Noget at grine af"],
	["hygge", "Hyggelige serier og film"],
	["moerkt", "Mørkt og råt"],
	["klogt", "Tankevækkende"],
];
// How many titles a row has at most, and at least, to be worth a row
const OWN_ROW_SIZE = 24;
const OWN_ROW_LEAST = 4;
// How many titles a topic needs to be a day's theme
const THEME_LEAST = 8;

/** A day's number, for what changes once a day */
function dayNumber(now: number): number {
	const d = copenhagen(now);
	return Math.floor(Date.UTC(d.year, d.month, d.day) / DAY);
}

// A day's order of its own, at random, with those on DR's own rows first, as the database sorts them
const OF_THE_DAY = "ORDER BY titles.rows IS NULL, (CAST(titles.id AS INTEGER) * ?) % 1000003 LIMIT ?";

const encode = encodeURIComponent;

/** The front page's own rows: what leaves DR soon, new films, a mood, a theme and something short, from the catalogue */
export async function buildRows(ctx: Ctx, now: number): Promise<OwnRow[]> {
	const db = ctx.env.SYNC;
	const day = dayNumber(now);
	const [mood, moodTitle] = MOOD_ROWS[day % MOOD_ROWS.length];
	const seed = day % 1000 + 7919;
	ctx.budget.spend(5);
	const parse = (rows: Json[]) => rows.map(r => JSON.parse(r.entry) as Entry);
	const [leaving, films, moods, short, topics] = await db.batch<Json>([
		db.prepare(`SELECT entry FROM titles WHERE ${SHOWN} AND expires < ? ORDER BY expires LIMIT ?`).bind(now + 12 * HOUR, now + 14 * DAY, OWN_ROW_SIZE),
		db.prepare(`SELECT entry FROM titles WHERE ${SHOWN} AND kind = 'film' AND added > ? ORDER BY added DESC LIMIT ?`).bind(now, now - 90 * DAY, OWN_ROW_SIZE),
		db.prepare(`SELECT entry FROM titles, json_each(titles.entry, '$.f.stemning') AS j WHERE ${SHOWN} AND j.value = ? ${OF_THE_DAY}`)
			.bind(now, mood, seed, OWN_ROW_SIZE),
		db.prepare(`SELECT entry FROM titles WHERE ${SHOWN} AND kind != 'film' AND json_extract(entry, '$.m') BETWEEN 5 AND 30 ${OF_THE_DAY}`)
			.bind(now, seed, OWN_ROW_SIZE),
		db.prepare(`SELECT j.value AS topic, count(*) AS n FROM titles, json_each(titles.entry, '$.f.emne') AS j WHERE ${SHOWN}
			GROUP BY j.value HAVING n >= ? ORDER BY n DESC LIMIT 60`).bind(now, THEME_LEAST),
	]);
	const rows: OwnRow[] = [
		{id: "sidste-chance", title: "Sidste chance", more: "/alle/?aktuelt=sidste-chance&sorter=udloeber", entries: parse(leaving.results)},
		{id: "nye-film", title: "Nye film", more: "/alle/?type=film&sorter=nyeste", entries: parse(films.results)},
		{id: "stemning", title: moodTitle, more: `/alle/?stemning=${mood}`, entries: parse(moods.results)},
		{id: "kort", title: "Kort tid? Under en halv time", more: "/alle/?tid=kort", entries: parse(short.results)},
	];
	const themes: string[] = topics.results.map((r: Json) => r.topic);
	// Christmas in December, and otherwise one a day
	const december = copenhagen(now).month == 11;
	const theme = december && themes.includes("jul") ? "jul" : themes.length ? themes[day % themes.length] : undefined;
	if (theme !== undefined) {
		ctx.budget.spend();
		const found = await db.prepare(`SELECT entry FROM titles, json_each(titles.entry, '$.f.emne') AS j WHERE ${SHOWN} AND j.value = ? ${OF_THE_DAY}`)
			.bind(now, theme, seed, OWN_ROW_SIZE).all<Json>();
		rows.splice(3, 0, {id: "tema", title: `Tema: ${theme.charAt(0).toUpperCase()}${theme.slice(1)}`, more: `/alle/?emne=${encode(theme)}`,
			entries: parse(found.results)});
	}
	const worth = rows.filter(row => row.entries.length >= OWN_ROW_LEAST);
	ctx.budget.spend(2);
	await db.batch([setKey(ctx, "rows", {built: now, rows: worth}), setKey(ctx, "rows_built", {built: now})]);
	return worth;
}

/** The front page's own rows, as the cron last made them */
export async function getOwnRows(ctx: Ctx): Promise<OwnRow[]> {
	const kept = await getKey<{rows: OwnRow[]}>(ctx, "rows");
	return kept?.rows ?? [];
}
