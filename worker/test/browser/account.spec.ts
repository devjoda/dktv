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
	const toggle = page.getByLabel("Hjælp med at markere intro og rulletekster");
	await expect(toggle).not.toBeChecked();
	await toggle.check();
	expect(await page.evaluate(() => localStorage.getItem("contribute"))).toBe("true");
	await page.reload();
	await expect(page.getByLabel("Hjælp med at markere intro og rulletekster")).toBeChecked();
	await page.getByLabel("Hjælp med at markere intro og rulletekster").uncheck();
	expect(await page.evaluate(() => localStorage.getItem("contribute"))).toBeNull();
});

test("turns notifications on and off on this device, and only asks for permission after a click", async ({page, context}) => {
	// The browser's notifications, which ask for permission, and its push service, as stand-ins
	await context.addInitScript(`
		let permission = "default";
		window.permissionAsked = 0;
		let subscription = null;
		Object.defineProperty(Notification, "permission", {get: () => permission});
		Notification.requestPermission = async () => {
			window.permissionAsked++;
			permission = "granted";
			return permission;
		};
		const pushManager = {
			getSubscription: async () => subscription,
			subscribe: async () => {
				subscription = {endpoint: "https://push.example/1", toJSON: () => ({endpoint: "https://push.example/1", keys: {p256dh: "a", auth: "b"}}), unsubscribe: async () => { subscription = null; return true; }};
				return subscription;
			},
		};
		Object.defineProperty(navigator, "serviceWorker", {value: {ready: Promise.resolve({pushManager}), register: async () => ({})}});
	`);
	await page.route("**/konto.json", route => route.fulfill({json: {push: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U", passkeys: true}}));
	const pushed: string[] = [];
	await page.route("**/push/*", route => {
		pushed.push(route.request().method());
		return route.fulfill({status: route.request().method() == "POST" ? 201 : 204, json: {}});
	});
	await page.goto("/sync/");
	const section = page.getByRole("region", {name: "Notifikationer på denne enhed"});
	// What it adds to the bell, which is there either way
	await expect(section).toContainText("Klokken viser altid nye afsnit her på siden.");
	const on = section.getByRole("button", {name: "Slå notifikationer til"});
	expect(await page.evaluate("window.permissionAsked")).toBe(0);
	await on.click();
	await expect(section.getByRole("button", {name: "Slå notifikationer fra"})).toBeVisible();
	expect(await page.evaluate("window.permissionAsked")).toBe(1);
	expect(pushed).toEqual(["POST"]);
	await section.getByRole("button", {name: "Slå notifikationer fra"}).click();
	await expect(on).toBeVisible();
	expect(pushed).toEqual(["POST", "DELETE"]);
});

test("offers notifications nowhere else", async ({page}) => {
	await page.route("**/konto.json", route => route.fulfill({json: {push: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U"}}));
	await page.goto("/rejseholdet_503605/");
	await page.locator(".hero .js-favorite").click();
	// Kept, before going on
	await expect(page.locator(".hero .js-favorite")).toHaveAttribute("aria-pressed", "true");
	await page.goto("/favoritter/");
	await expect(page.locator(".tile")).toHaveCount(1);
	await expect(page.getByText("Vil du have besked om nye afsnit?")).toHaveCount(0);
	await expect(page.getByRole("button", {name: /notifikationer|besked/})).toHaveCount(0);
});
