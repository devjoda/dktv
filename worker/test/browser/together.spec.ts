// "Se sammen": two viewers, each in a browser of their own, watching the test video together

import type {Browser, Page} from "@playwright/test";
import {EPISODE, expect, isPaused, NEXT_EPISODE, playsPast, position, seek, test, type Video, watch} from "./test";

/** A viewer with a browser of their own, which only reaches the local server */
async function viewer(browser: Browser, name: string): Promise<Page> {
	const context = await browser.newContext();
	await context.route(url => !["localhost", "127.0.0.1"].includes(url.hostname), route => route.abort());
	await context.addInitScript(name => localStorage.setItem("togetherName", name), name);
	return context.newPage();
}

/** Anna starts a room, and Bo joins it from her link */
async function together(browser: Browser): Promise<[Page, Page]> {
	const anna = await viewer(browser, "Anna");
	await watch(anna, EPISODE);
	await anna.getByRole("button", {name: "Se sammen"}).click();
	const panel = anna.getByRole("region", {name: "Se sammen"});
	await expect(panel).toBeVisible();
	await expect(panel.locator(".js-together-people")).toHaveText("Kun dig indtil videre. Send linket til dem, du vil se med.");
	const link = await panel.getByLabel("Link til at se med").inputValue();
	expect(link).toMatch(new RegExp(`${EPISODE}\\?sammen=[A-Z0-9]{8}$`));

	const bo = await viewer(browser, "Bo");
	await bo.goto(link);
	await playsPast(bo, 0.2);
	// The room's part of the link is gone again, kept for the browser tab instead
	await expect(bo).toHaveURL(EPISODE);
	await expect(bo.locator(".js-together-people")).toHaveText("Du ser med Anna");
	await expect(panel.locator(".js-together-people")).toHaveText("Du ser med Bo");
	return [anna, bo];
}

test("a viewer joins from the link, where the room has got to", async ({browser}) => {
	const anna = await viewer(browser, "Anna");
	await watch(anna, EPISODE);
	await seek(anna, 30);
	await playsPast(anna, 30);
	await anna.getByRole("button", {name: "Se sammen"}).click();
	const link = await anna.getByLabel("Link til at se med").inputValue();
	const bo = await viewer(browser, "Bo");
	await bo.goto(link);
	await playsPast(bo, 30);
	expect(Math.abs(await position(bo) - await position(anna))).toBeLessThan(3);
	await anna.context().close();
	await bo.context().close();
});

test("pausing, playing and skipping happen for both", async ({browser}) => {
	const [anna, bo] = await together(browser);

	await anna.locator("#video").evaluate((video: Video) => video.pause());
	await expect.poll(() => isPaused(bo)).toBe(true);
	await expect(bo.locator("#toast")).toHaveText("Anna satte på pause");

	await seek(anna, 50);
	await expect.poll(async () => Math.round(await position(bo))).toBe(50);
	await expect(bo.locator("#toast")).toHaveText("Anna spolede til 0:50");
	expect(await isPaused(bo)).toBe(true);

	// And the other way round
	await bo.locator("#video").evaluate((video: Video) => video.play());
	await playsPast(anna, 50.5);
	await expect(anna.locator("#toast")).toHaveText("Bo fortsatte");
	expect(Math.abs(await position(bo) - await position(anna))).toBeLessThan(2.5);

	await anna.context().close();
	await bo.context().close();
});

test("reactions show for the others", async ({browser}) => {
	const [anna, bo] = await together(browser);
	await anna.getByRole("button", {name: "Reagér med 👏"}).click();
	await expect(anna.locator(".together-reaction")).toContainText("Dig");
	await expect(bo.locator(".together-reaction")).toContainText("👏");
	await expect(bo.locator(".together-reaction .together-by")).toHaveText("Anna");
	await anna.context().close();
	await bo.context().close();
});

test("the others come along to the next episode", async ({browser}) => {
	const [anna, bo] = await together(browser);
	await anna.locator(".watch-side a").first().click();
	await expect(anna).toHaveURL(NEXT_EPISODE);
	await expect(bo).toHaveURL(NEXT_EPISODE);
	await playsPast(bo, 0.2);
	// Still in the room
	await expect(bo.locator(".js-together-people")).toHaveText("Du ser med Anna");
	await expect(anna.locator(".js-together-people")).toHaveText("Du ser med Bo");
	await anna.context().close();
	await bo.context().close();
});

test("leaving the room tells the others", async ({browser}) => {
	const [anna, bo] = await together(browser);
	await bo.getByRole("button", {name: "Forlad"}).click();
	await expect(bo.getByRole("region", {name: "Se sammen"})).toHaveCount(0);
	await expect(bo.getByRole("button", {name: "Se sammen"})).toBeVisible();
	await expect(anna.locator(".js-together-people")).toHaveText("Kun dig indtil videre. Send linket til dem, du vil se med.");
	// And Bo no longer follows Anna
	await anna.locator("#video").evaluate((video: Video) => video.pause());
	await bo.waitForTimeout(1500);
	expect(await isPaused(bo)).toBe(false);
	await anna.context().close();
	await bo.context().close();
});
