import asyncio

from drtvrss import app, drtv


def serve_until(condition):
    """Runs the app, until the condition holds or a second has passed"""

    async def serve():
        async with app.test_app():
            for _ in range(100):
                if condition():
                    return
                await asyncio.sleep(0.01)

    asyncio.run(serve())


def test_recommended_shows_are_fetched_at_startup(fake_dr, monkeypatch):
    # A broken show shouldn't stop the others from being fetched
    monkeypatch.setenv("RECOMMENDED_SHOWS", "findes-ikke_1:rejseholdet_503605")
    serve_until(lambda: 503605 in drtv.shows)
    assert 503605 in drtv.shows


def test_recommended_shows_are_kept_fresh(fake_dr, monkeypatch):
    monkeypatch.setenv("RECOMMENDED_SHOWS", "rejseholdet_503605")
    monkeypatch.setattr("drtvrss.RECOMMENDED_REFRESH_INTERVAL", 0)
    series_url = "/items/503605?expand=all"
    serve_until(lambda: fake_dr.count(series_url) >= 2)
    assert fake_dr.count(series_url) >= 2


def test_http_session_is_closed_on_shutdown(fake_dr):
    serve_until(lambda: drtv.session is not None)
    assert drtv.session is None
