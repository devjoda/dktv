"""DR's own front page and categories: what DR features at the top, and the rows
of programmes below, with links to the pages here instead of DR's."""

from dataclasses import dataclass, field
from time import time
from typing import Optional
import asyncio

from pydantic import ValidationError

from . import models as dr
from .drtv import get_api
from .live import get_channels

PAGE_CACHE_TIME = 30 * 60
ROW_SIZE = 24
# A row with fewer than this isn't worth a row
MIN_ROW = 3

# DR's categories, as they're linked here and from the header
CATEGORY_LIST = 376779

# Rows on DR's pages that are better elsewhere here, or aren't rows of programmes
SKIPPED_ROWS = {"Se live tv", "Se livesport", "Kategorier"}


@dataclass
class Card:
    """A programme in one of DR's rows, or at the top of a page"""

    title: str
    url: str
    image: Optional[str] = None
    description: str = ""
    tagline: str = ""
    category: str = ""
    # Like "Episode 1:7", from the start of DR's tagline
    detail: str = ""
    # DR's short clip of it, to play at the top of the front page
    preview: Optional[str] = None
    # For marking what the viewer has seen
    video_id: Optional[str] = None
    # For making a show a favourite
    show_id: Optional[str] = None
    live: bool = False


@dataclass
class Row:
    title: str
    cards: list[Card]


@dataclass
class DiscoverPage:
    title: str
    featured: list[Card] = field(default_factory=list)
    rows: list[Row] = field(default_factory=list)


@dataclass
class Category:
    title: str
    url: str
    image: Optional[str] = None


def card(item: dr.DiscoverItem, channel_slugs: dict[str, str]) -> Optional[Card]:
    """Where an item of DR's goes here, or None if it doesn't go anywhere here"""
    slug = item.path.rstrip("/").split("/")[-1]
    video_id = None
    show_id = None
    if item.type == "show":
        url = f"/{slug}/"
        show_id = slug
    elif item.type == "season" and item.show_id:
        # The show's page only needs the show's id, not its name
        url = f"/{item.show_id}/"
        show_id = item.show_id
    elif item.type == "episode":
        url = f"/{item.show_id}/{slug}" if item.show_id else f"/program/{slug}"
        video_id = slug.split("_")[-1]
    elif item.type == "program":
        url = f"/program/{slug}"
        video_id = slug.split("_")[-1]
    elif item.type == "link" and item.path.startswith("/kanal/"):
        channel_id = slug.split("_")[-1]
        if channel_id not in channel_slugs:
            return None
        url = f"/live/{channel_slugs[channel_id]}"
    else:
        return None
    category = (item.custom_fields.display_category or "").split(",")[0]
    detail, tagline = "", item.tagline or ""
    if " | " in tagline:
        detail, tagline = tagline.split(" | ", 1)
    return Card(
        title=item.title,
        url=url,
        image=item.images.wallpaper,
        description=item.short_description if item.short_description != "LinkItem" else "",
        tagline=tagline,
        category=category,
        detail=detail,
        preview=item.custom_fields.short_video_url,
        video_id=video_id,
        show_id=show_id,
        live=item.type == "link",
    )


def cards(items: list[dict], channel_slugs: dict[str, str]) -> list[Card]:
    result = []
    for blob in items:
        try:
            c = card(dr.DiscoverItem.model_validate(blob), channel_slugs)
        except ValidationError:
            continue
        # DR sometimes has a show twice in a row, like two of its seasons
        if c is not None and c.url not in (r.url for r in result):
            result.append(c)
    return result


async def row_items(entry: dr.PageEntry) -> list[dict]:
    """A row's items, which DR only sends along with the page for the first few rows"""
    if entry.list.items:
        return entry.list.items
    blob = await get_api(f"/lists/{entry.list.id}", page_size=ROW_SIZE)
    return dr.PageList.model_validate(blob).items


def is_row(entry: dr.PageEntry) -> bool:
    title = (entry.title or "").strip()
    return (
        entry.list is not None
        and (entry.template or "")[:1] in ("P", "T")
        and not (entry.template or "").startswith("TX")
        # Not the rows for each letter of the alphabet
        and len(title) > 1
        and title not in SKIPPED_ROWS
    )


async def build_page(path: str, max_rows: int) -> DiscoverPage:
    page = dr.Page.model_validate(
        await get_api("/page", path=path, list_page_size=ROW_SIZE, max_list_prefetch=3)
    )
    channels = await get_channels()
    channel_slugs = {c.id: slug for slug, c in channels.items()}

    featured = []
    hero = next((e for e in page.entries if (e.template or "").startswith(("DRH", "H")) and e.list), None)
    if hero is not None:
        featured = cards(await row_items(hero), channel_slugs)

    entries = [e for e in page.entries if is_row(e)][:max_rows]
    results = await asyncio.gather(*map(row_items, entries), return_exceptions=True)
    rows = []
    for entry, items in zip(entries, results):
        if isinstance(items, BaseException):
            print("Could not get a row of", path, entry.title, repr(items))
            continue
        row = Row(entry.title.strip(), cards(items, channel_slugs))
        if len(row.cards) >= MIN_ROW:
            rows.append(row)
    return DiscoverPage(page.title or "", featured, rows)


pages: dict[str, tuple[float, DiscoverPage]] = {}


async def get_page(path: str, max_rows: int = 10, refresh: bool = False) -> Optional[DiscoverPage]:
    """One of DR's pages, like "/" or "/kategorier/film", or None if DR doesn't say.
    When DR doesn't answer, the last one it did is used for a while longer."""
    cached = pages.get(path)
    if not refresh and cached is not None and cached[0] + PAGE_CACHE_TIME > time():
        return cached[1]
    try:
        page = await build_page(path, max_rows)
    except Exception as e:
        print("Could not get DR's page", path, repr(e))
        if cached is not None:
            # Try again in a few minutes
            pages[path] = (time() - PAGE_CACHE_TIME + 5 * 60, cached[1])
            return cached[1]
        return None
    pages[path] = (time(), page)
    return page


categories_cache: tuple[float, list[Category]] = (0, [])


async def get_categories() -> list[Category]:
    """DR's categories, like Serier, Film and Dokumentar"""
    global categories_cache
    if categories_cache[0] + PAGE_CACHE_TIME > time():
        return categories_cache[1]
    try:
        blob = await get_api(f"/lists/{CATEGORY_LIST}", page_size=50)
        found = []
        for item in dr.PageList.model_validate(blob).items:
            path = item.get("path", "")
            # Search finds anything from A to Å better
            if path.startswith("/kategorier/") and path != "/kategorier/a-aa":
                images = item.get("images") or {}
                found.append(Category(item.get("title", ""), path + "/", images.get("tile") or images.get("wallpaper")))
        categories_cache = (time(), found)
    except Exception as e:
        print("Could not get DR's categories", repr(e))
        categories_cache = (time() - PAGE_CACHE_TIME + 60, categories_cache[1])
    return categories_cache[1]
