from collections import namedtuple
from contextlib import asynccontextmanager
from datetime import datetime
from time import time
from typing import Optional
from zoneinfo import ZoneInfo
import ssl
import uuid

import asyncio
import certifi
from aiohttp import ClientError, ClientSession, TCPConnector
from pydantic import TypeAdapter

from quart import abort

from . import models as dr
from .show import Episode, Season, Show, Program, categories_of

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


class DRUnavailable(Exception):
    """DR didn't answer, or answered with an error of its own"""


API = "https://production-cdn.dr-massive.com/api"
# The parameters DR's own website sends along
API_PARAMS = {
    "device": "web_browser",
    "ff": "idp,ldp,rpt",
    "lang": "da",
    "segments": "drtv,optedout",
    "sub": "Anonymous",
}


async def get_api(path: str, /, **params) -> dict:
    """Gets something from DR's API, like `/items/{id}`"""
    print("Fetching from DR", path, params)
    try:
        async with http().get(API + path, params=API_PARAMS | params, timeout=5) as r:
            # DR doesn't have it, or doesn't think we asked for anything sensible
            if 400 <= r.status < 500:
                abort(404)
            if r.status != 200:
                raise DRUnavailable(f"DR responded {r.status} to {path}")
            return await r.json()
    except (ClientError, asyncio.TimeoutError) as e:
        raise DRUnavailable(f"Could not reach DR for {path}: {e!r}") from e


async def get_show(show: str, max_age: int = 3600) -> Show:
    try:
        showid = int(show.split("_")[-1])
    except ValueError:
        abort(404)
    if showid not in shows or shows[showid].age + max_age < time():
        item = await get_api(f"/items/{showid}", expand="all")
        if item.get("type") != "show":
            abort(404)
        show_item = dr.Show.model_validate(item)
        if not show_item.seasons.items:
            raise ValueError(f"Show {showid} has no seasons")

        async def fetch_season(season: dr.SeasonRef) -> tuple[str, dr.Season]:
            blob = await get_api(f"/items/{season.id}", expand="all")
            return (season.path, dr.Season.model_validate(blob))

        tasks = [fetch_season(s) for s in show_item.seasons.items]
        seasons = dict(await asyncio.gather(*tasks))

        # The latest season carries the show along with it, like DR's own site uses
        latest = seasons[show_item.seasons.items[-1].path]
        shows[showid] = build_show(latest, seasons)
    return shows[showid]


def build_show(latest: dr.Season, seasons: dict[str, dr.Season]) -> Show:
    """Builds a Show from the latest season of a series (which carries the show),
    and all of the show's seasons keyed by path"""
    next_episode = None
    if latest.show.next_episode is not None:
        next_episode = datetime.fromtimestamp(
            latest.show.next_episode.available_utc, tz=dr.COPENHAGEN
        )

    feed = Show(
        latest.show.title,
        description=latest.show.description,
        url=latest.show.path.split("/")[-1],
        wallpaper=latest.images.wallpaper,
        geo_restricted=latest.custom_fields.is_geo_restricted,
        next_episode=next_episode,
        categories=categories_of(latest) or categories_of(latest.show),
    )

    for s in latest.show.seasons.items:
        title = s.title
        if title == feed.title:
            if s.season_number is not None:
                title = "Sæson " + str(s.season_number)
            elif s.release_year is not None:
                title = str(s.release_year)
        else:
            # Like "Rejseholdet: Sæson 3", where the show's name is just noise
            title = title.removeprefix(feed.title + ": ")

        season = Season(title, id=s.id, number=s.season_number)
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
                    number=ep.episode_number,
                )
            )
        feed.add_season(season)

    return feed


def get_cached_show(show: str) -> Optional[Show]:
    """Returns the show if it has already been fetched, without fetching it"""
    try:
        return shows.get(int(show.split("_")[-1]))
    except ValueError:
        return None


async def get_long_description(episode: Episode):
    if episode.description != "":
        return
    try:
        blob = await get_api("/items/" + episode.url.split("_")[-1])
        item = dr.Episode.model_validate(blob)
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
            if r.status != 200:
                raise DRUnavailable(f"DR responded {r.status} when asked for a token")
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
        # Programs carry the same date and length as episodes do
        item = dr.Episode.model_validate(await get_api(f"/items/{progid}"))
        programs[progid] = Program(
            item.title or item.id,
            item.short_description,
            url=item.path,
            pubdate=item.custom_fields.available_from,
            wallpaper=item.images.wallpaper,
            len_minutes=item.len_minutes,
            categories=categories_of(item),
        )
    return programs[progid]


SearchResultItem = namedtuple(
    "SearchResultItem", ["title", "wallpaper", "description", "geo_restricted", "url"]
)


SearchResult = namedtuple("SearchResult", ["series", "movies", "episodes"])

SEARCH_API = "https://prod95.dr-massive.com/api/search"
# The parameters DR's own website sends along when searching
SEARCH_PARAMS = {
    "device": "web_browser",
    "ff": "idp,ldp,rpt",
    "group": "true",
    "lang": "da",
    "segments": "drtv,optedout",
}

SEARCH_CACHE_TIME = 15 * 60
SEARCH_CACHE_SIZE = 500
searches: dict[str, tuple[float, SearchResult]] = {}


async def fetch_search(query: str) -> dict:
    try:
        async with http().get(
            SEARCH_API,
            params=SEARCH_PARAMS | {"term": query},
            headers={"X-Authorization": f"Bearer {await get_token()}"},
            timeout=5,
        ) as r:
            if r.status != 200:
                raise DRUnavailable(f"DR responded {r.status} to a search")
            return await r.json()
    except (ClientError, asyncio.TimeoutError) as e:
        raise DRUnavailable(f"Could not reach DR to search: {e!r}") from e


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
    movies = []
    episodes = []
    for i in r.playable.items:
        if "episode" not in i.path:
            movies.append((i.id, result_item(i, i.path)))
            continue
        slug = i.path.split("/")[-1]
        if i.show_id is not None:
            # The show's page only needs the show's id, not its name
            url = f"/{i.show_id}/{slug}"
        else:
            url = "/program/" + slug
        episodes.append((i.id, result_item(i, url)))
    return SearchResult(series, movies, episodes)
