// The catalogue in the browser: Alle titler, with its filters, the search field's suggestions as the viewer types,
// the page of what DR doesn't have any more, and the front page's later rows as it's scrolled down to them.
// The catalogue's cron goes through the fixtures' letters of DR's list from A to Å first, with /testkatalog.

import {expect, test} from "./test";

test.beforeAll(async ({request}) => {
	const status = await (await request.get("/testkatalog")).json();
	expect(status.titles).toBe(5);
});

const tiles = (page: import("@playwright/test").Page) => page.locator(".js-explore-tiles .tile");

test("Alle titler has all of the catalogue, and each filter says how many it leaves, as the address does", async ({page}) => {
	await page.goto("/alle/");
	await expect(page.locator(".js-explore-count")).toHaveText("5 titler");
	await expect(tiles(page)).toHaveCount(5);
	const series = page.locator('.explore-facet .filter-button[data-facet="type"][data-value="serie"]');
	await expect(series).toHaveText(/Serier\s*3/);
	await series.click();
	await expect(page).toHaveURL(/\/alle\/\?type=serie$/);
	await expect(page.locator(".js-explore-count")).toHaveText("3 titler");
	await expect(series).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator(".js-explore-tiles .tile-title")).toContainText(["Matador"]);
	// What's chosen, to take away again
	const chosen = page.locator(".chosen-filter");
	await expect(chosen).toHaveText(["Serier"]);
	await chosen.click();
	await expect(page).toHaveURL(/\/alle\/$/);
	await expect(page.locator(".js-explore-count")).toHaveText("5 titler");

	// Finding a title, or a person in it
	await page.locator(".js-explore-search").fill("mynster");
	await expect(page.locator(".js-explore-count")).toHaveText("1 titel");
	await expect(page.locator(".js-explore-tiles .tile-title")).toHaveText(["Madame Ida"]);
	await expect(page).toHaveURL(/\?q=mynster$/);

	// Back where it was
	await page.goto("/alle/?type=serie&sorter=titel");
	await expect(page.locator(".js-explore-tiles .tile-title")).toHaveText(["Maria Wern", "Matador", "Rejseholdet"]);
	await expect(page.locator(".js-explore-sort")).toHaveValue("titel");
	await page.goBack();
	await expect(page).toHaveURL(/\?q=mynster$/);
});

test("the search field suggests titles and what they're about as the viewer types, and Enter goes to the one chosen", async ({page}) => {
	await page.goto("/kategorier/");
	const field = page.locator(".header-search input");
	await field.fill("mata");
	const suggestions = page.locator(".header-search .search-suggestions");
	await expect(suggestions).toBeVisible();
	await expect(field).toHaveAttribute("aria-expanded", "true");
	await expect(suggestions.locator(".suggestion").first()).toContainText("Matador");
	// Searching DR, with its episodes, is still there, last
	await expect(suggestions.locator(".suggestion-all")).toContainText("Søg efter „mata“");
	await field.press("ArrowDown");
	await expect(suggestions.locator(".suggestion").first()).toHaveAttribute("aria-selected", "true");
	await field.press("Enter");
	await expect(page).toHaveURL(/\/matador_540736\/$/);

	await page.goto("/kategorier/");
	await field.fill("mata");
	await expect(suggestions).toBeVisible();
	await field.press("Escape");
	await expect(suggestions).toBeHidden();
	// Enter without choosing one searches DR, as before
	await field.press("Enter");
	await expect(page).toHaveURL(/\/search\/\?query=mata$/);
});

test("what DR doesn't have any more says so, with something else of its kind that DR's editors chose", async ({page, context}) => {
	await context.route("**/katalog.json", route => route.fulfill({json: {version: 1, facets: [], titles: [
		{id: "1", t: "En serie", u: "/en-serie_1/", k: "serie", i: "http://localhost/a.jpg", f: {type: ["serie"], udvalgt: ["Store danske serier"]}},
		{id: "2", t: "En film", u: "/program/en-film_2", k: "film", i: "http://localhost/b.jpg", f: {type: ["film"], udvalgt: ["Filmfavoritter"]}},
		{id: "3", t: "Ikke valgt", u: "/ikke-valgt_3/", k: "serie", i: "http://localhost/c.jpg", f: {type: ["serie"]}},
	]}}));
	const response = await page.goto("/findes-ikke_1/");
	expect(response!.status()).toBe(404);
	await expect(page.locator("h1")).toHaveText("Kan ikke længere ses");
	const suggestions = page.locator(".js-gone-suggestions");
	await expect(suggestions).toBeVisible();
	await expect(suggestions.locator(".tile-title")).toHaveText(["En serie"]);
});

test("the front page gets DR's later rows as it's scrolled down to them, a part at a time", async ({page}) => {
	const asked: string[] = [];
	await page.route("**/raekker/?fra=*", route => {
		asked.push(new URL(route.request().url()).searchParams.get("fra")!);
		const more = asked.length == 1 ? '<div class="more-rows js-more-rows" data-from="15" aria-hidden="true"></div>' : "";
		return route.fulfill({contentType: "text/html", body: `<section class="shelf" aria-labelledby="row-${asked.length + 8}">
<div class="shelf-head"><h2 class="shelf-title" id="row-${asked.length + 8}">Senere række ${asked.length}</h2></div>
<div class="shelf-track"></div>
</section>${more}`});
	});
	await page.goto("/");
	expect(asked).toEqual([]);
	await page.locator(".site-footer").scrollIntoViewIfNeeded();
	await expect(page.getByRole("heading", {name: "Senere række 1"})).toBeVisible();
	await page.locator(".site-footer").scrollIntoViewIfNeeded();
	await expect(page.getByRole("heading", {name: "Senere række 2"})).toBeVisible();
	expect(asked).toEqual(["8", "15"]);
	await expect(page.locator(".js-more-rows")).toHaveCount(0);
});

test("Vælg for mig's answers have pictures of what they lead to", async ({page, context}) => {
	const titles = Array.from({length: 12}, (_, i) => ({
		id: String(100 + i), t: `Serie ${i}`, u: `/serie-${i}_${100 + i}/`, k: "serie", i: `http://localhost/${i}.jpg`,
		f: {type: ["serie"], stemning: [i % 2 ? "sjovt" : "spaending"]},
	}));
	await context.route("**/katalog.json", route => route.fulfill({json: {version: 1, facets: [], titles}}));
	await context.addInitScript("Math.random = () => 0;");
	await page.goto("/vaelg/?type=serie");
	await expect(page.locator(".js-pick-question")).toHaveText("Skal pulsen op eller ned?");
	await expect(page.locator('.pick-answer[data-answer="spaending"] .pick-answer-pictures img')).toHaveCount(3);
	await expect(page.locator('.pick-answer[data-answer="ligeglad"] .pick-answer-pictures')).toHaveCount(0);
});
