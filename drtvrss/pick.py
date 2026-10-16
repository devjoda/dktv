""""Vælg for mig": what DR has on its categories' pages, with what pick.js needs to ask the viewer about it,
like whether it's a series, what it's like and how long it is. Like the Worker's pick.ts."""

from time import time
from typing import Optional
import re

from .discover import Card, DiscoverPage, get_categories, get_page
from .show import thumbnail

# How long the programmes are kept, which DR's rows change little within
PICK_TIME = 6 * 60 * 60
# As many rows of a category as its page here has
ROWS = 12
# Categories that aren't something to pick for an evening
LEFT_OUT_CATEGORIES = re.compile(r"nyheder|sport")
LEFT_OUT_TAGS = {"nyheder", "arkivnyheder", "sport"}
# DR's rows of what's new, like "Netop tilføjet" and "Nye programmer"
NEW_ROW = re.compile(r"^(ny|nye|netop)\b|\bny(e)? (sæson|episode|afsnit)", re.IGNORECASE)


def kind_of(c: Card) -> Optional[str]:
    """What a programme is, for the first question, or None for what isn't picked, like news and episodes"""
    if c.live or c.series_id or any(t in LEFT_OUT_TAGS for t in c.tags):
        return None
    if "dokumentar" in c.tags:
        return "dokumentar"
    if c.show_id:
        return "serie" if "fiktionsserie" in c.tags or "serier" in c.tags else "program"
    if c.film_id:
        return "film" if "film" in c.tags else "program"
    return None


def picks(page: DiscoverPage) -> list[dict]:
    """The programmes on one of DR's pages that can be picked, as /vaelg.json has them"""
    found = []

    def add(c: Card, fresh: bool):
        kind = kind_of(c)
        if kind is None:
            return
        found.append({key: value for key, value in {
            "title": c.title, "url": c.url, "image": thumbnail(c.image), "kind": kind, "tags": list(c.tags),
            "year": c.year, "minutes": c.minutes, "seasons": c.seasons, "fresh": fresh or None,
            "videoId": c.video_id, "showId": c.show_id, "filmId": c.film_id,
        }.items() if value is not None})

    for c in page.featured:
        add(c, False)
    for row in page.rows:
        fresh = bool(NEW_ROW.search(row.title))
        for c in row.cards:
            add(c, fresh)
    return found


def merge(lists: list[list[dict]]) -> list[dict]:
    """Programmes on several pages are the same one, with what all of them say about it"""
    found: dict[str, dict] = {}
    for p in (p for found_list in lists for p in found_list):
        key = f"show:{p['showId'].split('_')[-1]}" if p.get("showId") else p["url"]
        kept = found.get(key)
        if kept is None:
            found[key] = {**p, "tags": list(p["tags"])}
            continue
        kept["tags"] += [t for t in p["tags"] if t not in kept["tags"]]
        if p.get("fresh"):
            kept["fresh"] = True
        # With the show's name in its address
        if "_" in p.get("showId", "") and "_" not in kept.get("showId", ""):
            kept["url"] = p["url"]
            kept["showId"] = p["showId"]
    return list(found.values())


pool_cache: tuple[float, list[dict]] = (0, [])


async def pick_pool() -> list[dict]:
    """All the programmes to pick from, from DR's categories' pages"""
    global pool_cache
    if pool_cache[0] + PICK_TIME > time() and pool_cache[1]:
        return pool_cache[1]
    lists = []
    for category in await get_categories():
        if LEFT_OUT_CATEGORIES.search(category.url):
            continue
        page = await get_page(category.url.rstrip("/"), max_rows=ROWS)
        if page is not None:
            lists.append(picks(page))
    found = merge(lists)
    if found:
        pool_cache = (time(), found)
    return found or pool_cache[1]
