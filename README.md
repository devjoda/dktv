# drtvrss

An unofficial frontend for [DRTV](https://www.dr.dk/drtv), the streaming service of DR, the Danish Broadcasting Corporation.

> **Not affiliated with DR.** This project isn't made, endorsed or supported by DR. DR and DRTV are DR's trademarks.
> The programmes, pictures and descriptions are DR's, and come straight from DR's own services; none of them are hosted here.

## What it does

- Series, films and documentaries, with DR's own categories and rows, and search
- Live TV, with what's on now and later, and subtitles
- Picks up where you left off, and marks what you've seen
- Favourite series and films
- Syncing favourites and progress between your devices, with a code
- An RSS feed for each series, at `/<series>.xml`

What you watch and your favourites are kept in your browser, and only on the server if you set up syncing.
There's no tracking, and the libraries and fonts are served from the site itself.

## Based on

This project is based on [drtvrss](https://github.com/RasmusRendal/drtvrss) by Rasmus Rendal,
which started as a way to get RSS feeds for DRTV's series, and grew into a frontend in the style of Invidious.

## Running it

```
$ uv run hypercorn drtvrss:app
```

Or with Nix, `nix develop`, and then `hypercorn drtvrss:app`. The tests run with `pytest`.

## Licence

[AGPL-3.0](LICENSE.md). The libraries and fonts in [`drtvrss/static/vendor`](drtvrss/static/vendor) have their own licences,
listed in [its README](drtvrss/static/vendor/README.md).
