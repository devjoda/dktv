// What the browser tests share: pages that only reach the local server, and ways to watch the video

import {expect, type Page, test as base} from "@playwright/test";

/** The programmes the tests watch, which the fixtures have, along with the test video's times */
export const EPISODE = "/rejseholdet_503605/rejseholdet_503615";
export const EPISODE_ID = "503615";
export const NEXT_EPISODE = "/rejseholdet_503605/rejseholdet_503640";
export const NEXT_EPISODE_ID = "503640";
export const DURATION = 90;
export const INTRO = {start: 5, end: 20};
export const CREDITS = 75;

/** Pages that never reach DR or anywhere else, like DR's pictures; what they asked for is in `requested` */
export const test = base.extend<{requested: string[]}>({
	requested: [async ({context}, use) => {
		const requested: string[] = [];
		await context.route(url => !["localhost", "127.0.0.1"].includes(url.hostname), route => {
			requested.push(route.request().url());
			return route.abort();
		});
		await use(requested);
	}, {auto: true}],
});

export {expect};

/** The page's <video>, as far as the tests need it, since the tests' types are a Worker's, without the DOM's */
export interface Video {
	currentTime: number;
	duration: number;
	paused: boolean;
	play(): Promise<void>;
	pause(): void;
}

/** Where the video is, in seconds */
export const position = (page: Page) => page.locator("#video").evaluate((video: Video) => video.currentTime);

export const isPaused = (page: Page) => page.locator("#video").evaluate((video: Video) => video.paused);

/** Waits for the video to play past `seconds` */
export async function playsPast(page: Page, seconds: number) {
	await expect.poll(() => page.locator("#video").evaluate((video: Video) => video.paused ? 0 : video.currentTime),
		{message: `The video should play past ${seconds} s`}).toBeGreaterThan(seconds);
}

/** Opens a programme's page, and waits for it to play */
export async function watch(page: Page, path: string) {
	await page.goto(path);
	await playsPast(page, 0.2);
}

/** Moves the video to `seconds`, as the viewer would */
export async function seek(page: Page, seconds: number) {
	await page.locator("#video").evaluate((video: Video, to) => { video.currentTime = to; }, seconds);
}

/** A new account, like /sync/ makes, for marking intros and credits */
export async function newAccount(page: Page): Promise<string> {
	const response = await page.request.post("/sync/");
	expect(response.status()).toBe(201);
	return (await response.json()).code;
}

/** Marks the intro or the credits of a video, as an account */
export async function mark(page: Page, video: string, kind: "intro" | "credits", start: number, end: number) {
	const response = await page.request.post(`/spring/${video}`, {
		data: {code: await newAccount(page), kind, start, end, duration: DURATION, source: "marked"},
	});
	expect(response.status()).toBe(201);
}
