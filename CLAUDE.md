# dktv

An unofficial frontend for DRTV. The interface is in Danish; reply in Danish when the user writes Danish.

## Layout

- `worker/`: the site, a Cloudflare Worker (Hono, TypeScript), deployed as `dktv` at
  https://dktv.joachim-144.workers.dev. New work happens here.
- `drtvrss/`: the original Python app (Quart), with its tests in `tests/`.
- Both use the browser files in `drtvrss/static`, which `npm run build` copies to `worker/public`.
  When a page changes, change `worker/src/views` and `drtvrss/templates` alike, so both stay the same.
- The catalogue of all of DR's titles (`worker/src/catalogue.ts`, `drtvrss/catalogue.py`) is made from DR's list from A
  to Å, with the filters in `drtvrss/facets.json`, which both read. What the browser gets of each title, its entry, is
  made in `worker/src/entries.ts`; the cron makes them all again after an update that changes the code that makes them,
  in that file or in what it uses of others, or the filters (`worker/scripts/catalogue-version.mjs`), so keep the
  cron's own code out of it. Vælg for mig, Alle titler, the search field's suggestions, Hvad nu? and the front page's
  own rows use it, as `/katalog.json`.

## Tests

- Worker: `cd worker && npm test`, and `npm run check` for types. They use a fake D1 on `node:sqlite` and
  fixtures of DR's answers, so they need no network.
- Browser: `npm run test:browser` runs `test/browser/*.spec.ts` in Playwright's Chromium against `wrangler dev`
  with `test/browser/wrangler.jsonc`: DR's answers from the fixtures, and the test video in `test/browser/video`
  instead of DR's streams (`npm run dev:test` for trying it by hand). `/testkatalog` there runs the catalogue's cron
  through the fixtures' letters of DR's list. That server only answers on localhost,
  and `player.js` only plays the test video there; keep it so, and never deploy that config.
  `npm run test-video` makes the video again, with ffmpeg; it's VP9, since Playwright's Chromium has no H.264.
- Python: `uv run pytest` (or `nix develop --command pytest`). Tests against DR itself need `DRTV_LIVE_TESTS=1`.
- Both make the same entries of the catalogue, which `tests/fixtures/catalogue_entries.json` holds: after changing the
  filters, write it again with `UPDATE_ENTRIES=1 npm test`, and check that `uv run pytest` agrees.
- Run both before committing a change to `drtvrss/static`.

## The free Cloudflare plan

The site must stay on the free plan, which allows 10 ms of CPU per request (and per cron run, every minute),
50 subrequests per request (Cache API calls count), 100k requests a day, and D1 at 5M reads and 100k writes a day.

- Pages are written with the `html` tag in `worker/src/views/html.ts`, since Hono's JSX was too slow.
- Each visit does little: pages and DR's data are kept in Cloudflare's cache (`worker/src/cache.ts`),
  a visit refreshes at most two stale things, and a request budget (`Budget` in `worker/src/dr.ts`) leaves the rest.
- The cron (`worker/src/alerts.ts`) does at most 6 units of work per run.
- The catalogue's cron (`worker/src/catalogue.ts`) runs every minute, on two schedules of its own, of the even minutes
  and the odd, and each run does one kind of work, each first in turn: a step of the day's sweep of DR's list, a few
  titles looked up, or some entries made, writing only what changed, as D1's limits are the whole site's. Each run
  starts cold on Cloudflare, where it costs three to four times what it does in a fresh Node process: keep each kind
  mostly under 2.5 ms there, and check its `cpuTime` in `wrangler tail`, which logs the kind as "The catalogue's run:
  …". What's heavy, like choosing the front page's rows, the database does.
- `npm run bench` measures CPU in Node; after deploying, `wrangler tail dktv --format json` shows the real `cpuTime`,
  which needs a Cloudflare login, so only the user's machine can run it.

## Deploying

What reaches `main` deploys the site: `.github/workflows/worker.yml` runs the Worker's tests, then
`npm run deploy`, which applies new D1 migrations in `worker/migrations` and deploys. Only GitHub has the Cloudflare
token, so nothing else needs it.

- Work on a branch of your own, where the same tests run without deploying, and open a pull request to `main`.
  The user merges it.
- After a merge, follow the run with `gh api "repos/devjoda/dktv/actions/runs?branch=main&per_page=3"`,
  and when it's done, check the change on https://dktv.joachim-144.workers.dev.
- A migration can't be undone by deploying again: make them only add tables and columns.
- Say in a pull request when it makes the catalogue's entries again, which `worker/src/catalogue-version.json` shows
  after `npm run build`, on `main` and on the branch: once it's deployed, the cron makes all of them again, over up to
  about 9 hours, and Alle titler has old and new ones meanwhile.

## Rules

- Never commit secrets. The private push key is only the Cloudflare secret `VAPID_PRIVATE_KEY` and `worker/.dev.vars`,
  which git ignores.
- Deploy only to workers.dev, never to another domain.
- Serve every library and font from the site itself: no CDNs, no Google Fonts, no tracking.
- The site is called Flimmerkassen (`SERVICE_NAME`): its logo is Flimmer in Schibsted Grotesk, with a small box, the
  kassen, for the i's dot, and `worker/scripts/icons.py` draws the favicon and the app's icons, that i, from that font.
- DR and DRTV are only named in the footer and on the privacy page: the site is its own brand, not DR's.
- Keep to the look: warm white on ink, Schibsted Grotesk, the programmes' pictures for colour, red only for live and
  progress. No all-caps labels, and no meta joined with " · ".
- Commits: `feat:`, `fix:`, `perf:`, `test:` or `docs:`, then what the change does for viewers, in a sentence.
  Keep messages about the code. Author: `devjoda <dev.joda@proton.me>`.

## Cloud sessions

`.claude/hooks/cloud-setup.sh` installs the dependencies when a cloud session starts.
The cloud machine isn't in Denmark, and DR only streams video to Denmark, so videos don't play there.
DR's API and pictures may answer from abroad; the tests don't need them.

- Don't take a refused stream, or an error from DR, for a bug in the site.
- Pages, layout and anything without video can be checked in a headless browser in the cloud.
- The player, skipping intros, Se sammen and progress can be checked with the test video: cover them with
  browser tests. What needs DR's own streams (their quality, subtitles and live channels) can only be checked in
  Denmark: end the session with a short list, in Danish, of what the user should try on their own machine.
- Don't run `npm run deploy` or other `wrangler` commands that need an account: there's no token, and pushing deploys.
