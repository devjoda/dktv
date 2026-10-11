from collections import namedtuple
from contextlib import asynccontextmanager
from datetime import datetime
from json.decoder import JSONDecodeError
from time import time
from typing import Optional
from zoneinfo import ZoneInfo
import json
import ssl
import uuid

import asyncio
import certifi
from aiohttp import ClientSession, TCPConnector
from pydantic import TypeAdapter

from quart import abort

from . import models as dr
from .show import Episode, Season, Show, Program

shows: dict[int, Show] = {}
programs: dict[int, Program] = {}

ssl_context = ssl.create_default_context(cafile=certifi.where())

session: Optional[ClientSession] = None


def open_session():
    """Opens the HTTP session that all requests to DR go through"""
    global session
    session = ClientSession(connector=TCPConnector(ssl=ssl_context))


async def close_session():
    global session
    await session.close()
    session = None


@asynccontextmanager
async def http_session():
    open_session()
    try:
        yield
    finally:
        await close_session()


def http() -> ClientSession:
    if session is None:
        raise RuntimeError("No HTTP session. Use `async with drtv.http_session()`")
    return session


async def get_jsonblob(url: str) -> dict:
    """Gets the JSON blob from some DRTV page"""
    print("Fetching DRTV page", url)
    async with http().get(url, timeout=5) as r:
        if r.status != 200:
            abort(404)
        m = await r.text()
        snippet = "window.__data = "
        start = m.find(snippet) + len(snippet)
        end = len(m[start:])
        try:
            json.loads(m[start:])
        except JSONDecodeError as e:
            end = e.pos
        return json.loads(m[start : start + end])


async def get_show(show: str, max_age: int = 3600) -> Show:
    try:
        showid = int(show.split("_")[-1])
    except ValueError:
        abort(404)
    if showid not in shows or shows[showid].age + max_age < time():
        url = "https://www.dr.dk/drtv/serie/" + str(showid)
        series = dr.SeriesPage.model_validate(await get_jsonblob(url))
        latest = series.latest_season()

        async def fetch_season(path: str) -> tuple[str, dr.Season]:
            blob = await get_jsonblob("https://www.dr.dk/drtv" + path)
            return (path, dr.Page[dr.Season].model_validate(blob).item(path))

        tasks = [fetch_season(s.path) for s in latest.show.seasons.items]
        seasons = dict(await asyncio.gather(*tasks))

        shows[showid] = build_show(latest, seasons)
    return shows[showid]


def build_show(latest: dr.Season, seasons: dict[str, dr.Season]) -> Show:
    """Builds a Show from the latest season of a series (which carries the show),
    and all of the show's seasons keyed by path"""
    next_episode = None
    if latest.show.next_episode is not None:
        next_episode = datetime.fromtimestamp(latest.show.next_episode.available_utc)

    feed = Show(
        latest.show.title,
        description=latest.show.description,
        url=latest.show.path.split("/")[-1],
        wallpaper=latest.images.wallpaper,
        geo_restricted=latest.custom_fields.is_geo_restricted,
        next_episode=next_episode,
    )

    for s in latest.show.seasons.items:
        title = s.title
        if title == feed.title:
            if s.season_number is not None:
                title = "Sæson " + str(s.season_number)
            elif s.release_year is not None:
                title = str(s.release_year)

        season = Season(title)
        for ep in seasons[s.path].episodes.items:
            season.add_episode(
                Episode(
                    ep.display_title,
                    short_description=ep.short_description,
                    url=ep.path,
                    pubdate=ep.pubdate,
                    wallpaper=ep.images.wallpaper,
                    len_minutes=ep.len_minutes,
                    geo_restricted=ep.custom_fields.is_geo_restricted,
                )
            )
        feed.add_season(season)

    return feed


def get_shows() -> dict[int, Show]:
    return shows


async def get_long_description(episode: Episode):
    if episode.description != "":
        return
    try:
        blob = await get_jsonblob("https://dr.dk/drtv/" + episode.url)
        item = dr.Page[dr.Episode].model_validate(blob).item()
        episode.description = item.description or episode.short_description
    except Exception as e:
        print("Could not get long description for", episode.url, repr(e))
        episode.description = episode.short_description


token: str = ""
token_expiry = datetime.fromisoformat("2025-02-20T03:16:49.1356687Z")


async def get_token() -> str:
    global token, token_expiry
    if datetime.now(tz=ZoneInfo("UTC")) > token_expiry:
        async with http().post(
            "https://isl.dr-massive.com/api/authorization/anonymous-sso?device=web_browser&lang=da&supportFallbackToken=true",
            json={
                "deviceId": str(uuid.uuid4()),
                "scopes": ["Catalog"],
                "optout": True,
            },
        ) as r:
            tokens = TypeAdapter(list[dr.Token]).validate_python(await r.json())
            # The api issues two tokens. The UserProfile one is used for search
            profile_token = [t for t in tokens if t.type == "UserProfile"][0]
            token = profile_token.value
            token_expiry = profile_token.expiration_date
    return token


async def get_program(prog: str) -> Program:
    try:
        progid = int(prog.split("_")[-1])
    except ValueError:
        abort(404)
    if progid not in programs or programs[progid].age + 3600 < time():
        blob = await get_jsonblob(f"https://www.dr.dk/drtv/program/{str(progid)}")
        item = dr.Page[dr.Item].model_validate(blob).item()
        programs[progid] = Program(
            item.title,
            item.short_description,
            url=item.path,
        )
    return programs[progid]


SearchResultItem = namedtuple(
    "SearchResultItem", ["title", "wallpaper", "description", "geo_restricted", "url"]
)


SearchResult = namedtuple("SearchResult", ["series", "movies"])

SEARCH_CACHE_TIME = 15 * 60
SEARCH_CACHE_SIZE = 500
searches: dict[str, tuple[float, SearchResult]] = {}


async def fetch_search(query: str) -> dict:
    async with http().get(
        "https://prod95.dr-massive.com/api/search?device=web_browser&ff=idp%2Cldp%2Crpt&group=true&lang=da&segments=drtv%2Coptedout&term="
        + query,
        headers={"X-Authorization": f"Bearer {await get_token()}"},
    ) as r:
        return await r.json()


async def search(query: str) -> SearchResult:
    if query in searches and searches[query][0] + SEARCH_CACHE_TIME > time():
        return searches[query][1]
    result = build_search_result(
        dr.SearchResponse.model_validate(await fetch_search(query))
    )
    searches.pop(query, None)
    if len(searches) >= SEARCH_CACHE_SIZE:
        # Searches are kept in the order they were made, so this is the oldest
        del searches[next(iter(searches))]
    searches[query] = (time(), result)
    return result


def build_search_result(r: dr.SearchResponse) -> SearchResult:
    def result_item(i: dr.Item, url: str) -> SearchResultItem:
        return SearchResultItem(
            i.title,
            i.images.wallpaper,
            i.short_description,
            i.custom_fields.is_geo_restricted,
            url,
        )

    series = [
        (i.id, result_item(i, "/" + i.path.split("/")[-1] + "/"))
        for i in r.series.items
    ]
    movies = [
        (i.id, result_item(i, i.path))
        for i in r.playable.items
        if "episode" not in i.path
    ]
    return SearchResult(series, movies)
