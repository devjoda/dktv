// "Nyt til dig", under the bell: its number, in two tabs, its panel on computers and /nyt/ on phones, the front page's
// favourites, and notifications offered from it. Rejseholdet's last season came out in the last few days, see worker.ts.

import type {BrowserContext, Page} from "@playwright/test";
import {expect, test} from "./test";

const DAY = 24 * 60 * 60 * 1000;
const SHOW = "rejseholdet_503605";
const FILM = "lise-noergaard_-ikke-kun-en-pige_362031";

/**
 * A viewer with favourites made a month ago, who last opened the bell four days ago, set up once per tab,
 * so reloading keeps what the page changed
 */
async function viewer(context: BrowserContext, {favorites = [SHOW, FILM], seen = 4 * DAY, extra = {}}: {favorites?: string[]; seen?: number; extra?: Record<string, string>} = {}) {
	await context.addInitScript(([favorites, seen, extra, day]) => {
		if (localStorage.getItem("testViewer")) {
			return;
		}
		localStorage.setItem("testViewer", "true");
		const now = Date.now();
		localStorage.setItem("favorites", JSON.stringify(favorites.map(id => ({
			id, kind: id.startsWith("lise") ? "film" : "show", title: id, image: null, added: now - 30 * day,
		}))));
		localStorage.setItem("newsSince", String(now - 20 * day));
		localStorage.setItem("newsSeen", String(now - seen));
		for (const [key, value] of Object.entries(extra)) {
			localStorage.setItem(key, value);
		}
	}, [favorites, seen, extra, DAY] as const);
}

const bell = (page: Page) => page.locator(".js-bell");
const badge = (page: Page) => page.locator(".js-bell .bell-count");

/** No number on the bell, only the dot that says there's something in it not seen yet */
async function onlyDot(page: Page) {
	await expect(badge(page)).toHaveClass(/is-dot/);
	await expect(badge(page)).toHaveText("");
	await expect(badge(page)).toBeVisible();
	await expect(bell(page)).toHaveAttribute("aria-label", "Nyt til dig, med noget du ikke har set");
}

test.describe("on a computer", () => {
	test.use({viewport: {width: 1366, height: 768}});

	test("the bell says how many lines are new, and opening it resets that in the other tabs too", async ({context}) => {
		await viewer(context);
		const [first, second] = [await context.newPage(), await context.newPage()];
		for (const page of [first, second]) {
			await page.goto("/");
			// One line for each day of Rejseholdet's last season
			await expect(badge(page)).toHaveText("2");
			await expect(bell(page)).toHaveAttribute("aria-label", "Nyt til dig, 2 nye");
		}
		await bell(first).click();
		await onlyDot(first);
		await onlyDot(second);
		await second.reload();
		await onlyDot(second);
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
		await expect(lines.nth(0).locator(".news-title")).toHaveText("Rejseholdet: S4 A2");
		await expect(lines.nth(0).locator("time")).toHaveText("i går");
		await expect(lines.nth(0)).toHaveAttribute("href", `/${SHOW}/rejseholdet_503636`);
		await expect(lines.nth(1).locator(".news-title")).toHaveText("Rejseholdet: S4 A1");
		await expect(lines.nth(1).locator("time")).toHaveText("for 3 dage siden");
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

	test("says Set on what's seen, instead of leaving it out", async ({page, context}) => {
		await viewer(context, {extra: {progress_503636: JSON.stringify({time: 0, duration: 4000, watched: true, updated: Date.now()})}});
		await page.goto("/");
		// What's seen already isn't news
		await expect(badge(page)).toHaveText("1");
		await bell(page).click();
		const seen = page.locator(".news-line").nth(0);
		await expect(seen.locator(".news-title")).toHaveText("Rejseholdet: S4 A2");
		await expect(seen.locator(".news-seen")).toHaveText("Set");
		await expect(page.locator(".news-line").nth(1).locator(".news-seen")).toHaveCount(0);
	});

	test("shows nothing, once everything in it is seen", async ({page, context}) => {
		const watched = JSON.stringify({time: 0, duration: 4000, watched: true, updated: 1});
		await viewer(context, {extra: {progress_503636: watched, progress_503616: watched}});
		await page.goto("/");
		await expect(page.locator("#favorites .tile")).toHaveCount(2);
		await page.waitForTimeout(1000);
		await expect(badge(page)).toBeHidden();
		await expect(bell(page)).toHaveAttribute("aria-label", "Nyt til dig");
	});

	test("the first time, the number is 0, though there is something new", async ({page, context}) => {
		await context.addInitScript(([show]) => {
			if (!localStorage.getItem("favorites")) {
				localStorage.setItem("favorites", JSON.stringify([{id: show, kind: "show", title: "Rejseholdet", image: null, added: 1}]));
			}
		}, [SHOW] as const);
		await page.goto("/");
		await expect(page.locator(".shelf .tag-new")).toHaveText("2 nye afsnit");
		// No number, but the dot, since there's something not seen yet
		await onlyDot(page);
		await bell(page).click();
		await expect(page.locator(".news-panel .news-item")).toHaveCount(2);
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

	test("tells of favourites leaving within a week, and counts each once", async ({page, context}) => {
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
		await page.keyboard.press("Escape");
		await page.reload();
		await onlyDot(page);
	});

	test("without favourites, says what it's for", async ({page}) => {
		await page.goto("/");
		await bell(page).click();
		await expect(page.locator(".news-panel .news-empty")).toContainText("Her kommer nye afsnit af dine favoritserier");
		await expect(page.locator(".news-panel .news-alerts")).toBeHidden();
	});

	test("with favourites and nothing new, says so", async ({page, context}) => {
		await viewer(context, {favorites: [FILM]});
		await page.goto("/");
		await expect(page.locator("#favorites .tile")).toHaveCount(1);
		await bell(page).click();
		await expect(page.locator(".news-panel .news-none")).toHaveText("Intet nyt de sidste 14 dage");
	});

	test("offers notifications at the bottom, and only asks for permission after a click", async ({page, context}) => {
		await viewer(context);
		// The browser's notifications, which ask for permission, and its push service, as stand-ins
		await context.addInitScript(`
			let permission = "default";
			window.permissionAsked = 0;
			let subscription = null;
			Object.defineProperty(Notification, "permission", {get: () => permission});
			Notification.requestPermission = async () => {
				window.permissionAsked++;
				permission = "granted";
				return permission;
			};
			const pushManager = {
				getSubscription: async () => subscription,
				subscribe: async () => {
					subscription = {endpoint: "https://push.example/1", toJSON: () => ({endpoint: "https://push.example/1", keys: {p256dh: "a", auth: "b"}}), unsubscribe: async () => { subscription = null; return true; }};
					return subscription;
				},
			};
			Object.defineProperty(navigator, "serviceWorker", {value: {ready: Promise.resolve({pushManager}), register: async () => ({})}});
		`);
		await page.route("**/konto.json", route => route.fulfill({json: {push: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U", passkeys: true}}));
		const pushed: string[] = [];
		await page.route("**/push/*", route => {
			pushed.push(route.request().method());
			return route.fulfill({status: route.request().method() == "POST" ? 201 : 204, json: {}});
		});
		await page.goto("/");
		await bell(page).click();
		const offer = page.getByRole("button", {name: "Få besked på denne enhed"});
		await expect(offer).toBeVisible();
		expect(await page.evaluate("window.permissionAsked")).toBe(0);
		await offer.click();
		await expect(page.locator(".news-alerts")).toContainText("Notifikationer er slået til");
		expect(await page.evaluate("window.permissionAsked")).toBe(1);
		expect(pushed).toEqual(["POST"]);
		// And off again, from the same place
		await page.locator(".news-alerts").getByRole("button", {name: "Slå fra"}).click();
		await expect(offer).toBeVisible();
		expect(pushed).toEqual(["POST", "DELETE"]);
	});
});

test.describe("on an iPhone, in Safari", () => {
	test.use({
		viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true,
		userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
	});

	test("explains that the site must be on the home screen for notifications, and asks for nothing", async ({page, context}) => {
		await viewer(context);
		// Safari outside the home screen has no push
		await context.addInitScript(`
			delete window.PushManager;
			window.permissionAsked = 0;
			Notification.requestPermission = async () => { window.permissionAsked++; return "default"; };
		`);
		await page.route("**/konto.json", route => route.fulfill({json: {push: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U"}}));
		await page.goto("/nyt/");
		await expect(page.locator(".news-alerts")).toContainText("føjet til hjemmeskærmen");
		await expect(page.locator(".news-alerts button")).toHaveCount(0);
		expect(await page.evaluate("window.permissionAsked")).toBe(0);
	});
});

test.describe("on a phone", () => {
	test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

	test("the bell leads to /nyt/, with the same list, which resets the number", async ({page, context}) => {
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
		await expect(page.locator("#news-page .news-title").first()).toHaveText("Rejseholdet: S4 A2");
		await onlyDot(page);
		await expect(bell(page)).toHaveAttribute("aria-current", "page");
		await page.goto("/");
		await onlyDot(page);
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
		await expect(tiles.nth(0).locator(".tag-new")).toHaveText("Nyt: S4 A2");
		await expect(tiles.nth(0).locator(".tile-link")).toHaveAttribute("href", `/${SHOW}/rejseholdet_503636`);
		await page.evaluate(`localStorage.setItem("progress_503636", JSON.stringify({time: 0, duration: 4000, watched: true, updated: Date.now()}))`);
		await page.reload();
		// Nothing new left to see, so as it was
		await expect(tiles.nth(1).locator(".tile-title")).toHaveText("Rejseholdet");
		await expect(page.locator("#favorites .tag-new")).toHaveCount(0);
		await expect(tiles.nth(1).locator(".tile-link")).toHaveAttribute("href", `/${SHOW}/`);
	});
});
