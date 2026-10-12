# Public Service
Originally written just so I could get an RSS feed for my favourite DRTV shows.
Feature creep resulted in building an invidious-like frontend.

An instance is hosted at https://drtv.rend.al

## Quick Start
With Nix:
```
$ nix develop
$ hypercorn drtvrss:app
```
Or with [uv](https://docs.astral.sh/uv/):
```
$ uv run hypercorn drtvrss:app
```
The footer links to the source code at `$SOURCE_URL`, by default this repository on GitHub.

Viewers can sync their favourites, and how far they got with each video, between their devices with a code.
That's kept in an SQLite database at `$SYNC_DB`, or `sync.sqlite3` in `$STATE_DIRECTORY` (set by systemd's `StateDirectory=`, which the NixOS module uses), or in the current directory.

The project is set up using Nix, and uv.
Running the project with Nix is not supported.
Running the project with uv is also not supported.
What I'm trying to say is, you're on your own buddy.

Contribution guidelines can be found [here](https://www.youtube.com/watch?v=gWexE-YVnOs)

## Hacking instructions
To start a repl where all the async stuff works, do `python3 -m asyncio`.

Everything we know about DR's JSON format lives in `drtvrss/models.py`.

The dependencies are listed both in `flake.nix` and `pyproject.toml`.
After changing `pyproject.toml`, run `uv lock`.

## Tests
```
$ pytest
```
Or `uv run pytest`, with uv.
The tests run against DR data saved in `tests/fixtures`, so they need no network.

To check whether DR has changed something, run the tests against the real DRTV:
```
$ DRTV_LIVE_TESTS=1 pytest tests/test_live_dr.py
```
If they fail, refresh the fixtures with `python -m tests.update_fixtures`, and look at the diff.

GitHub Actions runs the tests on every push, both with Nix and with uv, and the tests against DR every morning.
