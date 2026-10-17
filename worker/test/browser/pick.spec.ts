// "Vælg for mig": a question at a time about the catalogue, which leaves fewer below it, "Ligeglad", going back, and
// what's picked: by "Overrask mig", or when one is left, with a countdown that can be undone. And "Overrask mig" on a
// category's page.

import type {BrowserContext, Page} from "@playwright/test";
import {expect, playsPast, test} from "./test";

const SHOW = "/rejseholdet_503605/";
const FILM = "/program/lise-noergaard_-ikke-kun-en-pige_362031";

/** A catalogue like /katalog.json's: ten series, the last of them Rejseholdet, which the fixtures have, and ten films */
function pool() {
	const series = Array.from({length: 10}, (_, i) => ({
		id: i == 9 ? "503605" : String(8000 + i),
		t: i == 9 ? "Rejseholdet" : `Serie ${i}`,
		u: i == 9 ? SHOW : `/serie-${i}_${8000 + i}/`,
		k: "serie",
		s: 1 + (i % 2),
		f: i == 9 ? {type: ["serie"], genre: ["drama"], stemning: ["foelelser"], fra: ["udland"]}
			: i < 5 ? {type: ["serie"], genre: ["krimi"], stemning: ["spaending"], fra: [i % 2 ? "dansk" : "udland"]}
				: {type: ["serie"], genre: ["humor"], stemning: ["sjovt"], fra: ["dansk"]},
	}));
	const films = Array.from({length: 10}, (_, i) => ({
		id: i == 0 ? "362031" : String(9000 + i),
		t: i == 0 ? "Lise Nørgaard" : `Film ${i}`,
		u: i == 0 ? FILM : `/program/film-${i}_${9000 + i}`,
		k: "film",
		m: 40 + i * 10,
		f: {type: ["film"], fra: [i % 2 ? "dansk" : "udland"]},
	}));
	return {version: 1, facets: [], titles: [...series, ...films]};
}

/** A viewer whose /katalog.json is pool(), and whose chances are always `random`, so the questions come in one order */
async function picking(context: BrowserContext, random: number) {
	await context.route("**/katalog.json", route => route.fulfill({json: pool()}));
	await context.addInitScript(`Math.random = () => ${random};`);
}

const question = (page: Page) => page.locator(".js-pick-question");
const count = (page: Page) => page.locator(".js-pick-count");
const tiles = (page: Page) => page.locator(".js-pick-tiles .tile:not(.is-leaving)");
const answer = (page: Page, name: string) => page.locator(".pick-answer", {hasText: name});
const result = (page: Page) => page.locator(".js-pick-result");

test("asks serie, film or dokumentar first, and each answer leaves fewer, as the address says, which back goes back through", async ({page, context}) => {
	await picking(context, 0);
	await page.goto("/vaelg/");
	await expect(question(page)).toHaveText("Serie, film eller dokumentar?");
	await expect(count(page)).toHaveText("20 titler passer");
	await expect(tiles(page)).toHaveCount(20);
	// Only the kinds there are
	await expect(page.locator(".pick-answer")).toHaveText([/En serie/, /En film/, "Ligeglad"]);
	await expect(page.locator(".js-pick-back")).toBeHidden();

	// What's still left stays where it was, while the rest goes
	await page.locator(`.js-pick-tiles .tile[data-pick="${SHOW}"]`).evaluate(tile => tile.setAttribute("data-kept", "yes"));
	await answer(page, "En serie").click();
	await expect(page).toHaveURL(/\/vaelg\/\?type=serie$/);
	await expect(count(page)).toHaveText("10 titler passer");
	await expect(tiles(page)).toHaveCount(10);
	await expect(page.locator(`.js-pick-tiles .tile[data-pick="${SHOW}"]`)).toHaveAttribute("data-kept", "yes");
	await expect(page.locator(".js-pick-step")).toHaveText("Spørgsmål 2");
	await expect(question(page)).toHaveText("Skal pulsen op eller ned?");
	// The moods there are, the most first, with how many each leaves
	await expect(page.locator(".pick-answer")).toHaveText([/Nervepirrende\s*5 titler/, /Noget at grine af\s*4 titler/, /Store følelser\s*1 titel/, "Ligeglad"]);

	await answer(page, "Ligeglad").click();
	await expect(page).toHaveURL(/\?type=serie&stemning=ligeglad$/);
	await expect(count(page)).toHaveText("10 titler passer");
	await expect(question(page)).not.toHaveText("Skal pulsen op eller ned?");

	await page.locator(".js-pick-back").click();
	await expect(page).toHaveURL(/\?type=serie$/);
	await expect(question(page)).toHaveText("Skal pulsen op eller ned?");
	await page.goBack();
	await expect(page).toHaveURL(/\?type=serie&stemning=ligeglad$/);
	await page.locator(".js-pick-restart").click();
	await expect(page).toHaveURL(/\/vaelg\/$/);
	await expect(question(page)).toHaveText("Serie, film eller dokumentar?");
});

test("stops asking when few are left, and shows them", async ({page, context}) => {
	await picking(context, 0);
	await page.goto("/vaelg/?type=serie");
	await answer(page, "Nervepirrende").click();
	await expect(question(page)).toHaveText("Her er dine forslag");
	await expect(page.locator(".pick-answer")).toHaveCount(0);
	await expect(count(page)).toHaveText("5 titler passer");
	await expect(tiles(page)).toHaveCount(5);
	await expect(result(page)).toBeHidden();
});

test("when one is left, it starts after a countdown, where its play button would, and that plays", async ({page, context}) => {
	await picking(context, 0);
	await page.goto("/vaelg/?type=serie");
	await answer(page, "Store følelser").click();
	await expect(result(page)).toBeVisible();
	await expect(result(page).locator("#pick-result-title")).toHaveText("Rejseholdet");
	await expect(result(page).locator(".js-pick-countdown")).toHaveText(/Starter om [45] …/);
	// Nothing else to pick
	await expect(result(page).locator(".js-pick-again")).toBeHidden();
	await expect(result(page).locator(".js-pick-go")).toHaveAttribute("href", `${SHOW}#afspil`);
	await expect(page).toHaveURL(/\/rejseholdet_503605\/rejseholdet_\d+$/, {timeout: 15_000});
	await playsPast(page, 0.2);
	// Back goes to Vælg for mig, not to the series' page, which sent it on
	await page.goBack();
	await expect(page).toHaveURL(/\/vaelg\//);
});

test("Overrask mig picks what the viewer hasn't seen, and Fortryd stops it", async ({page, context}) => {
	await picking(context, 0.5);
	await context.addInitScript(`
		for (let i = 1; i < 10; i++) {
			localStorage.setItem("progress_" + (9000 + i), JSON.stringify({time: 0, duration: 3000, watched: true, updated: 1}));
		}
	`);
	await page.goto("/vaelg/?type=film");
	await page.locator(".js-pick-surprise").click();
	await expect(result(page)).toBeVisible();
	await expect(result(page).locator("#pick-result-title")).toHaveText("Lise Nørgaard");
	await expect(result(page).locator(".js-pick-result-kind")).toHaveText("Film");
	await expect(result(page).locator(".js-pick-go")).toHaveAttribute("href", FILM);
	await expect(result(page).locator(".js-pick-go")).toBeFocused();
	await result(page).locator(".js-pick-cancel").click();
	await expect(result(page)).toBeHidden();
	await page.waitForTimeout(6_000);
	await expect(page).toHaveURL(/\/vaelg\/\?type=film$/);
	// Seen ones are last below, and marked
	await expect(tiles(page).first()).toHaveAttribute("data-pick", FILM);
	await expect(tiles(page).last().locator(".js-seen")).toBeVisible();

	// Escape stops it too
	await page.locator(".js-pick-surprise").click();
	await expect(result(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(result(page)).toBeHidden();
	await page.waitForTimeout(6_000);
	await expect(page).toHaveURL(/\/vaelg\/\?type=film$/);
});

test("a category's page has Overrask mig, which picks from its rows, and again picks another", async ({page}) => {
	await page.goto("/kategorier/fiktionsserier/");
	const surprise = page.locator(".page-head .js-pick-surprise");
	await expect(surprise).toBeVisible();
	await surprise.click();
	await expect(result(page)).toBeVisible();
	const first = await result(page).locator("#pick-result-title").textContent();
	const titles = await page.locator(".shelf .tile-title").allTextContents();
	expect(titles.map(t => t.trim())).toContain(first);
	await result(page).locator(".js-pick-again").click();
	await expect(result(page).locator("#pick-result-title")).not.toHaveText(first!);
	await result(page).locator(".js-pick-cancel").click();
	await expect(result(page)).toBeHidden();
});

test("says so when the programmes can't be got", async ({page, context}) => {
	await context.route("**/katalog.json", route => route.fulfill({status: 503, body: ""}));
	await page.goto("/vaelg/");
	await expect(page.locator(".js-pick-loading")).toHaveText("Titlerne kunne ikke hentes lige nu. Prøv igen om lidt.");
	await expect(page.locator(".js-pick")).toBeHidden();
});
