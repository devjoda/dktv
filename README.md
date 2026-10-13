# dktv

An unofficial frontend for [DRTV](https://www.dr.dk/drtv), the streaming service of DR, the Danish Broadcasting Corporation.

> **Not affiliated with DR.** This project isn't made, endorsed or supported by DR. DR and DRTV are DR's trademarks.
> The programmes, pictures and descriptions are DR's, and come straight from DR's own services; none of them are hosted here.

## What it does

- Series, films and documentaries, with DR's own categories and rows, and search
- Live TV, with what's on now and later, and subtitles
- Picks up where you left off, and marks what you've seen
- Favourite series and films
- An account without email or password: a code, which syncs favourites and progress between your devices
- Logging in on your other devices with a passkey, and notifications when a favourite series gets a new episode
- An RSS feed for each series, at `/<series>.xml`

What you watch and your favourites are kept in your browser, and only on the server if you make an account.
There's no tracking, and the libraries and fonts are served from the site itself.

## Based on

This project is based on [drtvrss](https://github.com/RasmusRendal/drtvrss) by Rasmus Rendal,
which started as a way to get RSS feeds for DRTV's series, and grew into a frontend in the style of Invidious.

## Running it

It runs as a [Cloudflare Worker](https://developers.cloudflare.com/workers/), in [`worker`](worker):

```
$ cd worker
$ npm install
$ npm run dev
```

`npm test` runs its tests, and `npm run deploy` puts it on Cloudflare. Notifications need a key pair:
the public key in `wrangler.jsonc`, and the private one as the secret `VAPID_PRIVATE_KEY`.

DR only streams to Denmark. `npm run dev:test` runs the site on your own computer with a test video instead of
DR's streams, and DR's answers from the tests' fixtures, so the player can be tried anywhere; it only answers on
localhost, and is never deployed. `npm run test:browser` tests the player, skipping intros and watching together
with it, in Playwright's Chromium.

It also runs as a Python app, with `uv run hypercorn drtvrss:app`, or with Nix, `nix develop` and then
`hypercorn drtvrss:app`, though without passkeys and notifications. Its tests run with `pytest`. Both use
the same scripts and styles in the browser, from [`drtvrss/static`](drtvrss/static).

## Licence

[AGPL-3.0](LICENSE.md). The libraries and fonts in [`drtvrss/static/vendor`](drtvrss/static/vendor) have their own licences,
listed in [its README](drtvrss/static/vendor/README.md).
