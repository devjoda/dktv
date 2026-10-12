// Times, as they are in Denmark, and written the Danish way.
// Times are kept as milliseconds since 1970, which fit in JSON.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MONTHS = ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];

/** Now, which tests can move */
export const clock = {now: () => Date.now()};

/** 01.00 UTC on the last Sunday of a month, when Europe changes its clocks */
function lastSunday(year: number, month: number): number {
	const d = new Date(Date.UTC(year, month + 1, 0, 1));
	return d.getTime() - d.getUTCDay() * DAY;
}

/** What the clocks in Denmark show at a time: an hour ahead of UTC, and two in summer */
export function copenhagen(at: number) {
	const year = new Date(at).getUTCFullYear();
	const summer = at >= lastSunday(year, 2) && at < lastSunday(year, 9);
	const d = new Date(at + (summer ? 2 : 1) * HOUR);
	return {year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes()};
}

/** Midnight in Denmark, at the start of a day */
export function danishMidnight(year: number, month: number, day: number): number {
	const utc = Date.UTC(year, month, day);
	// Whichever offset Denmark had then
	return utc - (copenhagen(utc).hour == 2 ? 2 : 1) * HOUR;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Like 1. okt. 2000 */
export function danishDate(at: number): string {
	const d = copenhagen(at);
	return `${d.day}. ${MONTHS[d.month]} ${d.year}`;
}

/** The time of day, like 20.00 */
export function clockTime(at: number): string {
	const d = copenhagen(at);
	return `${pad(d.hour)}.${pad(d.minute)}`;
}

/** Like 17. okt. kl. 20.00 */
export function danishDatetime(at: number): string {
	const d = copenhagen(at);
	return `${d.day}. ${MONTHS[d.month]} kl. ${pad(d.hour)}.${pad(d.minute)}`;
}

const NEW_FOR = 14 * DAY;

/** Whether something came out within the last two weeks */
export function isNew(at: number | null | undefined): boolean {
	if (at == null) {
		return false;
	}
	const age = clock.now() - at;
	return age >= 0 && age <= NEW_FOR;
}

/** A length like 59 min. or 1 t. 15 min. */
export function duration(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	minutes %= 60;
	if (hours == 0) {
		return `${minutes} min.`;
	}
	if (minutes == 0) {
		return `${hours} t.`;
	}
	return `${hours} t. ${minutes} min.`;
}

/** Like 2026-10-12T11:40:00+00:00, for the browser to read */
export function isoTime(at: number): string {
	return new Date(at).toISOString().replace(/\.\d+Z$/, "+00:00");
}

/** A time from DR, like 2026-10-12T11:40:00Z, or undefined if it isn't one */
export function parseTime(value: unknown): number | undefined {
	if (typeof value != "string" || !/^\d{4}-\d\d-\d\d/.test(value)) {
		return undefined;
	}
	// DR has seven decimals on its seconds, like 2003-12-25T19:59:07.0000000Z
	const at = Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
	return Number.isNaN(at) ? undefined : at;
}
