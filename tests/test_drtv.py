import asyncio
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer
from werkzeug.exceptions import NotFound

from drtvrss import drtv, models as dr
from drtvrss.show import BASE_URL, MEDIA_RSS, Episode, danish_date, duration, thumbnail

from .conftest import load

SEASON_IDS = ["503606", "503607", "503611", "503612"]


def latest_season(blob=None) -> dr.Season:
    return dr.Season.model_validate(blob or load("items_503612.json"))


def seasons() -> dict[str, dr.Season]:
    return {
        season.path: season
        for season in (
            dr.Season.model_validate(load(f"items_{i}.json")) for i in SEASON_IDS
        )
    }


def test_build_show():
    show = drtv.build_show(latest_season(), seasons())
    assert show.title == "Rejseholdet"
    assert show.url == "rejseholdet_503605"
    assert show.feed_url == "/rejseholdet_503605.xml"
    assert show.description.startswith("Dansk krimiserie")
    assert show.wallpaper.startswith("https://")
    assert not show.geo_restricted
    assert show.next_episode is None
    # Seasons titled like the show are named by their number instead,
    # and the others don't repeat the show's name
    assert [s.title for s in show.seasons] == [
        "Sæson 1",
        "Sæson 2",
        "Sæson 3",
        "Sæson 4",
    ]
    assert [len(s.episodes) for s in show.seasons] == [9, 7, 14, 2]

    first = show.seasons[0].episodes[0]
    assert first.title == "1. episode"
    assert first.url == "/episode/rejseholdet_503615"
    assert first.ep_link == "rejseholdet_503615"
    assert first.len_minutes == 59
    assert first.pubdate == datetime(2000, 10, 1, 18, 0, 8, tzinfo=timezone.utc)
    assert first.short_description.startswith("Dansk krimiserie fra 2000")
    assert first.description == ""


def test_build_show_next_episode():
    blob = load("items_503612.json")
    blob["show"]["nextEpisode"] = {"availableUTC": "1760000000"}
    show = drtv.build_show(latest_season(blob), seasons())
    assert show.next_episode == datetime.fromtimestamp(1760000000)


def test_build_show_names_seasons_by_year_without_season_number():
    blob = load("items_503612.json")
    del blob["show"]["seasons"]["items"][0]["seasonNumber"]
    show = drtv.build_show(latest_season(blob), seasons())
    assert show.seasons[0].title == "2000"


def test_rss_feed():
    show = drtv.build_show(latest_season(), seasons())
    rss = ET.fromstring(show.to_rss_feed())
    channel = rss.find("channel")
    assert channel.findtext("title") == "Rejseholdet"
    assert channel.findtext("link") == f"{BASE_URL}/rejseholdet_503605/"
    items = channel.findall("item")
    assert len(items) == 9 + 7 + 14 + 2
    assert items[0].findtext("title") == "1. episode"
    assert items[0].findtext("link") == f"{BASE_URL}/rejseholdet_503605/rejseholdet_503615"
    assert items[0].findtext("guid") == "DRTV:rejseholdet_503615"
    assert items[0].findtext("pubDate") == "Sun, 01 Oct 2000 18:00:08 +0000"
    # Until someone opens an episode, the feed makes do with its short description
    assert items[0].findtext("description").startswith("Dansk krimiserie fra 2000")
    image = items[0].find(f"{{{MEDIA_RSS}}}thumbnail").get("url")
    assert "Width=640&Height=360" in image


def test_rss_feed_prefers_the_long_description():
    show = drtv.build_show(latest_season(), seasons())
    show.seasons[0].episodes[0].description = "Lang beskrivelse"
    items = ET.fromstring(show.to_rss_feed()).findall("channel/item")
    assert items[0].findtext("description") == "Lang beskrivelse"


def test_danish_date():
    assert danish_date(datetime(2000, 10, 1)) == "1. okt. 2000"
    assert danish_date(datetime(2023, 5, 17)) == "17. maj 2023"
    # Shown as it was in Denmark, where it was already the next day
    assert danish_date(datetime(2000, 12, 31, 23, 30, tzinfo=timezone.utc)) == "1. jan. 2001"


def test_duration():
    assert duration(59) == "59 min."
    assert duration(60) == "1 t."
    assert duration(75) == "1 t. 15 min."


def test_get_program(fake_dr):
    program = asyncio.run(drtv.get_program("lise-noergaard_-ikke-kun-en-pige_362031"))
    assert program.title == "Lise Nørgaard: Ikke kun en pige"
    assert program.len_minutes == 48
    assert program.pubdate == datetime(2023, 1, 7, 17, 0, tzinfo=timezone.utc)
    assert program.wallpaper.startswith("https://")


def test_thumbnail():
    image = "https://example.com/ResizeImage/$value?Format='jpg'&Width=1920&Height=1080&ImageId='1'"
    assert thumbnail(image) == image.replace("Width=1920&Height=1080", "Width=640&Height=360")
    # Keeps the image's proportions
    assert "Width=640&Height=960" in thumbnail(image.replace("Height=1080", "Height=2880"))
    # Leaves alone what it doesn't know how to resize, or what's small already
    assert thumbnail("https://example.com/image.jpg") == "https://example.com/image.jpg"
    small = image.replace("Width=1920&Height=1080", "Width=320&Height=180")
    assert thumbnail(small) == small
    assert thumbnail(None) is None


def test_build_search_result():
    result = drtv.build_search_result(
        dr.SearchResponse.model_validate(load("search.json"))
    )
    series = dict(result.series)
    assert series["540736"].title == "Matador"
    assert series["540736"].url == "/matador_540736/"
    assert len(result.movies) > 0
    assert all("episode" not in m.url for _, m in result.movies)
    assert all(m.url.startswith("/program/") for _, m in result.movies)
    episodes = dict(result.episodes)
    assert episodes["557186"].title == "Matadorerne: Den første kæmpe"
    # Played on their show's page
    assert episodes["557186"].url == "/557181/matadorerne_-den-foerste-kaempe_557186"


def test_build_search_result_episode_without_show():
    blob = load("search.json")
    episode = next(i for i in blob["playable"]["items"] if i["id"] == "557186")
    del episode["showId"]
    result = drtv.build_search_result(dr.SearchResponse.model_validate(blob))
    url = dict(result.episodes)["557186"].url
    assert url == "/program/matadorerne_-den-foerste-kaempe_557186"


def test_get_show_fetches_all_seasons_and_caches(fake_dr):
    show = asyncio.run(drtv.get_show("rejseholdet_503605"))
    assert len(show.seasons) == 4
    # The show's wallpaper is the latest season's, like on DR's own site
    assert show.wallpaper == latest_season().images.wallpaper
    assert sorted(fake_dr) == sorted(
        ["/items/503605?expand=all"] + [f"/items/{i}?expand=all" for i in SEASON_IDS]
    )

    fake_dr.clear()
    assert asyncio.run(drtv.get_show("rejseholdet_503605")) is show
    assert fake_dr == []


def test_get_show_of_something_else_is_not_found(fake_dr):
    with pytest.raises(NotFound):
        asyncio.run(drtv.get_show("lise-noergaard_-ikke-kun-en-pige_362031"))


def test_get_show_without_seasons(fake_dr, monkeypatch):
    blob = load("items_503605.json")
    blob["seasons"]["items"] = []

    async def get_api(path, **params):
        return blob

    monkeypatch.setattr(drtv, "get_api", get_api)
    with pytest.raises(ValueError, match="no seasons"):
        asyncio.run(drtv.get_show("rejseholdet_503605"))


def test_get_long_description(fake_dr):
    ep = Episode("x", short_description="Kort", url="/episode/matador_-foedselsdagen_540744")
    asyncio.run(drtv.get_long_description(ep))
    assert ep.description.startswith("Dansk dramaserie fra 1979.")


def test_get_long_description_falls_back_to_short_description(fake_dr):
    ep = Episode("x", short_description="Kort", url="/episode/findes-ikke_1")
    asyncio.run(drtv.get_long_description(ep))
    assert ep.description == "Kort"


def test_get_long_description_without_description_on_dr(fake_dr, monkeypatch):
    blob = load("items_540744.json")
    del blob["description"]

    async def get_api(path, **params):
        return blob

    monkeypatch.setattr(drtv, "get_api", get_api)
    ep = Episode("x", short_description="Kort", url="/episode/matador_-foedselsdagen_540744")
    asyncio.run(drtv.get_long_description(ep))
    assert ep.description == "Kort"


def test_get_show_refetches_when_older_than_max_age(fake_dr):
    show = asyncio.run(drtv.get_show("rejseholdet_503605"))
    assert asyncio.run(drtv.get_show("rejseholdet_503605", max_age=0)) is not show
    assert fake_dr.count("/items/503605?expand=all") == 2


def test_search_is_cached(fake_dr):
    first = asyncio.run(drtv.search("matador"))
    assert asyncio.run(drtv.search("matador")) is first
    assert fake_dr == ["search:matador"]


def test_search_cache_expires(fake_dr, monkeypatch):
    monkeypatch.setattr(drtv, "SEARCH_CACHE_TIME", -1)
    asyncio.run(drtv.search("matador"))
    asyncio.run(drtv.search("matador"))
    assert fake_dr == ["search:matador", "search:matador"]


def test_search_cache_forgets_the_oldest_search(fake_dr, monkeypatch):
    monkeypatch.setattr(drtv, "SEARCH_CACHE_SIZE", 2)
    for query in ["a", "b", "c"]:
        asyncio.run(drtv.search(query))
    assert list(drtv.searches) == ["b", "c"]


def test_requests_need_an_http_session():
    with pytest.raises(RuntimeError, match="http_session"):
        asyncio.run(drtv.get_api("/items/503605"))


def test_get_api(monkeypatch):
    """Against a stand-in for DR's API, since the other tests replace get_api"""
    requests = []

    async def handler(request):
        requests.append((request.path, dict(request.query)))
        if request.path == "/api/items/1":
            return web.json_response({"message": "Item '1' not found"}, status=404)
        if request.path == "/api/items/2":
            return web.json_response({"message": "Oops"}, status=500)
        return web.json_response({"id": "503605"})

    async def run():
        app = web.Application()
        app.router.add_get("/{path:.*}", handler)
        async with TestServer(app) as server:
            monkeypatch.setattr(drtv, "API", str(server.make_url("/api")))
            async with drtv.http_session():
                assert await drtv.get_api("/items/503605", expand="all") == {"id": "503605"}
                with pytest.raises(NotFound):
                    await drtv.get_api("/items/1")
                # DR's own trouble isn't a missing page
                with pytest.raises(drtv.DRUnavailable):
                    await drtv.get_api("/items/2")
        # Nor is DR not answering at all
        async with drtv.http_session():
            with pytest.raises(drtv.DRUnavailable):
                await drtv.get_api("/items/503605")

    asyncio.run(run())
    assert requests[0] == ("/api/items/503605", drtv.API_PARAMS | {"expand": "all"})


def test_fetch_search_encodes_the_query(monkeypatch):
    """Against a stand-in for DR's search, since the other tests replace fetch_search"""
    queries = []

    async def handler(request):
        queries.append(dict(request.query))
        return web.json_response({})

    async def get_token():
        return "token"

    async def run():
        app = web.Application()
        app.router.add_get("/{path:.*}", handler)
        async with TestServer(app) as server:
            monkeypatch.setattr(drtv, "SEARCH_API", str(server.make_url("/api/search")))
            monkeypatch.setattr(drtv, "get_token", get_token)
            async with drtv.http_session():
                for query in ["Matador & co", "Bonderøven #1", "a+b"]:
                    await drtv.fetch_search(query)

    asyncio.run(run())
    assert [q["term"] for q in queries] == ["Matador & co", "Bonderøven #1", "a+b"]
    assert queries[0] == drtv.SEARCH_PARAMS | {"term": "Matador & co"}
