"""DR's own front page and categories: what DR features at the top, and the rows
of programmes below, with links to the pages here instead of DR's."""

from dataclasses import dataclass, field
from time import time
from typing import Optional
import asyncio
import re

from pydantic import ValidationError

from . import models as dr
from .drtv import get_api
from .live import get_channels
from .show import thumbnail

PAGE_CACHE_TIME = 30 * 60
ROW_SIZE = 24
# The most DR gives at a time, and the most of a list shown, like all films from A to Å
LIST_PAGE_SIZE = 100
MAX_LIST = 1000
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
    # Where the category and the detail lead
    category_url: Optional[str] = None
    episode_url: Optional[str] = None
    # DR's short clip of it, to play at the top of the front page
    preview: Optional[str] = None
    # For marking what the viewer has seen
    video_id: Optional[str] = None
    # For making a show or a film a favourite
    show_id: Optional[str] = None
    film_id: Optional[str] = None
    # For an episode, its series, which it makes a favourite instead, with the series' title
    series_id: Optional[str] = None
    series_title: Optional[str] = None
    live: bool = False


@dataclass
class Row:
    title: str
    cards: list[Card]
    # DR's list, when it has more than the row shows
    more: Optional[str] = None


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
    film_id = None
    series_id = None
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
        series_id = item.show_id
    elif item.type == "program":
        url = f"/program/{slug}"
        video_id = slug.split("_")[-1]
        film_id = slug
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
    episode_url = None
    number = re.match(r"Episode (\d+)", detail)
    if item.type == "season" and number:
        episode_url = f"/{item.show_id}/afsnit/{number[1]}?saeson={item.id}"
    elif video_id is not None:
        episode_url = url
    return Card(
        title=item.title,
        url=url,
        image=item.images.wallpaper,
        description=item.short_description if item.short_description != "LinkItem" else "",
        tagline=tagline,
        category=category,
        detail=detail,
        episode_url=episode_url,
        preview=item.custom_fields.short_video_url,
        video_id=video_id,
        show_id=show_id,
        film_id=film_id,
        series_id=series_id,
        # DR's title for an episode is like "Den store bagedyst: Bær i bagedysten"
        series_title=item.title.split(": ")[0] if series_id else None,
        live=item.type == "link",
    )


def cards(items: list[dict], channel_slugs: dict[str, str]) -> list[Card]:
    result = []
    seen: dict[str, Card] = {}
    for blob in items:
        try:
            c = card(dr.DiscoverItem.model_validate(blob), channel_slugs)
        except ValidationError:
            continue
        if c is None:
            continue
        # DR sometimes has a show twice, like two of its seasons, or the show and one of its seasons,
        # which lead to /mors-dreng_622934/ and /622934/: the same, by DR's id for the show
        key = f"show:{c.show_id.split('_')[-1]}" if c.show_id else c.url
        found = seen.get(key)
        if found is None:
            seen[key] = c
            result.append(c)
        elif "_" in c.show_id and "_" not in (found.show_id or ""):
            # With the show's name in its address
            found.url = c.url
            found.show_id = c.show_id
    return result


async def row_list(entry: dr.PageEntry) -> dr.PageList:
    """A row's first items, which DR only sends along with the page for the first few rows"""
    if entry.list.items:
        return entry.list
    return dr.PageList.model_validate(await get_api(f"/lists/{entry.list.id}", page_size=ROW_SIZE))


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


def simple(text: str) -> str:
    """Like "nyhederogdebat" for "Nyheder og debat", to compare names of categories"""
    text = text.lower().replace("æ", "ae").replace("ø", "oe").replace("å", "aa")
    return re.sub(r"[^a-z]", "", text)


def category_url(name: str, categories: list["Category"]) -> Optional[str]:
    """The category for one of DR's, like "Fiktionsserie" for the Serier at /kategorier/fiktionsserier/"""
    if not name:
        return None
    wanted = simple(name)
    for c in categories:
        slug = simple(c.url.rstrip("/").split("/")[-1])
        if slug.startswith(wanted) or wanted.startswith(slug):
            return c.url
    return None


async def build_page(path: str, max_rows: int) -> DiscoverPage:
    page = dr.Page.model_validate(
        await get_api("/page", path=path, list_page_size=ROW_SIZE, max_list_prefetch=3)
    )
    channels = await get_channels()
    channel_slugs = {c.id: slug for slug, c in channels.items()}

    categories = await get_categories()
    featured = []
    hero = next((e for e in page.entries if (e.template or "").startswith(("DRH", "H")) and e.list), None)
    if hero is not None:
        featured = cards((await row_list(hero)).items, channel_slugs)
        for c in featured:
            c.category_url = category_url(c.category, categories)

    entries = [e for e in page.entries if is_row(e)][:max_rows]
    results = await asyncio.gather(*map(row_list, entries), return_exceptions=True)
    rows = []
    for entry, found in zip(entries, results):
        if isinstance(found, BaseException):
            print("Could not get a row of", path, entry.title, repr(found))
            continue
        more = found.id if found.paging.total > 1 else None
        row = Row(entry.title.strip(), cards(found.items, channel_slugs), more)
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


@dataclass
class FullList:
    title: str
    cards: list[Card]


lists: dict[str, tuple[float, FullList]] = {}


async def get_list(list_id: str) -> Optional[FullList]:
    """All of one of DR's lists, which rows only show the start of, or None if DR doesn't have it"""
    cached = lists.get(list_id)
    if cached is not None and cached[0] + PAGE_CACHE_TIME > time():
        return cached[1]
    try:
        first = dr.PageList.model_validate(await get_api(f"/lists/{list_id}", page_size=LIST_PAGE_SIZE, page=1))
        pages = min(first.paging.total, MAX_LIST // LIST_PAGE_SIZE)
        rest = await asyncio.gather(*(
            get_api(f"/lists/{list_id}", page_size=LIST_PAGE_SIZE, page=page) for page in range(2, pages + 1)
        ))
        items = first.items + [item for blob in rest for item in dr.PageList.model_validate(blob).items]
        channels = await get_channels()
        found = FullList(first.title or "", cards(items, {c.id: slug for slug, c in channels.items()}))
    except Exception as e:
        print("Could not get DR's list", list_id, repr(e))
        return cached[1] if cached is not None else None
    lists[list_id] = (time(), found)
    return found


categories_cache: tuple[float, list[Category]] = (0, [])


# DR's widest categories, which a programme's narrower ones, like Krimi, say more about
MAIN_CATEGORIES = ["fiktionsserie", "film", "dokumentar"]
# News, whose page is mostly the day's news, not something to watch next
NOT_SIMILAR = ["nyheder"]
# How many programmes to suggest from a category, at most, and how few make it worth trying a wider one
SIMILAR = 8
SIMILAR_ENOUGH = 4


async def similar_to(categories: list[str], exclude: str) -> dict:
    """Programmes like one with DR's categories, like ["fiktionsserie", "krimi"], for after it: from the page of
    its narrowest category that DR has a page for, without the programme itself, whose DR id `exclude` is:
    the next one, when a category's page has fewer than 4 others.
    Like the Worker's similarTo()."""
    pages = await get_categories()

    def page_of(category: str) -> Optional[Category]:
        for p in pages:
            slug = p.url.rstrip("/").split("/")[-1]
            if slug in (category, category + "r") or (len(category) > 4 and slug.startswith(category)):
                return p
        return None

    narrow = [c for c in categories if c not in MAIN_CATEGORIES and c not in NOT_SIMILAR]
    ordered = narrow + [c for c in categories if c in MAIN_CATEGORIES]
    best = {"label": "", "cards": []}
    for category in ordered:
        found = page_of(category)
        if found is None:
            continue
        page = await get_page(found.url.rstrip("/"), max_rows=12)
        seen = {exclude}
        cards = []
        for c in [*(page.featured if page else []), *(card for row in (page.rows if page else []) for card in row.cards)]:
            card_id = (c.show_id or c.film_id or "").split("_")[-1]
            if c.live or not card_id or card_id in seen or len(cards) >= SIMILAR:
                continue
            seen.add(card_id)
            cards.append({"title": c.title, "url": c.url, "image": thumbnail(c.image)})
        if len(cards) >= SIMILAR_ENOUGH:
            return {"label": found.title, "cards": cards}
        if len(cards) > len(best["cards"]):
            best = {"label": found.title, "cards": cards}
    return best


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
