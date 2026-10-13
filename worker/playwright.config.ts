// The browser tests in test/browser, against the site as `wrangler dev` runs it on this computer,
// with DR's answers from the fixtures and the test video instead of DR's streams.
// A new database for each run, so what one run marked doesn't count in the next.
import {defineConfig, devices} from "@playwright/test";

const PORT = 8799;
const STATE = ".wrangler/browser-tests";
const CONFIG = "test/browser/wrangler.jsonc";

export default defineConfig({
	testDir: "test/browser",
	testMatch: "*.spec.ts",
	timeout: 60_000,
	expect: {timeout: 10_000},
	// One server and one database for all of them
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: process.env.CI ? [["list"], ["github"]] : "list",
	use: {
		baseURL: `http://localhost:${PORT}`,
		...devices["Desktop Chrome"],
		launchOptions: {args: ["--autoplay-policy=no-user-gesture-required"]},
		// The site's service worker keeps pictures; the tests want each page as the server gives it
		serviceWorkers: "block",
		trace: "retain-on-failure",
	},
	webServer: {
		command: `rm -rf ${STATE} && npm run build && wrangler d1 migrations apply dktv-test --local -c ${CONFIG} --persist-to ${STATE}`
			+ ` && wrangler dev -c ${CONFIG} --persist-to ${STATE} --ip 127.0.0.1 --port ${PORT}`,
		url: `http://localhost:${PORT}/konto.json`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {WRANGLER_SEND_METRICS: "false"},
	},
});
