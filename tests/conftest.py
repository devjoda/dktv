import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from quart import abort

from drtvrss import app, drtv, live

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text())


def fixture_for_url(url: str) -> str:
    """Maps a DRTV URL to the fixture captured from it"""
    kind = url.split("/drtv/")[-1].strip("/").split("/")[0]
    item_id = url.rstrip("/").split("/")[-1].split("_")[-1]
    candidates = {
        "serie": {"503605": "series.json"},
        "saeson": {i: f"season_{i}.json" for i in ["503606", "503607", "503611", "503612"]},
        "episode": {"540744": "episode.json"},
        "program": {"362031": "program.json"},
        "kanal": {"20875": "channels.json"},
    }
    try:
        return candidates[kind][item_id]
    except KeyError:
        # Same as get_jsonblob does when DR responds with anything but 200
        abort(404)


@pytest.fixture
def fake_dr(monkeypatch):
    """Serves DR's pages and APIs from the fixtures, and resets all caches.
    Returns the list of URLs requested from DR."""
    requested = []

    async def get_jsonblob(url):
        requested.append(url)
        return load(fixture_for_url(url))

    async def fetch_search(query):
        requested.append("search:" + query)
        return load("search.json")

    monkeypatch.setattr(drtv, "get_jsonblob", get_jsonblob)
    monkeypatch.setattr(live, "get_jsonblob", get_jsonblob)
    monkeypatch.setattr(drtv, "fetch_search", fetch_search)
    monkeypatch.setattr(live, "live_channels", None)
    monkeypatch.setattr(live, "last_fetch", 0)
    monkeypatch.delenv("RECOMMENDED_SHOWS", raising=False)
    drtv.shows.clear()
    drtv.programs.clear()
    drtv.searches.clear()
    return requested


@pytest.fixture
def get(fake_dr):
    """Requests a page from the app, going through its startup and shutdown"""

    def get(path: str) -> SimpleNamespace:
        async def request():
            async with app.test_app() as test_app:
                r = await test_app.test_client().get(path)
                return SimpleNamespace(
                    status_code=r.status_code,
                    content_type=r.content_type,
                    location=r.location,
                    text=await r.get_data(as_text=True),
                )

        return asyncio.run(request())

    return get
