import asyncio
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import pytest

from drtvrss import drtv, models as dr
from drtvrss.show import BASE_URL, Episode

from .conftest import load

SEASON_PATHS = [
    "/saeson/rejseholdet_503606",
    "/saeson/rejseholdet_503607",
    "/saeson/rejseholdet_-saeson-3_503611",
    "/saeson/rejseholdet_-saeson-4_503612",
]


def latest_season(blob=None) -> dr.Season:
    return dr.SeriesPage.model_validate(blob or load("series.json")).latest_season()


def seasons() -> dict[str, dr.Season]:
    return {
        path: dr.Page[dr.Season]
        .model_validate(load(f"season_{path.split('_')[-1]}.json"))
        .item(path)
        for path in SEASON_PATHS
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
    # Seasons titled like the show are named by their number instead
    assert [s.title for s in show.seasons] == [
        "Sæson 1",
        "Sæson 2",
        "Rejseholdet: Sæson 3",
        "Rejseholdet: Sæson 4",
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
    blob = load("series.json")
    latest = list(blob["cache"]["itemDetail"].values())[-1]["item"]
    latest["show"]["nextEpisode"] = {"availableUTC": "1760000000"}
    show = drtv.build_show(latest_season(blob), seasons())
    assert show.next_episode == datetime.fromtimestamp(1760000000)


def test_build_show_names_seasons_by_year_without_season_number():
    blob = load("series.json")
    latest = list(blob["cache"]["itemDetail"].values())[-1]["item"]
    del latest["show"]["seasons"]["items"][0]["seasonNumber"]
    show = drtv.build_show(latest_season(blob), seasons())
    assert show.seasons[0].title == "2000"


def test_rss_feed():
    show = drtv.build_show(latest_season(), seasons())
    rss = ET.fromstring(show.to_rss_feed())
    channel = rss.find("channel")
    assert channel.findtext("title") == "Rejseholdet"
    items = channel.findall("item")
    assert len(items) == 9 + 7 + 14 + 2
    assert items[0].findtext("title") == "1. episode"
    assert items[0].findtext("link") == f"{BASE_URL}/rejseholdet_503605/rejseholdet_503615"
    assert items[0].findtext("guid") == "DRTV:rejseholdet_503615"
    assert items[0].findtext("pubDate") == "Sun, 01 Oct 2000 18:00:08 +0000"


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


def test_get_show_fetches_all_seasons_and_caches(fake_dr):
    show = asyncio.run(drtv.get_show("rejseholdet_503605"))
    assert len(show.seasons) == 4
    assert sorted(fake_dr) == sorted(
        ["https://www.dr.dk/drtv/serie/503605"]
        + ["https://www.dr.dk/drtv" + p for p in SEASON_PATHS]
    )

    fake_dr.clear()
    assert asyncio.run(drtv.get_show("rejseholdet_503605")) is show
    assert fake_dr == []


def test_get_long_description(fake_dr):
    ep = Episode("x", short_description="Kort", url="/episode/matador_-foedselsdagen_540744")
    asyncio.run(drtv.get_long_description(ep))
    assert ep.description.startswith("Dansk dramaserie fra 1979.")


def test_get_long_description_falls_back_to_short_description(fake_dr):
    ep = Episode("x", short_description="Kort", url="/episode/findes-ikke_1")
    asyncio.run(drtv.get_long_description(ep))
    assert ep.description == "Kort"


def test_get_long_description_without_description_on_dr(fake_dr, monkeypatch):
    blob = load("episode.json")
    for page in blob["cache"]["page"].values():
        del page["item"]["description"]

    async def get_jsonblob(url):
        return blob

    monkeypatch.setattr(drtv, "get_jsonblob", get_jsonblob)
    ep = Episode("x", short_description="Kort", url="/episode/matador_-foedselsdagen_540744")
    asyncio.run(drtv.get_long_description(ep))
    assert ep.description == "Kort"


def test_get_show_refetches_when_older_than_max_age(fake_dr):
    show = asyncio.run(drtv.get_show("rejseholdet_503605"))
    assert asyncio.run(drtv.get_show("rejseholdet_503605", max_age=0)) is not show
    assert fake_dr.count("https://www.dr.dk/drtv/serie/503605") == 2


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
        asyncio.run(drtv.get_jsonblob("https://www.dr.dk/drtv/serie/503605"))
