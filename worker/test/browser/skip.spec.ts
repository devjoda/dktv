// Skipping intros, going on as the credits start, and marking them, with the test video

import type {Page} from "@playwright/test";
import {CREDITS, EPISODE, EPISODE_ID, expect, INTRO, mark, newAccount, NEXT_EPISODE, NEXT_EPISODE_ID, playsPast, position, seek, test, watch} from "./test";

test.describe("with the intro and credits marked by two accounts", () => {
	test.beforeAll(async ({browser}) => {
		const page = await browser.newPage();
		for (let i = 0; i < 2; i++) {
			await mark(page, NEXT_EPISODE_ID, "intro", INTRO.start, INTRO.end);
			await mark(page, NEXT_EPISODE_ID, "credits", CREDITS, 90);
		}
		await page.close();
	});

	test("the page has them", async ({page}) => {
		await page.goto(NEXT_EPISODE);
		const segments = JSON.parse((await page.locator("#video").getAttribute("data-segments"))!);
		expect(segments).toEqual({intro: {start: INTRO.start, end: INTRO.end}, credits: {fromEnd: 90 - CREDITS}});
	});

	test("offers to skip the intro only while it plays, and skips it", async ({page}) => {
		await watch(page, NEXT_EPISODE);
		const skip = page.getByRole("button", {name: "Spring intro over"});
		await expect(skip).toBeHidden();
		await seek(page, INTRO.start + 1);
		await expect(skip).toBeVisible();
		await skip.click();
		await playsPast(page, INTRO.end);
		await expect(skip).toBeHidden();
		// The intro's over, so it isn't offered again
		await seek(page, INTRO.start + 1);
		await playsPast(page, INTRO.start + 1.5);
		await expect(skip).toBeHidden();
	});

	test("goes back when the viewer finds it wrong", async ({page}) => {
		await watch(page, NEXT_EPISODE);
		await seek(page, INTRO.start + 2);
		await page.getByRole("button", {name: "Spring intro over"}).click();
		await playsPast(page, INTRO.end);
		const wrong = page.getByRole("button", {name: "Forkert?"});
		await expect(wrong).toBeVisible();
		await wrong.click();
		await expect.poll(() => position(page)).toBeLessThan(INTRO.start + 4);
		await expect(page.locator("#toast")).toHaveText("Tak. Introen springes ikke over her mere");
		await expect(wrong).toHaveCount(0);
	});

	test("only offers \"Forkert?\" for a few seconds", async ({page}) => {
		await watch(page, NEXT_EPISODE);
		await seek(page, INTRO.start + 1);
		await page.getByRole("button", {name: "Spring intro over"}).click();
		await expect(page.getByRole("button", {name: "Forkert?"})).toBeVisible();
		await expect(page.getByRole("button", {name: "Forkert?"})).toHaveCount(0, {timeout: 8000});
	});

	test("offers the next episode as the credits start", async ({page}) => {
		await watch(page, NEXT_EPISODE);
		await seek(page, CREDITS - 2);
		await expect(page.locator("#up-next")).toBeHidden();
		await playsPast(page, CREDITS + 0.5);
		await expect(page.locator("#up-next")).toBeVisible();
		await expect(page.locator("#up-next")).toContainText("Næste afsnit");
	});
});

test("doesn't offer to skip what isn't marked", async ({page}) => {
	await watch(page, EPISODE);
	await seek(page, INTRO.start + 1);
	await playsPast(page, INTRO.start + 2);
	await expect(page.getByRole("button", {name: "Spring intro over"})).toBeHidden();
});

/** A viewer with an account, who chose to mark intros and credits, or not, on their account's page */
async function withAccount(page: Page, contribute: boolean) {
	const code = await newAccount(page);
	await page.addInitScript(([code, contribute]) => {
		localStorage.setItem("syncCode", code);
		if (contribute) {
			localStorage.setItem("contribute", "true");
		}
	}, [code, contribute] as const);
}

test("lets a viewer who chose to mark the intro do it on the video, and then skip it", async ({page}) => {
	await withAccount(page, true);
	await watch(page, EPISODE);
	await page.getByRole("button", {name: "Markér intro og rulletekster"}).click();
	const panel = page.getByRole("region", {name: "Markér intro og rulletekster"});
	await expect(panel).toBeVisible();
	// On the video, so both can be seen at once
	const video = (await page.locator("#video").boundingBox())!;
	const box = (await panel.boundingBox())!;
	expect(box.y).toBeGreaterThanOrEqual(video.y);
	expect(box.y + box.height).toBeLessThanOrEqual(video.y + video.height);
	await expect(page.locator("#video")).toBeInViewport({ratio: 0.9});
	await seek(page, INTRO.start);
	await panel.getByRole("button", {name: "Introen starter nu"}).click();
	await seek(page, INTRO.end);
	await panel.getByRole("button", {name: "Introen slutter nu"}).click();
	await expect(panel.locator(".marking-time").nth(0)).toHaveText("0:05.0");
	const saved = page.waitForResponse(response => response.url().endsWith(`/spring/${EPISODE_ID}`));
	await panel.getByRole("button", {name: "Gem introen"}).click();
	expect((await saved).status()).toBe(201);
	await expect(page.locator("#toast")).toHaveText("Tak! Introen er markeret");
	await panel.getByRole("button", {name: "Luk"}).click();
	await expect(panel).toHaveCount(0);
	// Their own mark counts for them right away
	await seek(page, INTRO.start + 1);
	await expect(page.getByRole("button", {name: "Spring intro over"})).toBeVisible();
	await page.reload();
	await playsPast(page, 0.2);
	await seek(page, INTRO.start + 1);
	await expect(page.getByRole("button", {name: "Spring intro over"})).toBeVisible();
});

test("doesn't offer marking to those who didn't choose it", async ({page}) => {
	await withAccount(page, false);
	await watch(page, EPISODE);
	await expect(page.getByRole("button", {name: "Se sammen"})).toBeVisible();
	await expect(page.getByRole("button", {name: "Markér intro og rulletekster"})).toHaveCount(0);
});

test.describe("on a phone", () => {
	test.use({viewport: {width: 384, height: 830}, isMobile: true, hasTouch: true});

	test("doesn't offer marking, even to those who chose it", async ({page}) => {
		await withAccount(page, true);
		await watch(page, EPISODE);
		await expect(page.getByRole("button", {name: "Se sammen"})).toBeVisible();
		await expect(page.getByRole("button", {name: "Markér intro og rulletekster"})).toHaveCount(0);
	});
});

test("never asks whether the viewer skipped the intro", async ({page}) => {
	await withAccount(page, true);
	await watch(page, EPISODE);
	await playsPast(page, 3.5);
	await seek(page, 35);
	await page.waitForTimeout(5000);
	await expect(page.getByText("Sprang du introen over?")).toHaveCount(0);
});
