import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlencode

import pytest
from quart import abort

from drtvrss import app, discover, drtv, live

from .update_fixtures import fixture_name

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture
def fake_dr(monkeypatch):
    """Serves DR's API from the fixtures, and resets all caches.
    Returns the list of requests made to DR, like "/items/503605?expand=all"."""
    requested = []

    async def get_api(path, /, **params):
        requested.append(path + ("?" + urlencode(params) if params else ""))
        if not (FIXTURES / fixture_name(path, params)).exists():
            # Same as get_api does when DR responds with anything but 200
            abort(404)
        return load(fixture_name(path, params))

    async def fetch_search(query):
        requested.append("search:" + query)
        return load("search.json")

    monkeypatch.setattr(drtv, "get_api", get_api)
    monkeypatch.setattr(live, "get_api", get_api)
    monkeypatch.setattr(discover, "get_api", get_api)
    monkeypatch.setattr(discover, "pages", {})
    monkeypatch.setattr(discover, "categories_cache", (0, []))
    monkeypatch.setattr(drtv, "fetch_search", fetch_search)
    monkeypatch.setattr(live, "live_channels", None)
    monkeypatch.setattr(live, "last_fetch", 0)
    monkeypatch.setattr(live, "schedules", {})
    monkeypatch.setattr(live, "schedules_fetched", 0)
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


def _request(fake_dr, method):
    def request(path: str, data=None, content_type="application/json") -> SimpleNamespace:
        async def run():
            async with app.test_app() as test_app:
                client = test_app.test_client()
                kwargs = {}
                if data is not None:
                    body = data if isinstance(data, str) else json.dumps(data)
                    kwargs = {"data": body, "headers": {"Content-Type": content_type}}
                r = await getattr(client, method)(path, **kwargs)
                return SimpleNamespace(status_code=r.status_code, text=await r.get_data(as_text=True))

        return asyncio.run(run())

    return request


@pytest.fixture
def post(fake_dr):
    """Sends something to the app, like get"""
    return _request(fake_dr, "post")


@pytest.fixture
def delete(fake_dr):
    return _request(fake_dr, "delete")
