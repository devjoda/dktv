// The header and the tabs: every section can be reached, on a phone as on a computer

import {expect, test} from "./test";

test.describe("on a phone", () => {
	test.use({viewport: {width: 384, height: 830}, isMobile: true, hasTouch: true});

	test("has tabs at the bottom, all of them on the screen, instead of the header's sections", async ({page}) => {
		await page.goto("/privatliv/");
		await expect(page.locator(".site-nav")).toBeHidden();
		await expect(page.getByRole("link", {name: "GLOTV, forsiden"}).first()).toBeVisible();
		const tabs = page.locator(".tab-bar .tab");
		await expect(tabs).toHaveText(["Forside", "Direkte", "Kategorier", "Søg", "Favoritter"]);
		for (const tab of await tabs.all()) {
			await expect(tab).toBeInViewport({ratio: 1});
		}
		// Always as high, whatever the browser's own toolbars do
		expect((await page.locator(".tab-bar").boundingBox())!.height).toBe(64);
		// The end of the page isn't hidden under them
		await page.keyboard.press("End");
		await expect.poll(() => page.evaluate("Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight")).toBe(true);
		const footer = await page.locator(".footer-links").boundingBox();
		const bar = await page.locator(".tab-bar").boundingBox();
		expect(footer!.y + footer!.height).toBeLessThanOrEqual(bar!.y);
	});

	test("goes where the tabs say", async ({page}) => {
		await page.goto("/privatliv/");
		await page.locator(".tab-bar").getByRole("link", {name: "Favoritter"}).click();
		await expect(page).toHaveURL("/favoritter/");
		await expect(page.locator(".tab-bar").getByRole("link", {name: "Favoritter"})).toHaveAttribute("aria-current", "page");
		await page.locator(".tab-bar").getByRole("link", {name: "Forside"}).click();
		await expect(page).toHaveURL("/");
	});
});

for (const width of [900, 1024, 1180, 1440]) {
	test(`shows all of the header's sections, ${width} pixels wide`, async ({page}) => {
		await page.setViewportSize({width, height: 700});
		await page.goto("/privatliv/");
		await expect(page.locator(".tab-bar")).toBeHidden();
		const sections = page.locator(".site-nav .nav-item");
		await expect(sections).toHaveText(["Direkte", "Serier", "Film", "Dokumentar", "Kategorier", "Favoritter"]);
		for (const section of await sections.all()) {
			await expect(section).toBeInViewport({ratio: 1});
		}
		await expect(page.getByRole("link", {name: "Søg"}).or(page.getByRole("search")).first()).toBeVisible();
		await expect(page.getByRole("link", {name: "Din konto"}).first()).toBeVisible();
		await expect(page.locator(".js-bell")).toBeInViewport({ratio: 1});
	});
}

test("puts the episode before on the left, and the one after on the right", async ({page}) => {
	await page.setViewportSize({width: 1280, height: 800});
	await page.goto("/rejseholdet_503605/rejseholdet_503640");
	const previous = (await page.getByRole("link", {name: /Forrige afsnit/}).boundingBox())!;
	const next = (await page.getByRole("link", {name: /Næste afsnit/}).boundingBox())!;
	expect(previous.x + previous.width).toBeLessThan(next.x);
	expect(Math.abs(previous.y - next.y)).toBeLessThan(2);
	// Below what plays, along the same left edge
	const title = (await page.locator(".watch-title").boundingBox())!;
	expect(Math.abs(previous.x - title.x)).toBeLessThan(2);
});

test.describe("an episode on a phone", () => {
	test.use({viewport: {width: 384, height: 830}, isMobile: true, hasTouch: true});

	test("has the next episode first", async ({page}) => {
		await page.goto("/rejseholdet_503605/rejseholdet_503640");
		const previous = (await page.getByRole("link", {name: /Forrige afsnit/}).boundingBox())!;
		const next = (await page.getByRole("link", {name: /Næste afsnit/}).boundingBox())!;
		expect(next.y + next.height).toBeLessThanOrEqual(previous.y);
	});
});
