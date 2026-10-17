// What the catalogue keeps of DR's titles, from DR's list and from each title's own item, and what the browser gets of
// each, its entry: its kind, what it's like, and its filters' values, by drtvrss/facets.json.
//
// The catalogue's cron makes all of the entries again after an update that changes this file, models.ts, show.ts or the
// filters (scripts/build.mjs), and not after one that only changes the cron, in catalogue.ts.

import facetsFile from "../../drtvrss/facets.json";
import {type Json} from "./dr";
import * as dr from "./models";
import {thumbnail} from "./show";
import {parseTime} from "./time";
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
export const defined = <T>(value: T | undefined): value is T => value !== undefined;

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

/** Whether a title is one of DR's children's, which aren't shown yet */
export function forKids(item: Item): boolean {
	return item.universes.some(u => KIDS.has(u));
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
	return {entry, kind, kids: forKids(item), expires, added};
}
