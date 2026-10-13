// The account's page: choosing to mark intros and credits, and deleting the account only when meant

import {expect, newAccount, test} from "./test";

test.beforeEach(async ({page}) => {
	const code = await newAccount(page);
	await page.addInitScript(code => localStorage.getItem("syncCode") ?? localStorage.setItem("syncCode", code), code);
});

test("asks twice before deleting the account, and can be cancelled", async ({page}) => {
	await page.goto("/sync/");
	const code = await page.evaluate(() => localStorage.getItem("syncCode"));
	await page.getByRole("button", {name: "Slet din konto"}).click();
	const confirm = page.getByRole("alertdialog", {name: "Slet din konto?"});
	await expect(confirm).toBeVisible();
	await expect(confirm).toContainText("Det kan ikke fortrydes");
	const yes = confirm.getByRole("button", {name: "Slet kontoen for altid"});
	await expect(yes).toBeDisabled();
	await confirm.getByRole("button", {name: "Annullér"}).click();
	await expect(confirm).toBeHidden();

	// Nothing was deleted
	expect((await page.request.post(`/sync/${code}`, {data: {}})).status()).toBe(200);
	await page.getByRole("button", {name: "Slet din konto"}).click();
	await expect(yes).toBeDisabled();
	await confirm.getByLabel("Jeg forstår, at kontoen ikke kan gendannes").check();
	const deleted = page.waitForResponse(response => response.request().method() == "DELETE");
	await yes.click();
	expect((await deleted).status()).toBe(204);
	await expect(page.locator("#toast")).toHaveText("Din konto er slettet");
	await expect(page.getByRole("button", {name: "Opret en konto"})).toBeVisible();
	expect((await page.request.post(`/sync/${code}`, {data: {}})).status()).toBe(404);
});

test("lets the viewer choose to mark intros and credits", async ({page}) => {
	await page.goto("/sync/");
	const toggle = page.getByLabel("Bidrag med intro og rulletekster");
	await expect(toggle).not.toBeChecked();
	await toggle.check();
	expect(await page.evaluate(() => localStorage.getItem("contribute"))).toBe("true");
	await page.reload();
	await expect(page.getByLabel("Bidrag med intro og rulletekster")).toBeChecked();
	await page.getByLabel("Bidrag med intro og rulletekster").uncheck();
	expect(await page.evaluate(() => localStorage.getItem("contribute"))).toBeNull();
});
