# dktv

An unofficial frontend for DRTV. The interface is in Danish; reply in Danish when the user writes Danish.

## Layout

- `worker/`: the site, a Cloudflare Worker (Hono, TypeScript) on the `workers` branch, deployed as `dktv` at
  https://dktv.joachim-144.workers.dev. New work happens here.
- `drtvrss/`: the original Python app (Quart), with its tests in `tests/`. It stays the app on `main`.
- Both use the browser files in `drtvrss/static`, which `npm run build` copies to `worker/public`.
  When a page changes, change `worker/src/views` and `drtvrss/templates` alike, so both stay the same.

## Tests

- Worker: `cd worker && npm test`, and `npm run check` for types. They use a fake D1 on `node:sqlite` and
  fixtures of DR's answers, so they need no network.
- Python: `uv run pytest` (or `nix develop --command pytest`). Tests against DR itself need `DRTV_LIVE_TESTS=1`.
- Run both before committing a change to `drtvrss/static`.

## The free Cloudflare plan

The site must stay on the free plan, which allows 10 ms of CPU per request (and per cron run, every minute),
50 subrequests per request (Cache API calls count), 100k requests a day, and D1 at 5M reads and 100k writes a day.

- Pages are written with the `html` tag in `worker/src/views/html.ts`, since Hono's JSX was too slow.
- Each visit does little: pages and DR's data are kept in Cloudflare's cache (`worker/src/cache.ts`),
  a visit refreshes at most two stale things, and a request budget (`Budget` in `worker/src/dr.ts`) leaves the rest.
- The cron (`worker/src/alerts.ts`) does at most 6 units of work per run.
- `npm run bench` measures CPU in Node; after deploying, `wrangler tail dktv --format json` shows the real `cpuTime`.

## Rules

- Never commit secrets. The private push key is only the Cloudflare secret `VAPID_PRIVATE_KEY` and `worker/.dev.vars`,
  which git ignores.
- Deploy only to workers.dev, never to another domain.
- `cd worker && npm run deploy` applies the D1 migrations in `worker/migrations`, then deploys.
- Serve every library and font from the site itself: no CDNs, no Google Fonts, no tracking.
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
- What needs a playing video (the player, skipping intros, Se sammen, progress) can only be checked in Denmark:
  cover it with tests where you can, and end the session with a short list, in Danish, of what the user should
  try on their own machine.
- Don't deploy from a cloud session.
