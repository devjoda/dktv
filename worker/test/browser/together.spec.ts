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

/** Anna starts a room, and Bo joins it from her link; Anna's screen as `options` say */
async function together(browser: Browser, options: BrowserContextOptions = {}): Promise<[Page, Page]> {
	const anna = await viewer(browser, "Anna", options);
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

	test("asks a guest to write their name", async ({browser}) => {
		const anna = await viewer(browser, "");
		await watch(anna, EPISODE);
		await anna.getByRole("button", {name: "Se sammen"}).click();
		const hint = anna.locator(".chat-hint");
		await expect(hint).toHaveText("Du hedder Gæst. Skriv dit navn, så de andre kan se, hvem der skriver.");
		await expect(anna.getByRole("region", {name: "Chat"}).getByLabel("Skriv en besked")).toHaveAttribute("placeholder", "Skriv en besked som Gæst");
		await hint.getByRole("button", {name: "Skriv dit navn"}).click();
		await expect(anna.getByLabel("Dit navn")).toBeFocused();
		await anna.getByLabel("Dit navn").fill("Carl");
		await expect(hint).toBeHidden();
		await anna.context().close();
	});

	test("in full screen, writes nothing over the picture, and only counts new messages in a corner", async ({browser}) => {
		const [anna, bo] = await together(browser);
		await fullscreen(anna);
		await write(bo, "Kan du se det?");
		const corner = anna.locator(".chat-corner");
		await expect(corner).toBeVisible();
		await expect(corner).toHaveText("1");
		await write(bo, "Hallo?");
		await expect(corner).toHaveText("2");
		// Nothing of what's written, and nowhere to write, on the picture
		await expect(anna.locator(".plyr")).not.toContainText("Kan du se det?");
		await expect(anna.locator(".plyr .chat-input, .plyr form")).toHaveCount(0);
		// The reactions are still there
		await bo.getByRole("button", {name: "Reagér med 👏"}).click();
		await expect(anna.locator(".plyr .together-reaction")).toContainText("👏");
		// Gone again out of full screen, where the messages can be read
		await anna.evaluate("document.exitFullscreen()");
		await expect(corner).toBeHidden();
		await expect(lines(anna)).toHaveCount(2);
		await fullscreen(anna);
		await expect(corner).toBeHidden();
		await anna.context().close();
		await bo.context().close();
	});
});

test.describe("the room's layout", () => {
	/** Where something is on the page, which must be there */
	const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;
	const noSideways = async (page: Page) => expect(await page.evaluate("document.documentElement.scrollWidth")).toBe(page.viewportSize()!.width);

	/** Long messages from Bo, more than the chat has room for */
	async function fill(page: Page) {
		const input = page.getByRole("region", {name: "Chat"}).getByLabel("Skriv en besked");
		for (let i = 1; i <= 5; i++) {
			await input.fill(`${i}: ${"Det her er en lang besked, som fylder godt i chatten. ".repeat(5)}`);
			await input.press("Enter");
		}
	}

	for (const viewport of [{width: 1366, height: 768}, {width: 1280, height: 800}]) {
		test(`on a ${viewport.width}×${viewport.height} laptop, has the chat beside the video, as high as it, both on the screen`, async ({browser}) => {
			const [anna, bo] = await together(browser, {viewport});
			await fill(bo);
			await expect(anna.locator(".chat-messages .chat-line:not(.is-system)")).toHaveCount(5);
			const video = await box(anna, ".stage");
			const room = await box(anna, ".together");
			expect(room.x).toBeGreaterThanOrEqual(video.x + video.width - 1);
			expect(Math.abs(room.width - 340)).toBeLessThan(2);
			expect(Math.abs(room.y - video.y)).toBeLessThan(2);
			expect(Math.abs(room.height - video.height)).toBeLessThan(2);
			// All of it on the screen, without scrolling the page
			expect(await anna.evaluate("scrollY")).toBe(0);
			expect(room.y + room.height).toBeLessThanOrEqual(viewport.height);
			const field = await box(anna, ".together .chat-form");
			expect(field.y + field.height).toBeLessThanOrEqual(room.y + room.height);
			// The messages scroll in the chat, not the page
			expect(await anna.locator(".chat-scroll").evaluate(e => (e as never as {scrollHeight: number; clientHeight: number}).scrollHeight > (e as never as {clientHeight: number}).clientHeight)).toBe(true);
			// The room's other things, at the top of the column
			for (const selector of [".js-together-people", ".together-share", ".together-name"]) {
				const thing = await box(anna, selector);
				expect(thing.x).toBeGreaterThanOrEqual(room.x);
				expect(thing.y).toBeLessThan(field.y);
			}
			// The title below the video, on the left
			const title = await box(anna, ".watch-title");
			expect(title.y).toBeGreaterThan(video.y + video.height);
			expect(title.x + title.width).toBeLessThan(room.x);
			await noSideways(anna);
			await anna.screenshot({path: test.info().outputPath(`room-${viewport.width}x${viewport.height}.png`)});
			await anna.context().close();
			await bo.context().close();
		});
	}

	test("folds the chat away, which makes the video wide again, counts what's unread, and is remembered", async ({browser}) => {
		const [anna, bo] = await together(browser, {viewport: {width: 1366, height: 768}});
		const narrow = (await box(anna, ".stage")).width;
		await anna.getByRole("button", {name: "Fold chatten væk"}).click();
		await expect(anna.locator(".chat-form")).toBeHidden();
		await expect.poll(async () => (await box(anna, ".stage")).width).toBeGreaterThan(narrow + 250);
		expect(await anna.evaluate(() => localStorage.getItem("togetherChatFolded"))).toBe("true");
		await bo.getByRole("region", {name: "Chat"}).getByLabel("Skriv en besked").fill("Se nu");
		await bo.getByRole("region", {name: "Chat"}).getByLabel("Skriv en besked").press("Enter");
		const unfold = anna.getByRole("button", {name: "Vis chatten, 1 ulæste"});
		await expect(unfold).toBeVisible();
		await expect(unfold.locator(".chat-unread")).toHaveText("1");
		// Still folded on the next page, in the same room
		await anna.reload();
		await expect(anna.getByRole("button", {name: /^Vis chatten/})).toBeVisible();
		await expect(anna.locator(".chat-form")).toBeHidden();
		await anna.getByRole("button", {name: /^Vis chatten/}).click();
		await expect(anna.locator(".chat-form")).toBeVisible();
		await expect(anna.getByRole("button", {name: "Fold chatten væk"}).locator(".chat-unread")).toBeHidden();
		await anna.context().close();
		await bo.context().close();
	});

	test("without a room, the page is as it was: the season's episodes beside the video, and no chat", async ({browser}) => {
		const anna = await viewer(browser, "Anna", {viewport: {width: 1366, height: 768}});
		await watch(anna, EPISODE);
		await expect(anna.locator(".together")).toHaveCount(0);
		const video = await box(anna, ".stage");
		const list = await box(anna, ".episode-list");
		expect(video.width + list.width).toBe(1366);
		expect((await box(anna, ".watch-title")).y).toBeGreaterThan(video.y + video.height);
		await anna.context().close();
	});

	test("on a 1024×768 screen, has the chat right below the video, before the title, scrolling by itself", async ({browser}) => {
		const [anna, bo] = await together(browser, {viewport: {width: 1024, height: 768}});
		await fill(bo);
		const video = await box(anna, ".stage");
		const room = await box(anna, ".together");
		const chat = await box(anna, ".together-chat");
		expect(Math.abs(room.y - (video.y + video.height))).toBeLessThan(2);
		expect(Math.abs(chat.height - 768 * 0.4)).toBeLessThan(2);
		expect((await box(anna, ".watch-title")).y).toBeGreaterThan(room.y + room.height);
		await expect(anna.getByRole("button", {name: "Fold chatten væk"})).toBeHidden();
		await noSideways(anna);
		await anna.screenshot({path: test.info().outputPath("room-1024x768.png")});
		await anna.context().close();
		await bo.context().close();
	});

	test("on a phone held upright, has the chat below the video, filling the rest of the screen", async ({browser}) => {
		const [anna, bo] = await together(browser, {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
		await fill(bo);
		const video = await box(anna, ".stage");
		const room = await box(anna, ".together");
		const tabs = await box(anna, ".tab-bar");
		expect(Math.abs(room.y - (video.y + video.height))).toBeLessThan(2);
		expect(Math.abs(room.y + room.height - tabs.y)).toBeLessThan(3);
		await expect(anna.getByRole("region", {name: "Chat"}).getByLabel("Skriv en besked")).toBeInViewport();
		expect((await box(anna, ".watch-title")).y).toBeGreaterThan(room.y + room.height);
		await noSideways(anna);
		await anna.screenshot({path: test.info().outputPath("room-390x844.png")});
		await anna.context().close();
		await bo.context().close();
	});

	test("on a phone on its side, writes nothing over the picture", async ({browser}) => {
		const [anna, bo] = await together(browser, {viewport: {width: 844, height: 390}, isMobile: true, hasTouch: true});
		await bo.getByRole("region", {name: "Chat"}).getByLabel("Skriv en besked").fill("Hej");
		await bo.getByRole("region", {name: "Chat"}).getByLabel("Skriv en besked").press("Enter");
		await expect(anna.locator(".chat-messages")).toContainText("Hej");
		await expect(anna.locator(".plyr")).not.toContainText("Hej");
		const video = await box(anna, ".stage");
		expect((await box(anna, ".together")).y).toBeGreaterThanOrEqual(video.y + video.height - 1);
		await noSideways(anna);
		await anna.screenshot({path: test.info().outputPath("room-844x390.png")});
		await anna.context().close();
		await bo.context().close();
	});
});
