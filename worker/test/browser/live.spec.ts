// Live TV, with the test video for every channel: Direkte, changing channels in the same player, the guide, and keys

import type {BrowserContextOptions, Page} from "@playwright/test";
import {expect, playsPast, test, type Video} from "./test";

type Sound = Video & {volume: number; muted: boolean};

const sound = (page: Page) => page.locator("#video").evaluate((video: Sound) => ({volume: Math.round(video.volume * 100) / 100, muted: video.muted}));
const guideLink = (page: Page, name: string) => page.locator(".channel-guide").getByRole("link", {name: new RegExp(`^${name}`)});

/** Where the test video was asked for, for which channel */
function streams(page: Page): string[] {
	const asked: string[] = [];
	page.on("request", request => {
		const url = new URL(request.url());
		if (url.pathname == "/testvideo/video.m3u8") {
			asked.push(url.searchParams.get("kanal")!);
		}
	});
	return asked;
}

/** Marks the page, to tell whether a new one was loaded since */
const mark = (page: Page) => page.evaluate("window.samePage = true");
const samePage = (page: Page) => page.evaluate("window.samePage === true");

test("Direkte opens DR1 the first time, and the channel watched last after that", async ({page, context}) => {
	await page.goto("/");
	await page.locator(".site-nav").getByRole("link", {name: "Direkte"}).click();
	await expect(page).toHaveURL("/live/DR1");
	await page.goto("/live/EVA");
	await playsPast(page, 0.2);
	const [cookie] = (await context.cookies()).filter(c => c.name == "lastChannel");
	expect(cookie).toMatchObject({value: "EVA", path: "/live", sameSite: "Lax", secure: true});
	expect(cookie.expires * 1000 - Date.now()).toBeGreaterThan(360 * 24 * 60 * 60 * 1000);
	await page.goto("/");
	await page.locator(".site-nav").getByRole("link", {name: "Direkte"}).click();
	await expect(page).toHaveURL("/live/EVA");
	// And from the row of channels on the front page
	await page.goto("/");
	await page.locator(".shelf .channel-tile a[href='/live/TVR']").click();
	await expect(page).toHaveURL("/live/TVR");
	await page.goto("/live/");
	await expect(page).toHaveURL("/live/TVR");
});

test("changing channel keeps the sound, in the same player, and changes the address in place", async ({page, context}) => {
	const asked = streams(page);
	await page.goto("/live/DR1");
	await playsPast(page, 0.2);
	await page.locator("#video").evaluate((video: Sound) => { video.volume = 0.4; video.muted = false; });
	await mark(page);
	await guideLink(page, "DR2").click();
	await expect(page).toHaveURL("/live/DR2");
	await expect(page.locator(".js-live-title")).toHaveText("DR2");
	await expect(page).toHaveTitle("DR2 - Flimmerkassen");
	await expect(guideLink(page, "DR2")).toHaveAttribute("aria-current", "page");
	await expect(guideLink(page, "DR1")).not.toHaveAttribute("aria-current");
	await expect.poll(() => asked).toContain("DR2");
	await playsPast(page, 0.2);
	expect(await sound(page)).toEqual({volume: 0.4, muted: false});
	expect(await samePage(page)).toBe(true);
	expect((await context.cookies()).find(c => c.name == "lastChannel")!.value).toBe("DR2");
	// The volume is remembered for the next page
	await page.reload();
	await playsPast(page, 0.2);
	expect((await sound(page)).volume).toBe(0.4);
});

test("going back leaves live TV, instead of going through the channels", async ({page}) => {
	await page.goto("/");
	await page.locator(".shelf .channel-tile a[href='/live/DR1']").click();
	await expect(page).toHaveURL("/live/DR1");
	await playsPast(page, 0.2);
	await guideLink(page, "DR2").click();
	await expect(page).toHaveURL("/live/DR2");
	await guideLink(page, "TVA Live").click();
	await expect(page).toHaveURL("/live/EVA");
	await page.goBack();
	await expect(page).toHaveURL("/");
});

test("1 to 4, Page Up and Page Down change channel, like a remote, but not while writing", async ({page}) => {
	const asked = streams(page);
	await page.goto("/live/DR1");
	await playsPast(page, 0.2);
	await mark(page);
	await page.locator("body").click({position: {x: 5, y: 5}});
	await page.keyboard.press("2");
	await expect(page).toHaveURL("/live/DR2");
	await page.keyboard.press("4");
	await expect(page).toHaveURL("/live/TVR");
	await page.keyboard.press("PageUp");
	await expect(page).toHaveURL("/live/EVA");
	await page.keyboard.press("PageDown");
	await expect(page).toHaveURL("/live/TVR");
	// Round again at the end
	await page.keyboard.press("PageDown");
	await expect(page).toHaveURL("/live/DR1");
	expect(await samePage(page)).toBe(true);
	expect(asked).toEqual(["DR1", "DR2", "TVR", "EVA", "TVR", "DR1"]);
	// The player doesn't move along the stream on numbers here
	await playsPast(page, 0.5);
	const before = await page.locator("#video").evaluate((video: Video) => video.currentTime);
	await page.keyboard.press("9");
	expect(await page.locator("#video").evaluate((video: Video) => video.currentTime)).toBeLessThan(before + 5);
	await expect(page).toHaveURL("/live/DR1");
	// Nor change channel while writing
	await page.getByRole("combobox", {name: "Søg"}).fill("");
	await page.getByRole("combobox", {name: "Søg"}).press("3");
	await expect(page.getByRole("combobox", {name: "Søg"})).toHaveValue("3");
	await expect(page).toHaveURL("/live/DR1");
});

test("the arrows up and down still change the volume", async ({page}) => {
	await page.goto("/live/DR1");
	await playsPast(page, 0.2);
	await page.locator("#video").evaluate((video: Sound) => { video.volume = 0.5; });
	await page.locator("body").click({position: {x: 5, y: 5}});
	await page.keyboard.press("ArrowDown");
	await expect.poll(async () => (await sound(page)).volume).toBeLessThan(0.5);
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("ArrowUp");
	await expect.poll(async () => (await sound(page)).volume).toBeGreaterThan(0.5);
	await expect(page).toHaveURL("/live/DR1");
});

test("a channel opens in a new tab with Ctrl", async ({page, context}) => {
	await page.goto("/live/DR1");
	await playsPast(page, 0.2);
	const [tab] = await Promise.all([context.waitForEvent("page"), guideLink(page, "DR2").click({modifiers: ["Control"]})]);
	await expect(tab).toHaveURL("/live/DR2");
	await expect(page).toHaveURL("/live/DR1");
});

test("says what it changes to, and what went wrong with a channel, with a way to try again", async ({page}) => {
	await page.goto("/live/DR1");
	await playsPast(page, 0.2);
	let failing = true;
	await page.route(url => url.pathname == "/testvideo/video.m3u8" && url.searchParams.get("kanal") == "EVA", route =>
		failing ? route.fulfill({status: 500, body: "Nej"}) : route.continue());
	await guideLink(page, "TVA Live").click();
	const message = page.locator(".player-message");
	await expect(message).toContainText("Kunne ikke vise TVA Live.");
	await expect(message.getByRole("button", {name: "Prøv igen"})).toBeVisible();
	failing = false;
	await message.getByRole("button", {name: "Prøv igen"}).click();
	await expect(message).toBeHidden();
	await playsPast(page, 0.2);
	// While another channel loads
	await page.route(url => url.pathname == "/testvideo/video.m3u8" && url.searchParams.get("kanal") == "DR2", async route => {
		await new Promise(resolve => setTimeout(resolve, 1500));
		await route.continue();
	});
	await guideLink(page, "DR2").click();
	// The spinner films have, and the change said to screen readers
	await expect(page.locator(".player-loading")).toBeVisible();
	await expect(message).toBeHidden();
	await expect(page.getByRole("status").filter({hasText: "Skifter til DR2"})).toHaveCount(1);
	await expect(page.locator(".player-loading")).toBeHidden({timeout: 10_000});
});

test("plays without sound when the browser won't have it, with a button to turn it on", async ({page}) => {
	// A browser that won't play sound before the viewer has clicked on the page
	await page.addInitScript(`
		const play = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function () {
			if (!this.muted && !window.clicked) {
				return Promise.reject(new DOMException("Not yet", "NotAllowedError"));
			}
			return play.call(this);
		};
		addEventListener("pointerdown", () => { window.clicked = true; }, true);
	`);
	await page.goto("/live/DR1");
	await playsPast(page, 0.2);
	expect((await sound(page)).muted).toBe(true);
	const unmute = page.getByRole("button", {name: "Slå lyden til"}).first();
	await expect(unmute).toBeVisible();
	await page.locator("#unmute").click();
	await expect(page.locator("#unmute")).toHaveCount(0);
	expect((await sound(page)).muted).toBe(false);
	// Which counts as the viewer's own choice, and the browser's refusal didn't, once the browser says the sound changed
	await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("sound") ?? "null")?.muted)).toBe(false);
	// The sound stays on when changing channel
	await guideLink(page, "DR2").click();
	await playsPast(page, 0.2);
	expect((await sound(page)).muted).toBe(false);
});

test("the guide keeps up with the schedule by itself, and asks for more when it runs out", async ({page}) => {
	await page.clock.install();
	const asked: string[] = [];
	page.on("request", request => request.url().includes("/live/plan.json") && asked.push(request.url()));
	await page.goto("/live/DR1");
	const now = guideLink(page, "DR1").locator(".guide-now");
	const before = await now.textContent();
	// Hours later, with no new page
	await page.clock.fastForward("04:00:00");
	await page.clock.runFor(31_000);
	await expect(now).not.toHaveText(before!);
	await expect.poll(() => asked.length).toBeGreaterThan(0);
});

test("folds the guide away, which is remembered", async ({page}) => {
	await page.setViewportSize({width: 1366, height: 768});
	await page.goto("/live/DR1");
	const narrow = (await page.locator(".stage").boundingBox())!.width;
	await page.getByRole("button", {name: "Fold kanalerne væk"}).click();
	await expect.poll(async () => (await page.locator(".stage").boundingBox())!.width).toBe(1366);
	const stage = (await page.locator(".stage").boundingBox())!;
	expect((await page.locator(".channel-guide").boundingBox())!.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
	expect(narrow).toBeLessThan(1100);
	await page.reload();
	await expect(page.getByRole("button", {name: "Vis kanalerne ved siden af"})).toBeVisible();
	expect((await page.locator(".stage").boundingBox())!.width).toBe(1366);
});

test.describe("on every screen", () => {
	const sizes: [number, number][] = [[1366, 768], [1280, 800], [1024, 768], [390, 844], [844, 390]];
	for (const [width, height] of sizes) {
		for (const folded of [false, true]) {
			test(`${width}×${height}${folded ? ", folded away" : ""}: the channels are there, without scrolling sideways`, async ({browser}) => {
				const phone = width < 900 && (width < 500 || height < 500);
				const options: BrowserContextOptions = {viewport: {width, height}, isMobile: phone, hasTouch: phone};
				const context = await browser.newContext(options);
				await context.route(url => !["localhost", "127.0.0.1"].includes(url.hostname), route => route.abort());
				if (folded) {
					await context.addInitScript(() => localStorage.setItem("liveGuideFolded", "true"));
				}
				const page = await context.newPage();
				await page.goto("/live/DR1");
				await playsPast(page, 0.2);
				expect(await page.evaluate("document.documentElement.scrollWidth")).toBe(width);
				const stage = (await page.locator(".stage").boundingBox())!;
				const guide = (await page.locator(".channel-guide").boundingBox())!;
				const beside = width >= 1100 && !folded;
				if (beside) {
					// Beside the video, as high as it, both on the screen
					expect(Math.abs(guide.x - (stage.x + stage.width))).toBeLessThan(2);
					expect(Math.abs(guide.height - stage.height)).toBeLessThan(2);
					expect(guide.y + guide.height).toBeLessThanOrEqual(height);
				} else {
					// A row below the video, before the title
					expect(guide.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
					expect((await page.locator(".js-live-title").boundingBox())!.y).toBeGreaterThan(guide.y + guide.height);
					const links = await page.locator(".guide-channel").evaluateAll(links => links.map(link => (link as never as {getBoundingClientRect(): {y: number}}).getBoundingClientRect().y));
					expect(new Set(links.map(Math.round)).size).toBe(1);
					// On the screen without scrolling, except a phone on its side, where the video comes first
					if (!(phone && height < 500)) {
						expect(guide.y + guide.height).toBeLessThanOrEqual(height - (width < 900 ? 64 : 0));
					}
				}
				await page.screenshot({path: test.info().outputPath(`live-${width}x${height}${folded ? "-folded" : ""}.png`)});
				await context.close();
			});
		}
	}
});

test("watching together on a channel: the chat beside the video, the channels below it, and channels changed for all", async ({browser}) => {
	const viewer = async (name: string) => {
		const context = await browser.newContext({viewport: {width: 1366, height: 768}});
		await context.route(url => !["localhost", "127.0.0.1"].includes(url.hostname), route => route.abort());
		await context.addInitScript(name => localStorage.setItem("togetherName", name), name);
		return context.newPage();
	};
	const anna = await viewer("Anna");
	await anna.goto("/live/DR1");
	await playsPast(anna, 0.2);
	await anna.getByRole("button", {name: "Se sammen"}).click();
	const link = await anna.getByLabel("Link til at se med").inputValue();
	const bo = await viewer("Bo");
	const asked = streams(bo);
	await bo.goto(link);
	await playsPast(bo, 0.2);
	await expect(bo.locator(".js-together-people")).toHaveText("Du ser med Anna");
	const stage = (await anna.locator(".stage").boundingBox())!;
	const chat = (await anna.locator(".together").boundingBox())!;
	const guide = (await anna.locator(".channel-guide").boundingBox())!;
	expect(chat.x).toBeGreaterThanOrEqual(stage.x + stage.width - 1);
	expect(guide.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
	expect(guide.x + guide.width).toBeLessThanOrEqual(chat.x + 1);
	await mark(bo);
	await guideLink(anna, "DR2").click();
	await expect(anna).toHaveURL("/live/DR2");
	await expect(bo).toHaveURL("/live/DR2");
	await expect(bo.locator(".js-live-title")).toHaveText("DR2");
	expect(await samePage(bo)).toBe(true);
	await expect.poll(() => asked).toContain("DR2");
	// And the other way round, with the keys
	await bo.locator("body").click({position: {x: 5, y: 5}});
	await bo.keyboard.press("3");
	await expect(anna).toHaveURL("/live/EVA");
	await anna.screenshot({path: test.info().outputPath("live-together-1366x768.png")});
	await anna.context().close();
	await bo.context().close();
});
