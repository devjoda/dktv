// The season's episodes beside the video on wide screens, like on YouTube, and biograftilstand, which makes the
// video wide, with the episodes below it

import type {Page} from "@playwright/test";
import {EPISODE, expect, NEXT_EPISODE, playsPast, test, watch} from "./test";

const FILM_PAGE = "/program/lise-noergaard_-ikke-kun-en-pige_362031";

const list = (page: Page) => page.getByRole("complementary", {name: "Sæson 1"});
const cinema = (page: Page) => page.locator(".plyr__controls .js-cinema");

test.describe("on a wide screen", () => {
	test.use({viewport: {width: 1440, height: 900}});

	test("has the season's episodes beside the video, with the one playing, which play in the same page", async ({page}) => {
		await watch(page, EPISODE);
		await expect(list(page)).toBeVisible();
		const video = (await page.locator(".stage").boundingBox())!;
		const box = (await list(page).boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(video.x + video.width - 1);
		expect(box.height).toBeCloseTo(video.height, 0);
		const playing = list(page).locator('[aria-current="page"]');
		await expect(playing).toHaveAttribute("href", EPISODE);
		await expect(playing).toContainText("Spiller nu");
		await page.evaluate("window.samePage = true");
		await list(page).getByRole("link", {name: /2\. episode/}).click();
		await expect(page).toHaveURL(NEXT_EPISODE);
		await playsPast(page, 0.3);
		expect(await page.evaluate("window.samePage === true")).toBe(true);
		await expect(list(page).locator('[aria-current="page"]')).toHaveAttribute("href", NEXT_EPISODE);
	});

	test("biograftilstand makes the video wide, with the episodes below, and is remembered", async ({page}) => {
		await watch(page, EPISODE);
		const before = (await page.locator(".stage").boundingBox())!;
		await expect(cinema(page)).toHaveAttribute("aria-pressed", "false");
		// Plyr hides its controls while the video plays, until the mouse moves over it
		await page.locator(".plyr").hover();
		await cinema(page).click();
		await expect(cinema(page)).toHaveAttribute("aria-pressed", "true");
		const after = (await page.locator(".stage").boundingBox())!;
		expect(after.width).toBeGreaterThan(before.width);
		expect(after.width).toBeCloseTo(1440, 0);
		const box = (await list(page).boundingBox())!;
		expect(box.y).toBeGreaterThan(after.y + after.height);
		await page.reload();
		await expect(page.locator("body")).toHaveClass(/cinema/);
		await expect(cinema(page)).toHaveAttribute("aria-pressed", "true");
		// And off again, with T
		await page.keyboard.press("t");
		await expect(page.locator("body")).not.toHaveClass(/cinema/);
		expect(await page.evaluate(`localStorage.getItem("cinema")`)).toBe("false");
	});

	test("a film has no list, but biograftilstand", async ({page}) => {
		await watch(page, FILM_PAGE);
		await expect(page.locator(".episode-list")).toHaveCount(0);
		await expect(cinema(page)).toBeVisible();
	});

	test("T isn't biograftilstand while typing", async ({page}) => {
		await watch(page, EPISODE);
		await page.evaluate(`document.querySelector(".watch").append(Object.assign(document.createElement("input"), {id: "typing"}))`);
		await page.locator("#typing").fill("tt");
		await expect(page.locator("body")).not.toHaveClass(/cinema/);
	});
});

test.describe("on a phone", () => {
	test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});

	test("has the episodes below what plays, and no biograftilstand", async ({page}) => {
		await watch(page, EPISODE);
		const watchBox = (await page.locator(".watch").boundingBox())!;
		const box = (await list(page).boundingBox())!;
		expect(box.y).toBeGreaterThan(watchBox.y);
		await expect(cinema(page)).toBeHidden();
		expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
	});
});
