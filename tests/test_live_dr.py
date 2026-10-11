"""Tests against the real DRTV, to find out whether DR has changed something.

These are skipped unless DRTV_LIVE_TESTS=1 is set, since they need network
access. If one fails because DR changed their format,
run `python -m tests.update_fixtures` and look at the diff.
"""

import asyncio
import os

import pytest

from drtvrss import drtv, live

pytestmark = pytest.mark.skipif(
    os.getenv("DRTV_LIVE_TESTS") != "1", reason="set DRTV_LIVE_TESTS=1 to run"
)


@pytest.fixture(autouse=True)
def no_cache(monkeypatch):
    monkeypatch.setattr(drtv, "shows", {})
    monkeypatch.setattr(drtv, "programs", {})
    monkeypatch.setattr(drtv, "searches", {})
    monkeypatch.setattr(live, "live_channels", None)
    monkeypatch.setattr(live, "last_fetch", 0)


def run(f, *args):
    async def main():
        async with drtv.http_session():
            return await f(*args)

    return asyncio.run(main())


def test_show():
    show = run(drtv.get_show, "rejseholdet_503605")
    assert show.title == "Rejseholdet"
    assert len(show.seasons) == 4
    assert all(len(s.episodes) > 0 for s in show.seasons)
    episode = show.seasons[0].episodes[0]
    assert episode.len_minutes is not None
    run(drtv.get_long_description, episode)
    assert len(episode.description) > len(episode.short_description)


def test_program():
    program = run(drtv.get_program, "lise-noergaard_-ikke-kun-en-pige_362031")
    assert program.title == "Lise Nørgaard: Ikke kun en pige"


def test_channels():
    channels = run(live.get_channels)
    assert ".m3u8" in channels["DR1"].stream_url


def test_search():
    result = run(drtv.search, "matador")
    assert "/matador_540736/" in [s.url for _, s in result.series]
