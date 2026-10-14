// The favourites page's filters: Alle, Serier, Film og programmer and Dokumentar, with how many each has,
// only in the address, and only once there are enough favourites of more than one kind

import type {BrowserContext, Page} from "@playwright/test";
import {expect, test} from "./test";

interface Made {
	id: string;
	kind: "show" | "film";
	documentary: boolean | null;
}

const series = (n: number, documentary: boolean | null = false, from = 0): Made[] =>
	Array.from({length: n}, (_, i) => ({id: `serie-${documentary}-${from + i}_${9100 + from + i + (documentary ? 50 : 0)}`, kind: "show", documentary}));
const films = (n: number, documentary: boolean | null = false): Made[] =>
	Array.from({length: n}, (_, i) => ({id: `film-${documentary}-${i}_${9300 + i + (documentary ? 50 : 0)}`, kind: "film", documentary}));

/**
 * A viewer with these favourites, and the server's answers about them, which may only have time for `first`
 * of them at once, and tell of the rest the next time
 */
async function withFavorites(context: BrowserContext, made: Made[], {first = Infinity}: {first?: number} = {}) {
	await context.addInitScript(`
		if (!localStorage.getItem("favorites")) {
			localStorage.setItem("favorites", JSON.stringify(${JSON.stringify(made.map((m, i) => ({id: m.id, kind: m.kind, title: m.id.split("_")[0], image: null, added: 1000 - i})))}));
		}
	`);
	await context.route("**/favorites.json?*", route => {
		const url = new URL(route.request().url());
		const asked = (name: string) => (url.searchParams.get(name) ?? "").split(":").filter(Boolean);
		const ids = [...asked("shows"), ...asked("films")];
		const now = new Set(ids.slice(0, first));
		const answer = {shows: {} as Record<string, unknown>, films: {} as Record<string, unknown>, more: {shows: [] as string[], films: [] as string[]}};
		for (const m of made.filter(m => ids.includes(m.id))) {
			const kind = m.kind == "show" ? "shows" : "films";
			if (!now.has(m.id)) {
				answer.more[kind].push(m.id);
			} else if (m.kind == "show") {
				answer.shows[m.id] = {title: m.id.split("_")[0], url: `/${m.id}/`, image: null, seasons: 1, episodes: 6, episode_ids: [], new: false, new_episodes: [], documentary: m.documentary, expires: null};
			} else {
				answer.films[m.id] = {title: m.id.split("_")[0], url: `/program/${m.id}`, image: null, minutes: 58, documentary: m.documentary, expires: null};
			}
		}
		return route.fulfill({json: answer.more.shows.length + answer.more.films.length ? answer : {shows: answer.shows, films: answer.films}});
	});
}

const filterButton = (page: Page, name: string) => page.locator(".js-favorite-filters").getByRole("button", {name});
const visibleTiles = (page: Page, section: string) => page.locator(`${section} .tile:visible`);

test("filters the favourites, with how many each has, in the address, which back goes back through", async ({page, context}) => {
	await withFavorites(context, [...series(4), ...series(2, true), ...films(3), ...films(1, true)]);
	await page.goto("/favoritter/");
	const bar = page.locator(".js-favorite-filters");
	await expect(bar).toBeVisible();
	await expect(filterButton(page, "Alle")).toHaveText("Alle 10");
	await expect(filterButton(page, "Serier")).toHaveText("Serier 6");
	await expect(filterButton(page, "Film og programmer")).toHaveText("Film og programmer 4");
	await expect(filterButton(page, "Dokumentar")).toHaveText("Dokumentar 3");
	await expect(filterButton(page, "Alle")).toHaveAttribute("aria-pressed", "true");

	await filterButton(page, "Dokumentar").click();
	await expect(page).toHaveURL(/\/favoritter\/\?vis=dokumentar$/);
	await expect(filterButton(page, "Dokumentar")).toHaveAttribute("aria-pressed", "true");
	await expect(filterButton(page, "Alle")).toHaveAttribute("aria-pressed", "false");
	// A documentary series is still among the series, and a documentary among the films: hidden, not moved
	await expect(visibleTiles(page, "#favorite-shows")).toHaveCount(2);
	await expect(visibleTiles(page, "#favorite-films")).toHaveCount(1);
	await expect(page.locator("#favorite-shows .section-title")).toHaveText("Serier");

	await filterButton(page, "Serier").click();
	await expect(page).toHaveURL(/\?vis=serier$/);
	await expect(visibleTiles(page, "#favorite-shows")).toHaveCount(6);
	await expect(page.locator("#favorite-films")).toBeHidden();

	await page.goBack();
	await expect(page).toHaveURL(/\?vis=dokumentar$/);
	await expect(filterButton(page, "Dokumentar")).toHaveAttribute("aria-pressed", "true");
	await expect(visibleTiles(page, "#favorite-shows")).toHaveCount(2);
	await page.goBack();
	await expect(page).toHaveURL(/\/favoritter\/$/);
	await expect(visibleTiles(page, "#favorite-shows")).toHaveCount(6);
	await expect(visibleTiles(page, "#favorite-films")).toHaveCount(4);

	// From the address, as when it's shared or reloaded, and not remembered anywhere else
	await page.goto("/favoritter/?vis=film");
	await expect(filterButton(page, "Film og programmer")).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator("#favorite-shows")).toBeHidden();
	await expect(visibleTiles(page, "#favorite-films")).toHaveCount(4);
	await page.goto("/favoritter/");
	await expect(filterButton(page, "Alle")).toHaveAttribute("aria-pressed", "true");
	expect(await page.evaluate("Object.keys(localStorage).filter(key => /filter|vis/i.test(key))")).toEqual([]);
});

test("says so when a filter has none", async ({page, context}) => {
	await withFavorites(context, [...series(6), ...films(3)]);
	await page.goto("/favoritter/?vis=dokumentar");
	await expect(filterButton(page, "Dokumentar")).toHaveText("Dokumentar 0");
	await expect(page.locator(".js-filter-empty")).toHaveText("Ingen dokumentarer blandt dine favoritter endnu.");
	await expect(page.locator("#favorite-shows")).toBeHidden();
	await expect(page.locator("#favorite-films")).toBeHidden();
	await filterButton(page, "Alle").click();
	await expect(page.locator(".js-filter-empty")).toBeHidden();
});

test("has no filters with fewer than 8 favourites, or only one kind, and shows them all", async ({page, context}) => {
	await withFavorites(context, [...series(4), ...films(3, true)]);
	await page.goto("/favoritter/?vis=dokumentar");
	await expect(page.locator("#favorite-films .tile")).toHaveCount(3);
	await expect(page.locator(".js-favorite-filters")).toBeHidden();
	await expect(visibleTiles(page, "#favorite-shows")).toHaveCount(4);
	await expect(visibleTiles(page, "#favorite-films")).toHaveCount(3);
});

test("has no filters when all of them are series that aren't documentaries", async ({page, context}) => {
	await withFavorites(context, series(9));
	await page.goto("/favoritter/");
	await expect(page.locator("#favorite-shows .tile")).toHaveCount(9);
	await expect(page.locator(".js-favorite-filters")).toBeHidden();
});

test("counts again as the server tells of more of them, and has those it hasn't yet under Alle only", async ({page, context}) => {
	// The server only has time for 6 at once; the page asks for the rest
	await withFavorites(context, [...series(3, true), ...series(3), ...films(3, true)], {first: 6});
	const answers: number[] = [];
	let release: () => void = () => {};
	const held = new Promise<void>(resolve => { release = resolve; });
	page.on("response", response => response.url().includes("/favorites.json") && answers.push(answers.length));
	await page.route("**/favorites.json?*", async route => {
		if (answers.length >= 1) {
			await held;
		}
		await route.fallback();
	});
	await page.goto("/favoritter/?vis=dokumentar");
	// Only the first answer so far: the films' categories aren't known yet
	await expect(filterButton(page, "Dokumentar")).toHaveText("Dokumentar 3");
	await expect(visibleTiles(page, "#favorite-films")).toHaveCount(0);
	await expect(filterButton(page, "Alle")).toHaveText("Alle 9");
	release();
	await expect(filterButton(page, "Dokumentar")).toHaveText("Dokumentar 6");
	await expect(visibleTiles(page, "#favorite-films")).toHaveCount(3);
});

test("the page is the same whatever filter its address has, so it's kept once for everyone", async ({page}) => {
	const plain = await (await page.request.get("/favoritter/")).text();
	const filtered = await (await page.request.get("/favoritter/?vis=dokumentar")).text();
	expect(filtered).toBe(plain);
});

test.describe("on a phone", () => {
	test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

	test("has the filters on more lines, without the page scrolling sideways", async ({page, context}) => {
		await withFavorites(context, [...series(4), ...series(2, true), ...films(3), ...films(1, true)]);
		await page.goto("/favoritter/");
		await expect(page.locator(".js-favorite-filters")).toBeVisible();
		const first = (await filterButton(page, "Alle").boundingBox())!;
		const last = (await filterButton(page, "Dokumentar").boundingBox())!;
		expect(last.y).toBeGreaterThan(first.y);
		expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
	});
});
