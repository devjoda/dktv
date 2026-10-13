// The player, with the test video instead of DR's stream

import {DURATION, EPISODE, EPISODE_ID, expect, isPaused, NEXT_EPISODE, playsPast, position, seek, test, type Video, watch} from "./test";

test("plays the test video, with Plyr's controls and the subtitles", async ({page, requested}) => {
	const videos: string[] = [];
	page.on("request", request => request.url().includes("/testvideo/") && videos.push(new URL(request.url()).pathname));
	await watch(page, EPISODE);
	await expect(page.locator(".plyr")).toBeVisible();
	await expect(page.locator(".plyr__controls")).toBeAttached();
	await expect(page.locator(".alert")).toHaveCount(0);
	expect(await page.locator("#video").evaluate((video: Video) => Math.round(video.duration))).toBe(DURATION);
	await expect(page.locator("#video track")).toHaveAttribute("src", "/testvideo/subtitles.vtt");
	expect(videos).toContain("/testvideo/video.m3u8");
	expect(videos).toContain("/testvideo/video.mp4");
	// Never DR's stream, nor a token for it; only DR's pictures, which the tests leave out
	expect(requested.filter(url => /^https:\/\/(isl|production-cdn)\.dr-massive\.com\//.test(url))).toEqual([]);
});

test("pauses, and plays again, with Plyr's button", async ({page}) => {
	await watch(page, EPISODE);
	// Plyr hides its controls while the video plays, until the mouse moves over it
	await page.locator(".plyr").hover();
	await page.locator('.plyr__controls [data-plyr="play"]').click();
	await expect.poll(() => isPaused(page)).toBe(true);
	const at = await position(page);
	await page.locator('.plyr__controls [data-plyr="play"]').click();
	await playsPast(page, at + 0.5);
});

test("skips 15 seconds with the arrow keys", async ({page}) => {
	await watch(page, EPISODE);
	await seek(page, 30);
	await playsPast(page, 30);
	await page.locator("body").press("ArrowRight");
	await expect.poll(() => position(page)).toBeGreaterThanOrEqual(45);
	await page.locator("body").press("ArrowLeft");
	await expect.poll(() => position(page)).toBeLessThan(40);
});

test("starts where a shared link says", async ({page}) => {
	await page.goto(`${EPISODE}?t=40`);
	await playsPast(page, 40);
	expect(await position(page)).toBeLessThan(45);
});

test("continues where the viewer got to, a little before", async ({page}) => {
	await watch(page, EPISODE);
	await seek(page, 60);
	await playsPast(page, 60);
	await page.locator("#video").evaluate((video: Video) => video.pause());
	await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem("progress_" + id) ?? "null")?.time ?? 0, EPISODE_ID)).toBeGreaterThan(60);
	await page.reload();
	await playsPast(page, 44);
	expect(await position(page)).toBeLessThan(55);
});

test("offers the next episode as the video ends, and plays it", async ({page}) => {
	await watch(page, EPISODE);
	await seek(page, DURATION - 2);
	const upNext = page.locator("#up-next");
	await expect(upNext).toBeVisible();
	await expect(upNext).toContainText("2. episode");
	await expect(upNext).toContainText(/Starter om \d+ sek\./);
	await upNext.getByRole("link", {name: "Afspil nu"}).click();
	await expect(page).toHaveURL(NEXT_EPISODE);
	await playsPast(page, 0.2);
});

test("lets the viewer watch the end, when they cancel the next episode", async ({page}) => {
	await watch(page, EPISODE);
	await seek(page, DURATION - 2);
	await page.locator("#up-next").getByRole("button", {name: "Annullér"}).click();
	await expect(page.locator("#up-next")).toHaveCount(0);
	await page.waitForTimeout(11_000);
	await expect(page).toHaveURL(EPISODE);
});

test("never plays the test video anywhere but on this computer", async ({page, requested}) => {
	// The local server's page, as if it came from another site
	await page.route("http://dktv.test/**", async route => {
		const url = new URL(route.request().url());
		const response = await route.fetch({url: `http://localhost:${new URL(test.info().project.use.baseURL!).port}${url.pathname}${url.search}`});
		await route.fulfill({response});
	});
	const videos: string[] = [];
	page.on("request", request => request.url().includes("/testvideo/") && videos.push(request.url()));
	await page.goto(`http://dktv.test${EPISODE}`);
	await expect(page.locator("#video")).toHaveAttribute("data-test-stream", /testvideo/);
	// It asks DR, which can't be reached here
	await expect(page.locator(".alert")).toContainText("Kunne ikke indlæse videoen");
	expect(requested.some(url => url.startsWith("https://isl.dr-massive.com/"))).toBe(true);
	expect(videos).toEqual([]);
});

test("isn't served to any other site", async ({request}) => {
	const response = await request.get(EPISODE, {headers: {Host: "dktv.joachim-144.workers.dev"}});
	expect(response.status()).toBe(403);
});
