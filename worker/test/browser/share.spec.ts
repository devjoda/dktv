// Sharing: where there's something to pass on, as a series' page, a video, a room to watch together and "Hvad nu?"
// once it's over, and nowhere else. Computers copy the link and say so; what's copied is noted instead of the clipboard.

import type {Page} from "@playwright/test";
import {DURATION, EPISODE, expect, seek, test, type Video, watch} from "./test";

const SHOW = "/rejseholdet_503605/";
const FILM = "/program/lise-noergaard_-ikke-kun-en-pige_362031";
const LAST_EPISODE = "/rejseholdet_503605/rejseholdet_503636";

test.beforeEach(async ({context}) => {
	await context.addInitScript("navigator.clipboard.writeText = async text => { window.copied = text; };");
});

const copied = (page: Page) => page.evaluate("window.copied") as Promise<string | undefined>;
const toast = (page: Page) => page.locator("#toast");

async function toTheEnd(page: Page) {
	await seek(page, DURATION - 1.5);
	await expect.poll(() => page.locator("#video").evaluate((video: Video) => video.paused)).toBe(true);
}

test("a series' page has Del, which copies its address", async ({page}) => {
	await page.goto(SHOW);
	await page.locator(".hero").getByRole("button", {name: "Del"}).click();
	await expect(toast(page)).toHaveText("Linket er kopieret");
	expect(await copied(page)).toBe(new URL(SHOW, page.url()).href);
});

test("a video's Del copies where it's got to", async ({page}) => {
	await watch(page, EPISODE);
	await seek(page, 30);
	const share = page.locator(".js-share");
	await expect(share).toHaveText(/Del fra 0:3\d/);
	await share.click();
	await expect(toast(page)).toHaveText(/Linket til 0:3\d er kopieret/);
	expect(await copied(page)).toMatch(new RegExp(`${EPISODE}\\?t=3\\d$`));
});

test("the room's Del linket copies the room's link", async ({page}) => {
	await watch(page, EPISODE);
	await page.getByRole("button", {name: "Se sammen"}).click();
	const panel = page.getByRole("region", {name: "Se sammen"});
	await panel.getByRole("button", {name: "Del linket"}).click();
	await expect(toast(page)).toHaveText("Linket er kopieret. Send det til dem, du vil se med.");
	expect(await copied(page)).toMatch(new RegExp(`${EPISODE}\\?sammen=[A-Z0-9]{8}$`));
});

test("Hvad nu? after the last episode shares the series, not the episode", async ({page}) => {
	await watch(page, LAST_EPISODE);
	await toTheEnd(page);
	const card = page.getByRole("region", {name: "Hvad nu?"});
	await card.getByRole("button", {name: "Del Rejseholdet"}).click();
	await expect(toast(page)).toHaveText("Linket er kopieret");
	expect(await copied(page)).toMatch(new RegExp(`:\\d+${SHOW}$`));
});

test("Hvad nu? after a film shares the film", async ({page}) => {
	await watch(page, FILM);
	await toTheEnd(page);
	const card = page.getByRole("region", {name: "Hvad nu?"});
	await card.getByRole("button", {name: /^Del Lise Nørgaard/}).click();
	expect(await copied(page)).toMatch(new RegExp(`:\\d+${FILM}$`));
});

test("not as the next episode is offered, which only goes on or stops", async ({page}) => {
	await watch(page, EPISODE);
	await toTheEnd(page);
	await expect(page.locator("#up-next")).toBeVisible();
	await expect(page.locator("#up-next").locator("a, button")).toHaveCount(2);
	await expect(page.locator("#up-next")).not.toContainText("Del");
});

test("not on the front page, or the rows' tiles", async ({page}) => {
	await page.goto("/");
	await expect(page.locator("main").getByRole("button", {name: /^Del/})).toHaveCount(0);
});
