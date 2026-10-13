// "Se sammen": two viewers, each in a browser of their own, watching the test video together

import type {Browser, BrowserContextOptions, Page} from "@playwright/test";
import {EPISODE, expect, isPaused, NEXT_EPISODE, playsPast, position, seek, test, type Video, watch} from "./test";

/** A viewer with a browser of their own, which only reaches the local server */
async function viewer(browser: Browser, name: string, options: BrowserContextOptions = {}): Promise<Page> {
	const context = await browser.newContext(options);
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
	await anna.getByRole("link", {name: /Næste afsnit/}).click();
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

test.describe("the chat", () => {
	/** Writes a message in the room's panel, as a viewer would */
	async function write(page: Page, text: string) {
		const input = page.getByRole("region", {name: "Chat"}).getByLabel("Skriv en besked");
		await input.fill(text);
		await input.press("Enter");
		await expect(input).toHaveValue("");
	}

	const lines = (page: Page) => page.locator(".chat-messages .chat-line:not(.is-system)");

	const inFullscreen = (page: Page) => page.evaluate("document.fullscreenElement?.classList.contains('plyr') ?? false");

	/** Into full screen with the player's own shortcut, which works without a screen, unlike its button */
	async function fullscreen(page: Page) {
		await page.locator("body").click({position: {x: 5, y: 5}});
		await page.keyboard.press("f");
		await expect.poll(() => inFullscreen(page)).toBe(true);
	}

	test("messages go both ways, with who wrote them and where the video was, the viewer's own as theirs", async ({browser}) => {
		const [anna, bo] = await together(browser);
		await expect(anna.locator(".chat-line.is-system")).toHaveText(["Bo kom ind"]);
		await write(anna, "Hvem er han?");
		await expect(lines(bo)).toHaveCount(1);
		await expect(lines(bo).first().locator(".chat-name")).toHaveText("Anna");
		await expect(lines(bo).first().locator(".chat-text")).toHaveText("Hvem er han?");
		await expect(lines(bo).first().locator(".chat-time")).toHaveText(/^\d+:\d\d$/);
		await expect(lines(bo).first()).not.toHaveClass(/is-mine/);
		await expect(lines(anna).first()).toHaveClass(/is-mine/);
		await expect(lines(anna).first().locator(".chat-name")).toHaveText("Dig");

		await write(bo, "Det er IP");
		await expect(lines(anna)).toHaveCount(2);
		await expect(lines(anna).nth(1)).toContainText("Bo");
		await expect(lines(anna).nth(1)).toContainText("Det er IP");
		// In the same order for both
		expect(await lines(anna).locator(".chat-text").allTextContents()).toEqual(await lines(bo).locator(".chat-text").allTextContents());
		await anna.context().close();
		await bo.context().close();
	});

	test("shows text as text, and no links", async ({browser}) => {
		const [anna, bo] = await together(browser);
		await write(anna, '<img src=x onerror="alert(1)"> https://example.com');
		await expect(lines(bo).first().locator(".chat-text")).toHaveText('<img src=x onerror="alert(1)"> https://example.com');
		await expect(bo.locator(".chat-messages img, .chat-messages a")).toHaveCount(0);
		await anna.context().close();
		await bo.context().close();
	});

	test("the player's keyboard shortcuts don't react while writing", async ({browser}) => {
		const [anna, bo] = await together(browser);
		// They do otherwise
		await anna.locator("body").click({position: {x: 5, y: 5}});
		await seek(anna, 30);
		await playsPast(anna, 30);
		await anna.keyboard.press("ArrowRight");
		await expect.poll(() => position(anna)).toBeGreaterThan(44);

		const input = anna.getByRole("region", {name: "Chat"}).getByLabel("Skriv en besked");
		await input.click();
		const before = await position(anna);
		for (const key of ["Space", "ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "f", "m", "k", "c", "l", "j", "0", "5", "Home", "End"]) {
			await input.press(key);
		}
		await input.pressSequentially(" Fem mand ");
		expect(await isPaused(anna)).toBe(false);
		expect(await anna.locator("#video").evaluate((video: Video & {muted: boolean}) => video.muted)).toBe(false);
		expect(await anna.evaluate("document.fullscreenElement === null")).toBe(true);
		const after = await position(anna);
		expect(after).toBeGreaterThanOrEqual(before);
		expect(after - before).toBeLessThan(5);
		await expect(input).toHaveValue(/ fmkclj05 Fem mand $/);
		// Nor while writing one's name
		const name = anna.getByLabel("Dit navn");
		await name.click();
		await name.press("Space");
		await name.press("ArrowLeft");
		expect(await isPaused(anna)).toBe(false);
		await anna.context().close();
		await bo.context().close();
	});

	test("those who join later read the last messages", async ({browser}) => {
		const anna = await viewer(browser, "Anna");
		await watch(anna, EPISODE);
		await anna.getByRole("button", {name: "Se sammen"}).click();
		await expect(anna.getByRole("region", {name: "Chat"})).toContainText("Beskederne gemmes ikke, når rummet lukker.");
		await write(anna, "Er der nogen?");
		const link = await anna.getByLabel("Link til at se med").inputValue();
		const bo = await viewer(browser, "Bo");
		await bo.goto(link);
		await expect(lines(bo)).toHaveCount(1);
		await expect(lines(bo).first()).toContainText("Er der nogen?");
		await anna.context().close();
		await bo.context().close();
	});

	test("counts what's unread while the chat is folded away, and stops when it's open", async ({browser}) => {
		const [anna, bo] = await together(browser);
		const chat = anna.getByRole("region", {name: "Chat"});
		await chat.getByRole("button", {name: "Skjul chat"}).click();
		await expect(chat.locator(".chat-messages")).toBeHidden();
		await write(bo, "Se nu");
		await write(bo, "Nu!");
		const toggle = chat.getByRole("button", {name: "Vis chat, 2 ulæste"});
		await expect(toggle).toBeVisible();
		await expect(toggle.locator(".chat-unread")).toHaveText("2");
		await toggle.click();
		await expect(lines(anna)).toHaveCount(2);
		await expect(chat.locator(".chat-toggle .chat-unread")).toBeHidden();
		await anna.context().close();
		await bo.context().close();
	});

	test("asks a guest to write their name", async ({browser}) => {
		const anna = await viewer(browser, "");
		await watch(anna, EPISODE);
		await anna.getByRole("button", {name: "Se sammen"}).click();
		const hint = anna.locator(".chat-hint");
		await expect(hint).toHaveText("Du hedder Gæst. Skriv dit navn, så de andre kan se, hvem der skriver.");
		await hint.getByRole("button", {name: "Skriv dit navn"}).click();
		await expect(anna.getByLabel("Dit navn")).toBeFocused();
		await anna.getByLabel("Dit navn").fill("Carl");
		await expect(hint).toBeHidden();
		await anna.context().close();
	});

	test("in full screen, shows new messages on the picture, and has a field to write in", async ({browser}) => {
		const [anna, bo] = await together(browser);
		await fullscreen(anna);
		await write(bo, "Kan du se det?");
		await expect(anna.locator(".chat-float-line")).toContainText("Kan du se det?");
		await expect(anna.locator(".chat-float-line .chat-name")).toHaveText("Bo");
		const button = anna.getByRole("button", {name: "Skriv i chatten"});
		await button.click();
		const field = anna.locator(".chat-picture-form .chat-input");
		await expect(field).toBeFocused();
		await field.press("f");
		await field.press("Space");
		expect(await inFullscreen(anna)).toBe(true);
		expect(await isPaused(anna)).toBe(false);
		await field.fill("Ja!");
		await field.press("Enter");
		await expect(lines(bo).last()).toContainText("Ja!");
		await field.press("Escape");
		await expect(anna.locator(".chat-picture-form")).toBeHidden();
		await anna.context().close();
		await bo.context().close();
	});

	test("can be kept off the picture, which is remembered", async ({browser}) => {
		const [anna, bo] = await together(browser);
		await anna.getByLabel("Skjul chat på billedet").check();
		expect(await anna.evaluate(() => localStorage.getItem("togetherChatOnPicture"))).toBe("off");
		await fullscreen(anna);
		await write(bo, "Hallo?");
		await expect(anna.getByRole("button", {name: "Skriv i chatten"}).locator(".chat-unread")).toHaveText("1");
		await expect(anna.locator(".chat-float-line")).toHaveCount(0);
		await anna.context().close();
		await bo.context().close();
	});

	test("on a phone held upright, is always open below the video", async ({browser}) => {
		const anna = await viewer(browser, "Anna", {viewport: {width: 384, height: 830}, isMobile: true, hasTouch: true});
		await watch(anna, EPISODE);
		await anna.getByRole("button", {name: "Se sammen"}).click();
		const chat = anna.getByRole("region", {name: "Chat"});
		await expect(chat.getByLabel("Skriv en besked")).toBeVisible();
		await expect(chat.locator(".chat-toggle")).toBeHidden();
		const video = (await anna.locator("#video").boundingBox())!;
		expect((await chat.boundingBox())!.y).toBeGreaterThan(video.y + video.height);
		// Within the screen's width
		expect(await anna.evaluate("document.documentElement.scrollWidth")).toBe(384);
		await anna.context().close();
	});

	test("doesn't move on the picture for those who'd rather not have motion", async ({browser}) => {
		const [anna, bo] = await together(browser);
		await anna.emulateMedia({reducedMotion: "reduce"});
		await fullscreen(anna);
		await write(bo, "Stille");
		await expect(anna.locator(".chat-float-line")).toHaveCount(1);
		expect(await anna.evaluate("getComputedStyle(document.querySelector('.chat-float-line')).animationName")).toBe("none");
		await anna.context().close();
		await bo.context().close();
	});
});
