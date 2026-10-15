// "Nyt til dig", under the bell: its number, in two tabs, its panel on computers and /nyt/ on phones, "Ryd alle", and
// the front page's favourites. Rejseholdet's last season came out in the last few days, see worker.ts.

import type {BrowserContext, Page} from "@playwright/test";
import {expect, test} from "./test";

const DAY = 24 * 60 * 60 * 1000;
const SHOW = "rejseholdet_503605";
const FILM = "lise-noergaard_-ikke-kun-en-pige_362031";
// What DR calls the season's second episode
const EPISODE_TITLE = "2. episode";

/** A viewer with favourites made a month ago, set up once per tab, so reloading keeps what the page changed */
async function viewer(context: BrowserContext, {favorites = [SHOW, FILM], extra = {}}: {favorites?: string[]; extra?: Record<string, string>} = {}) {
	await context.addInitScript(([favorites, extra, day]) => {
		if (localStorage.getItem("testViewer")) {
			return;
		}
		localStorage.setItem("testViewer", "true");
		const now = Date.now();
		localStorage.setItem("favorites", JSON.stringify(favorites.map(id => ({
			id, kind: id.startsWith("lise") ? "film" : "show", title: id, image: null, added: now - 30 * day,
		}))));
		for (const [key, value] of Object.entries(extra)) {
			localStorage.setItem(key, value);
		}
	}, [favorites, extra, DAY] as const);
}

const page_keyboard_escape = (page: Page) => page.keyboard.press("Escape");
const bell = (page: Page) => page.locator(".js-bell");
const badge = (page: Page) => page.locator(".js-bell .bell-count");

/** The number on the bell */
async function says(page: Page, count: number) {
	if (count == 0) {
		await expect(badge(page)).toBeHidden();
		await expect(bell(page)).toHaveAttribute("aria-label", "Nyt til dig");
	} else {
		await expect(badge(page)).toHaveText(String(count));
		await expect(bell(page)).toHaveAttribute("aria-label", `Nyt til dig, ${count} nye`);
	}
}

test.describe("on a computer", () => {
	test.use({viewport: {width: 1366, height: 768}});

	test("the bell says how many lines there are, and still does once it's opened", async ({context}) => {
		await viewer(context);
		const [first, second] = [await context.newPage(), await context.newPage()];
		for (const page of [first, second]) {
			await page.goto("/");
			// One line for each day of Rejseholdet's last season
			await says(page, 2);
		}
		await bell(first).click();
		await page_keyboard_escape(first);
		await says(first, 2);
		await second.reload();
		await says(second, 2);
	});

	test("\"Ryd alle\" empties it, in the other tabs too", async ({context}) => {
		await viewer(context);
		const [first, second] = [await context.newPage(), await context.newPage()];
		for (const page of [first, second]) {
			await page.goto("/");
			await says(page, 2);
		}
		await bell(first).click();
		await first.locator(".news-panel").getByRole("button", {name: "Ryd alle"}).click();
		await expect(first.locator(".news-panel .news-item")).toHaveCount(0);
		await expect(first.locator(".news-panel .news-none")).toHaveText("Intet nyt fra dine favoritter lige nu.");
		await expect(first.locator(".news-panel-title")).toBeFocused();
		await expect(first.locator(".news-panel").getByRole("button", {name: "Ryd alle"})).toHaveCount(0);
		await says(first, 0);
		await says(second, 0);
		await second.reload();
		await says(second, 0);
	});

	test("opens a panel below the bell, with focus in it, which Escape and a click outside close", async ({page, context}) => {
		await viewer(context);
		await page.goto("/kategorier/");
		await expect(bell(page)).toHaveAttribute("aria-expanded", "false");
		await bell(page).click();
		const panel = page.getByRole("region", {name: "Nyt til dig"});
		await expect(panel).toBeVisible();
		await expect(bell(page)).toHaveAttribute("aria-expanded", "true");
		await expect(page.locator(".news-panel-title")).toBeFocused();
		// Below the bell, in the window
		const bellBox = (await bell(page).boundingBox())!;
		const box = (await panel.boundingBox())!;
		expect(box.y).toBeGreaterThan(bellBox.y + bellBox.height - 8);
		expect(box.x + box.width).toBeLessThanOrEqual(1366);
		const lines = panel.locator(".news-item");
		await expect(lines).toHaveCount(2);
		// The series, the episode's name, and which it is
		await expect(lines.nth(0).locator(".news-show")).toHaveText("Rejseholdet");
		await expect(lines.nth(0).locator(".news-title")).toHaveText(EPISODE_TITLE);
		await expect(lines.nth(0).locator(".news-meta")).toHaveText("i gårS4 E2");
		await expect(lines.nth(0).locator("time")).toHaveText("i går");
		await expect(lines.nth(0)).toHaveAttribute("href", `/${SHOW}/rejseholdet_503636`);
		await expect(lines.nth(1).locator(".news-meta")).toHaveText("for 3 dage sidenS4 E1");
		await page.keyboard.press("Escape");
		await expect(panel).toBeHidden();
		await expect(bell(page)).toBeFocused();
		await expect(bell(page)).toHaveAttribute("aria-expanded", "false");
		// With the keyboard, like a button
		await page.keyboard.press("Enter");
		await expect(panel).toBeVisible();
		await page.mouse.click(300, 600);
		await expect(panel).toBeHidden();
	});

	test("leaves out what's seen or started", async ({page, context}) => {
		await viewer(context, {extra: {progress_503636: JSON.stringify({time: 0, duration: 4000, watched: true, updated: Date.now()})}});
		await page.goto("/");
		await says(page, 1);
		await bell(page).click();
		await expect(page.locator(".news-panel .news-item")).toHaveCount(1);
		await expect(page.locator(".news-panel .news-meta")).toHaveText("for 3 dage sidenS4 E1");
		await page.evaluate(`localStorage.setItem("progress_503616", JSON.stringify({time: 300, duration: 4000, watched: false, updated: Date.now()}))`);
		await page.reload();
		await says(page, 0);
		await expect(page.locator("#favorites .tile")).toHaveCount(2);
	});

	test("what's opened from it is gone from it", async ({page, context}) => {
		await viewer(context);
		await page.goto("/kategorier/");
		await bell(page).click();
		await page.locator(".news-panel .news-item").nth(0).click();
		await expect(page).toHaveURL(new RegExp(`/${SHOW}/rejseholdet_503636$`));
		await says(page, 1);
		await bell(page).click();
		await expect(page.locator(".news-panel .news-item")).toHaveCount(1);
		await expect(page.locator(".news-panel .news-item")).toHaveAttribute("href", `/${SHOW}/rejseholdet_503616`);
	});

	test("has a number from the first time", async ({page, context}) => {
		await context.addInitScript(([show]) => {
			if (!localStorage.getItem("favorites")) {
				localStorage.setItem("favorites", JSON.stringify([{id: show, kind: "show", title: "Rejseholdet", image: null, added: 1}]));
			}
		}, [SHOW] as const);
		await page.goto("/");
		await expect(page.locator(".shelf .tag-new")).toHaveText("2 nye afsnit");
		await says(page, 2);
	});

	test("asks for nothing of its own, when what's kept is fresh", async ({page, context}) => {
		await viewer(context);
		await page.goto("/kategorier/");
		await expect(badge(page)).toHaveText("2");
		const asked: string[] = [];
		page.on("request", request => {
			if (request.url().includes("/favorites.json")) {
				asked.push(request.url());
			}
		});
		await page.reload();
		await expect(badge(page)).toHaveText("2");
		await bell(page).click();
		await expect(page.locator(".news-panel .news-item")).toHaveCount(2);
		await page.goto("/");
		await expect(page.locator(".shelf .tag-new")).toHaveText("2 nye afsnit");
		await page.waitForTimeout(1000);
		expect(asked).toEqual([]);
	});

	test("tells of favourites leaving within a week, and counts them", async ({page, context}) => {
		await viewer(context, {favorites: [SHOW]});
		await page.route("**/favorites.json?*", async route => {
			const response = await route.fetch();
			const found = await response.json();
			found.shows[SHOW].expires = Date.now() + 3 * DAY + 60 * 60 * 1000;
			await route.fulfill({response, json: found});
		});
		await page.goto("/");
		await expect(badge(page)).toHaveText("3");
		await bell(page).click();
		const leaving = page.locator(".news-panel .news-line").filter({hasText: "Udløber"});
		await expect(leaving.locator(".news-meta")).toHaveText("Udløber om 3 dage");
		await expect(page.locator(".news-panel .news-heading").nth(1)).toHaveText("Udløber snart");
	});

	test("without favourites, says what it's for, and offers nothing else", async ({page}) => {
		await page.goto("/");
		await bell(page).click();
		await expect(page.locator(".news-panel .news-empty")).toContainText("Her kommer nye afsnit af dine favoritserier");
		await expect(page.locator(".news-panel button")).toHaveCount(0);
	});

	test("with favourites and nothing new, says so", async ({page, context}) => {
		await viewer(context, {favorites: [FILM]});
		await page.goto("/");
		await expect(page.locator("#favorites .tile")).toHaveCount(1);
		await bell(page).click();
		await expect(page.locator(".news-panel .news-none")).toHaveText("Intet nyt fra dine favoritter lige nu.");
	});
});

test.describe("on a phone", () => {
	test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

	test("the bell leads to /nyt/, with the same list", async ({page, context}) => {
		await viewer(context);
		await page.goto("/");
		await expect(badge(page)).toHaveText("2");
		// In the header, beside the account, above the tabs
		const header = (await page.locator(".site-header").boundingBox())!;
		const box = (await bell(page).boundingBox())!;
		expect(box.y + box.height).toBeLessThanOrEqual(header.y + header.height);
		await expect(bell(page)).not.toHaveAttribute("aria-expanded");
		await bell(page).click();
		await expect(page).toHaveURL(/\/nyt\/$/);
		await expect(page.getByRole("heading", {level: 1})).toHaveText("Nyt til dig");
		await expect(page.locator("#news-page .news-item")).toHaveCount(2);
		await expect(page.locator("#news-page .news-title").first()).toHaveText(EPISODE_TITLE);
		await expect(bell(page)).toHaveAttribute("aria-current", "page");
		await page.getByRole("button", {name: "Ryd alle"}).click();
		await expect(page.locator("#news-page .news-item")).toHaveCount(0);
		await says(page, 0);
	});
});

test.describe("the front page", () => {
	test.use({viewport: {width: 1280, height: 800}});

	test("puts the favourites with something new first, saying what, and leads to the first not seen", async ({page, context}) => {
		await viewer(context, {favorites: [FILM, SHOW]});
		await page.goto("/");
		const tiles = page.locator("#favorites .tile");
		await expect(tiles).toHaveCount(2);
		await expect(tiles.nth(0).locator(".tile-title")).toHaveText("Rejseholdet");
		await expect(tiles.nth(0).locator(".tag-new")).toHaveText("2 nye afsnit");
		await expect(tiles.nth(0).locator(".tile-link")).toHaveAttribute("href", `/${SHOW}/rejseholdet_503616`);
		await page.evaluate(`localStorage.setItem("progress_503616", JSON.stringify({time: 0, duration: 4000, watched: true, updated: Date.now()}))`);
		await page.reload();
		await expect(tiles.nth(0).locator(".tag-new")).toHaveText("Nyt afsnit");
		await expect(tiles.nth(0).locator(".tile-link")).toHaveAttribute("href", `/${SHOW}/rejseholdet_503636`);
		await page.evaluate(`localStorage.setItem("progress_503636", JSON.stringify({time: 0, duration: 4000, watched: true, updated: Date.now()}))`);
		await page.reload();
		// Nothing new left to see, so as it was
		await expect(tiles.nth(1).locator(".tile-title")).toHaveText("Rejseholdet");
		await expect(page.locator("#favorites .tag-new")).toHaveCount(0);
		await expect(tiles.nth(1).locator(".tile-link")).toHaveAttribute("href", `/${SHOW}/`);
	});
});
