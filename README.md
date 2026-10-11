# Public Service
Originally written just so I could get an RSS feed for my favourite DRTV shows.
Feature creep resulted in building an invidious-like frontend.

An instance is hosted at https://drtv.rend.al

## Quick Start
```
$ nix develop
$ gunicorn drtvrss:app
```
The project is set up using Nix.
Running the project without Nix is not supported.
Running the project with Nix is also not supported.
What I'm trying to say is, you're on your own buddy.

Contribution guidelines can be found [here](https://www.youtube.com/watch?v=gWexE-YVnOs)

## Hacking instructions
To start a repl where all the async stuff works, do `python3 -m asyncio`.

Everything we know about DR's JSON format lives in `drtvrss/models.py`.

## Tests
```
$ pytest
```
The tests run against DR data saved in `tests/fixtures`, so they need no network.

To check whether DR has changed something, run the tests against the real DRTV:
```
$ DRTV_LIVE_TESTS=1 pytest tests/test_live_dr.py
```
If they fail, refresh the fixtures with `python -m tests.update_fixtures`, and look at the diff.
