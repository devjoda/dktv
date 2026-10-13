// Skipping intros, going on as the credits start, and marking them, with the test video

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

test("lets a viewer with an account mark the intro, which they can then skip", async ({page}) => {
	const code = await newAccount(page);
	await page.addInitScript(code => localStorage.setItem("syncCode", code), code);
	await watch(page, EPISODE);
	await page.getByRole("button", {name: "Markér intro og rulletekster"}).click();
	const panel = page.getByRole("region", {name: "Markér intro og rulletekster"});
	await expect(panel).toBeVisible();
	const intro = panel.locator(".marking-group").filter({hasText: "Intro"});
	await seek(page, INTRO.start);
	await intro.locator(".marking-row").filter({hasText: "Start"}).getByRole("button", {name: "Nu"}).click();
	await seek(page, INTRO.end);
	await intro.locator(".marking-row").filter({hasText: "Slut"}).getByRole("button", {name: "Nu"}).click();
	const saved = page.waitForResponse(response => response.url().endsWith(`/spring/${EPISODE_ID}`));
	await intro.getByRole("button", {name: "Gem introen"}).click();
	expect((await saved).status()).toBe(201);
	await expect(page.locator("#toast")).toHaveText("Tak! Introen er markeret");
	await panel.getByRole("button", {name: "Luk"}).click();
	// Their own mark counts for them right away
	await seek(page, INTRO.start + 1);
	await expect(page.getByRole("button", {name: "Spring intro over"})).toBeVisible();
	await page.reload();
	await playsPast(page, 0.2);
	await seek(page, INTRO.start + 1);
	await expect(page.getByRole("button", {name: "Spring intro over"})).toBeVisible();
});

test("asks a viewer with an account who skips ahead early whether it was the intro", async ({page}) => {
	const code = await newAccount(page);
	await page.addInitScript(code => localStorage.setItem("syncCode", code), code);
	await watch(page, EPISODE);
	await playsPast(page, 3.5);
	const from = await position(page);
	await seek(page, from + 30);
	const ask = page.getByRole("status").filter({hasText: "Sprang du introen over?"});
	await expect(ask).toBeVisible({timeout: 10_000});
	const saved = page.waitForResponse(response => response.url().endsWith(`/spring/${EPISODE_ID}`));
	await ask.getByRole("button", {name: "Ja"}).click();
	expect((await saved).status()).toBe(201);
	await expect(page.locator("#toast")).toHaveText("Tak! Det hjælper andre med at springe den over");
});
