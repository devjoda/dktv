// Going on when an episode, a series or a film ends, with the test video: the next episode in the same page,
// its countdown, "Ser du stadig med?", "Hvad nu?", and watching together through it

import type {Browser, BrowserContextOptions, Page} from "@playwright/test";
import {CREDITS, DURATION, EPISODE, EPISODE_ID, expect, INTRO, mark, NEXT_EPISODE, NEXT_EPISODE_ID, playsPast, position, seek, test, type Video, watch} from "./test";

const FILM = "/program/lise-noergaard_-ikke-kun-en-pige_362031";
// The last episode of Rejseholdet's first season, and the first of its second
const SEASON_END = "/rejseholdet_503605/rejseholdet_503638";
const SEASON_START = "/rejseholdet_503605/rejseholdet_503631";
// The last episode of all
const LAST_EPISODE = "/rejseholdet_503605/rejseholdet_503636";

/** Marks the page, so it's known whether it was loaded again or changed in place */
const markPage = (page: Page) => page.evaluate("window.samePage = true");
const samePage = (page: Page) => page.evaluate("window.samePage === true");

const upNext = (page: Page) => page.locator("#up-next");
const whatNext = (page: Page) => page.getByRole("region", {name: "Hvad nu?"});

/** To the end of what plays, and past it */
async function toTheEnd(page: Page) {
	await seek(page, DURATION - 1.5);
	await expect.poll(() => page.locator("#video").evaluate((video: Video) => video.paused)).toBe(true);
}

test("plays the next episode in the same page, in full screen, with its title, address and sound", async ({page}) => {
	await watch(page, EPISODE);
	await markPage(page);
	await page.locator("#video").evaluate((video: Video & {volume: number}) => { video.volume = 0.4; });
	await page.keyboard.press("f");
	await expect.poll(() => page.evaluate("Boolean(document.fullscreenElement)")).toBe(true);
	await seek(page, DURATION - 2);
	await expect(upNext(page)).toBeVisible();
	await expect(upNext(page)).toContainText(/Starter om \d+ sek\./);
	await upNext(page).getByRole("link", {name: "Afspil nu"}).click();
	await expect(page).toHaveURL(NEXT_EPISODE);
	await expect(page.locator(".watch-title")).toHaveText("2. episode");
	await expect(page).toHaveTitle(/2\. episode/);
	await playsPast(page, 0.5);
	expect(await samePage(page)).toBe(true);
	expect(await page.evaluate("Boolean(document.fullscreenElement)")).toBe(true);
	expect(await page.locator("#video").getAttribute("data-episode-id")).toBe(NEXT_EPISODE_ID);
	expect(await page.locator("#video").evaluate((video: Video & {volume: number; muted: boolean}) => [video.volume, video.muted])).toEqual([0.4, false]);
});

test("goes on by itself after the countdown, and back and forward go through the episodes", async ({page}) => {
	await watch(page, EPISODE);
	await markPage(page);
	await toTheEnd(page);
	await expect(upNext(page)).toContainText("Starter om");
	// The countdown, by itself
	await expect(page).toHaveURL(NEXT_EPISODE, {timeout: 15_000});
	await playsPast(page, 0.5);
	await page.goBack();
	await expect(page).toHaveURL(EPISODE);
	await expect(page.locator(".watch-title")).toHaveText("1. episode");
	await expect.poll(() => page.locator("#video").getAttribute("data-episode-id")).toBe(EPISODE_ID);
	await page.goForward();
	await expect(page).toHaveURL(NEXT_EPISODE);
	await expect(page.locator(".watch-title")).toHaveText("2. episode");
	expect(await samePage(page)).toBe(true);
});

test("has the next episode's intro and progress, after going on in the same page", async ({page}) => {
	// Marked by two, as it takes
	for (let i = 0; i < 2; i++) {
		await mark(page, NEXT_EPISODE_ID, "intro", INTRO.start, INTRO.end);
	}
	await watch(page, EPISODE);
	await seek(page, 40);
	await playsPast(page, 41);
	await page.locator(".episode-nav").getByRole("link", {name: /Næste afsnit/}).click();
	await expect(page).toHaveURL(NEXT_EPISODE);
	await playsPast(page, 0.5);
	// How far the viewer got with the first, kept as it was left
	const first = await page.evaluate(id => JSON.parse(localStorage.getItem("progress_" + id) ?? "null"), EPISODE_ID);
	expect(first.time).toBeGreaterThan(40);
	// The next one's intro, which it has marked
	await seek(page, INTRO.start + 1);
	await expect(page.getByRole("button", {name: "Spring intro over"})).toBeVisible();
	await seek(page, 50);
	await playsPast(page, 51);
	await page.locator("#video").evaluate((video: Video) => video.pause());
	await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem("progress_" + id) ?? "null")?.time ?? 0, NEXT_EPISODE_ID)).toBeGreaterThan(50);
	expect(await page.evaluate(id => JSON.parse(localStorage.getItem("progress_" + id) ?? "null")?.url, NEXT_EPISODE_ID)).toBe(NEXT_EPISODE);
});

test("only offers the next episode, without counting down, when the viewer turned that off", async ({page}) => {
	await page.goto("/sync/");
	const toggle = page.getByLabel("Afspil næste afsnit automatisk");
	await expect(toggle).toBeChecked();
	await toggle.uncheck();
	await watch(page, EPISODE);
	await toTheEnd(page);
	await expect(upNext(page)).toBeVisible();
	await expect(upNext(page)).not.toContainText("Starter om");
	await expect(upNext(page).getByRole("button", {name: "Luk"})).toBeVisible();
	await page.waitForTimeout(12_000);
	await expect(page).toHaveURL(EPISODE);
	await upNext(page).getByRole("link", {name: "Afspil nu"}).click();
	await expect(page).toHaveURL(NEXT_EPISODE);
});

test("counts down as marked credits start too", async ({page}) => {
	for (let i = 0; i < 2; i++) {
		await mark(page, EPISODE_ID, "credits", CREDITS, DURATION);
	}
	await watch(page, EPISODE);
	await seek(page, CREDITS - 1);
	await playsPast(page, CREDITS + 0.5);
	await expect(upNext(page)).toContainText("Starter om");
	await upNext(page).getByRole("button", {name: "Annullér"}).click();
	await expect(upNext(page)).toHaveCount(0);
});

test("goes on from a season's last episode to the next season's first", async ({page}) => {
	await watch(page, SEASON_END);
	await markPage(page);
	expect(await page.locator("#video").getAttribute("data-next-url")).toBe(SEASON_START);
	await toTheEnd(page);
	await expect(upNext(page)).toContainText("Sæson 2, 1. episode");
	await upNext(page).getByRole("link", {name: "Afspil nu"}).click();
	await expect(page).toHaveURL(SEASON_START);
	await playsPast(page, 0.5);
	expect(await samePage(page)).toBe(true);
});

test("shows the play button, and doesn't count it, when the browser won't play the next one by itself", async ({page}) => {
	await watch(page, EPISODE);
	await toTheEnd(page);
	// From now on, the browser won't play anything by itself
	await page.evaluate(`HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException("No", "NotAllowedError")); }`);
	await expect(page).toHaveURL(NEXT_EPISODE, {timeout: 15_000});
	await expect(page.locator(".plyr__control--overlaid")).toBeVisible();
	await page.waitForTimeout(500);
	expect(await page.evaluate(`sessionStorage.getItem("autoStreak")`)).toBe(null);
});

test("asks whether the viewer still watches, after 3 episodes by themselves and an hour and a half without them", async ({page}) => {
	await page.addInitScript(`
		sessionStorage.setItem("autoStreak", "3");
		sessionStorage.setItem("lastInteraction", String(Date.now() - 91 * 60 * 1000));
	`);
	await watch(page, EPISODE);
	await toTheEnd(page);
	const asking = page.getByRole("region", {name: "Ser du stadig med?"});
	await expect(asking).toBeVisible();
	await expect(asking).not.toContainText("Starter om");
	await expect(asking.getByRole("button", {name: "Stop"})).toBeVisible();
	await page.waitForTimeout(12_000);
	await expect(page).toHaveURL(EPISODE);
	await asking.getByRole("link", {name: "Se videre"}).click();
	await expect(page).toHaveURL(NEXT_EPISODE);
	// Chosen by the viewer, so the count starts over
	expect(await page.evaluate(`sessionStorage.getItem("autoStreak")`)).toBe("0");
});

test("offers what to watch now after the last episode, from the viewer's favourites, without starting anything", async ({page}) => {
	const asked: string[] = [];
	page.on("request", request => request.url().includes("/forslag/") && asked.push(request.url()));
	await page.addInitScript(`
		if (!localStorage.getItem("favorites")) {
			localStorage.setItem("favorites", JSON.stringify([
				{id: "rejseholdet_503605", kind: "show", title: "Rejseholdet", image: null, added: 1},
				{id: "lise-noergaard_-ikke-kun-en-pige_362031", kind: "film", title: "Lise Nørgaard", image: null, added: 2},
			]));
			localStorage.setItem("progress_362031", JSON.stringify({time: 600, duration: 2880, watched: false, title: "Lise Nørgaard: Ikke kun en pige", url: "/program/lise-noergaard_-ikke-kun-en-pige_362031", updated: Date.now()}));
		}
	`);
	await watch(page, LAST_EPISODE);
	// Never as the page loads
	expect(asked).toEqual([]);
	await toTheEnd(page);
	const card = whatNext(page);
	await expect(card).toBeVisible();
	await expect(upNext(page)).toHaveCount(0);
	// Rejseholdet was just watched, so the film that's halfway, and then DR's own, from the same category
	await expect(card.locator(".what-next-item").first()).toContainText("Se videre");
	await expect(card.locator(".what-next-item").first()).toContainText("Lise Nørgaard: Ikke kun en pige");
	await expect(card.locator(".what-next-item")).toHaveCount(4);
	await expect(card.locator(".what-next-label").nth(1)).toHaveText("Serier");
	expect(asked).toEqual([expect.stringContaining("/forslag/serie/rejseholdet_503605")]);
	await page.waitForTimeout(2000);
	await expect(page).toHaveURL(LAST_EPISODE);
	// Read out, without taking the viewer's focus
	await expect(page.locator("#toast")).toContainText("Hvad nu?");
	expect(await page.evaluate("document.activeElement === document.body || !document.activeElement.closest('#what-next')")).toBe(true);
	await page.keyboard.press("Escape");
	await expect(card).toHaveCount(0);
});

test("offers what to watch now after a film, in full screen too, and goes away as it plays again", async ({page}) => {
	await watch(page, FILM);
	await page.keyboard.press("f");
	await expect.poll(() => page.evaluate("Boolean(document.fullscreenElement)")).toBe(true);
	await toTheEnd(page);
	const card = whatNext(page);
	await expect(card).toBeVisible();
	// Inside what's in full screen
	expect(await page.evaluate("document.fullscreenElement.contains(document.getElementById('what-next'))")).toBe(true);
	// Nothing to suggest: the fixtures have no page for its categories, and there are no favourites
	await expect(card.getByRole("button", {name: "Se igen"})).toBeVisible();
	await expect(card.getByRole("link", {name: "Til forsiden"})).toHaveAttribute("href", "/");
	await card.getByRole("button", {name: "Se igen"}).click();
	await expect(card).toHaveCount(0);
	await playsPast(page, 0.5);
	expect(await position(page)).toBeLessThan(10);
});

test("has a small Hvad nu? in the corner as a film's marked credits start, which opens it", async ({page}) => {
	for (let i = 0; i < 2; i++) {
		await mark(page, "362031", "credits", CREDITS, DURATION);
	}
	await watch(page, FILM);
	await seek(page, CREDITS - 1);
	await playsPast(page, CREDITS + 0.5);
	const corner = page.getByRole("button", {name: "Hvad nu?"});
	await expect(corner).toBeVisible();
	// In the corner, away from the middle of the picture where credits roll
	const box = (await corner.boundingBox())!;
	const video = (await page.locator("#video").boundingBox())!;
	expect(box.y).toBeLessThan(video.y + video.height / 4);
	expect(box.width).toBeLessThan(video.width / 4);
	await corner.click();
	await expect(whatNext(page)).toBeVisible();
});

/** A viewer with a browser of their own, which only reaches the local server */
async function viewer(browser: Browser, name: string, options: BrowserContextOptions = {}): Promise<Page> {
	const context = await browser.newContext(options);
	await context.route(url => !["localhost", "127.0.0.1"].includes(url.hostname), route => route.abort());
	await context.addInitScript(name => localStorage.setItem("togetherName", name), name);
	return context.newPage();
}

test("watching together, the next episode plays for both in the same page, and the room and its chat stay", async ({browser}) => {
	const anna = await viewer(browser, "Anna");
	await watch(anna, EPISODE);
	await anna.getByRole("button", {name: "Se sammen"}).click();
	const link = await anna.getByLabel("Link til at se med").inputValue();
	const bo = await viewer(browser, "Bo");
	await bo.goto(link);
	await playsPast(bo, 0.2);
	await expect(bo.locator(".js-together-people")).toHaveText("Du ser med Anna");
	await markPage(anna);
	await markPage(bo);
	await toTheEnd(anna);
	await upNext(anna).getByRole("link", {name: "Afspil nu"}).click();
	await expect(anna).toHaveURL(NEXT_EPISODE);
	await expect(bo).toHaveURL(NEXT_EPISODE);
	await expect(bo.locator(".watch-title")).toHaveText("2. episode");
	await playsPast(bo, 0.5);
	expect(await samePage(anna)).toBe(true);
	expect(await samePage(bo)).toBe(true);
	// From the start, together
	expect(await position(bo)).toBeLessThan(10);
	// Still in the room, and its chat
	await expect(bo.locator(".js-together-people")).toHaveText("Du ser med Anna");
	const input = anna.getByRole("region", {name: "Chat"}).getByLabel("Skriv en besked");
	await input.fill("Næste!");
	await input.press("Enter");
	await expect(bo.locator(".chat-messages .chat-line:not(.is-system) .chat-text").last()).toHaveText("Næste!");
	await anna.context().close();
	await bo.context().close();
});

test.describe("on a phone", () => {
	test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

	test("has the next episode below the small player, and on the picture in full screen", async ({page}) => {
		await watch(page, EPISODE);
		await toTheEnd(page);
		await expect(upNext(page)).toBeVisible();
		const video = (await page.locator("#video").boundingBox())!;
		const box = (await upNext(page).boundingBox())!;
		expect(box.y).toBeGreaterThanOrEqual(video.y + video.height - 1);
		await page.keyboard.press("f");
		await expect.poll(() => page.evaluate("Boolean(document.fullscreenElement)")).toBe(true);
		await expect.poll(() => page.evaluate("document.fullscreenElement.contains(document.getElementById('up-next'))")).toBe(true);
	});
});
