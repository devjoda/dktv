"""DR's whole catalogue: every series, film and programme on DR's list of everything from A to Å, for Vælg for mig,
Alle titler, the search field, Hvad nu? and the front page's own rows. Like the Worker's catalogue.ts, which keeps it in
its database; here it's kept in memory, got again once a day, with each title's own item looked up a little at a time.
What the browser gets of each title, its entry, is made the same way, from the same filters in facets.json."""

from datetime import date, datetime
from pathlib import Path
from time import time
from typing import Optional
from urllib.parse import quote
from zoneinfo import ZoneInfo
import asyncio
import json
import math
import random
import re

from werkzeug.exceptions import NotFound

from . import drtv
from .discover import CATEGORY_LIST
from .show import thumbnail

A_TO_AA = "/kategorier/a-aa"
PAGE_SIZE = 100
DAY = 24 * 60 * 60
# How long the catalogue is kept before DR's list is gone through again, and how long between looking up titles
SWEEP_EVERY = DAY
LOOK_UP_EVERY = 0.5
# How much of a letter must be found again for what wasn't to be taken as gone, instead of DR leaving some out
KEPT_SHARE = 0.8
# How many of DR's own rows' titles are read, of each row
ROW_SIZE = 30

FACETS_FILE = json.loads((Path(__file__).parent / "facets.json").read_text())
FACETS = FACETS_FILE["facets"]
BY_WORD: dict[str, list[tuple[str, str]]] = {}
for _facet in FACETS:
    for _value in _facet.get("values", []):
        for _word in _value.get("from", []):
            BY_WORD.setdefault(_word, []).append((_facet["id"], _value["id"]))
NOT_SHOWN = set(FACETS_FILE["notShown"])
KIDS = set(FACETS_FILE["kidsUniverses"])
NOT_TOPICS = set(FACETS_FILE["notTopics"])
NOT_PEOPLE = set(FACETS_FILE["notPeople"])
NOT_COUNTRIES = set(FACETS_FILE["notCountries"])
NAMES = FACETS_FILE["names"]
KNOWN_COUNTRIES = {w[len("country:"):] for f in FACETS if f["id"] == "land" for v in f["values"] for w in v.get("from", [])}

# The facets' names and their values' labels, for the browser, as the Worker's FACET_LABELS
FACET_LABELS = [
    {"id": f["id"], "label": f["label"], **({"open": True} if f.get("open") else {}),
     **({"values": [{"id": v["id"], "label": v["label"]} for v in f["values"]]} if "values" in f else {})}
    for f in FACETS
]

PREFIXES = {"editorialptaxtop": "top", "editorialptaxsub": "sub", "mood": "mood", "culturalorigin": "origin", "agetargetgroup": "age"}


def _text(value) -> Optional[str]:
    return value if isinstance(value, str) else None


def _integer(value) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r"\s*-?\d+\s*", value):
        return int(value)
    return None


def parse_time(value) -> Optional[int]:
    """A time from DR, like 2026-10-12T11:40:00Z, in milliseconds"""
    if not isinstance(value, str) or not re.match(r"\d{4}-\d\d-\d\d", value):
        return None
    try:
        text = re.sub(r"(\.\d{3})\d+", r"\1", value).replace("Z", "+00:00")
        return round(datetime.fromisoformat(text).timestamp() * 1000)
    except ValueError:
        return None


def _available_until(blob) -> Optional[int]:
    ends = [parse_time((o or {}).get("endDate")) for o in (blob or {}).get("offers") or []]
    ends = [e for e in ends if e is not None]
    return max(ends) if ends else None


def _available_from(blob) -> Optional[int]:
    return parse_time(((blob or {}).get("customFields") or {}).get("AvailableFrom"))


def _length_in_minutes(blob) -> Optional[int]:
    parts = (_text(((blob or {}).get("customFields") or {}).get("ExtraDetails")) or "").split(" | ")
    if len(parts) != 2:
        return None
    match = re.fullmatch(r"\s*(?:(\d+)T)?\s*(?:(\d+)M)?\s*", parts[1])
    if match is None or (match[1] is None and match[2] is None):
        return None
    return int(match[1] or 0) * 60 + int(match[2] or 0)


def _clean(value: dict) -> dict:
    """Without what isn't there, like the Worker's clean()"""
    return {k: v for k, v in value.items() if v is not None and v != []}


def _round(number: float) -> int:
    """Like JavaScript's Math.round, which rounds halves up"""
    return math.floor(number + 0.5)


def kept_item(blob) -> Optional[dict]:
    """What's kept of one of the items on DR's list, or None for what isn't a series or a programme"""
    if not isinstance(blob, dict) or blob.get("type") not in ("show", "program"):
        return None
    item_id = str(blob["id"]) if isinstance(blob.get("id"), int) else _text(blob.get("id"))
    title, path = _text(blob.get("title")), _text(blob.get("path"))
    if not item_id or not title or not path:
        return None
    fields = blob.get("customFields") or {}
    until = [u for u in (parse_time((r or {}).get("To")) for r in fields.get("OfferDateTimeRanges") or []) if u is not None]
    duration = blob.get("duration")
    item = {
        "id": item_id, "type": blob["type"], "title": title, "path": path,
        "image": _text((blob.get("images") or {}).get("wallpaper")),
        "description": _text(blob.get("shortDescription")) or None,
        "categories": [c.lower() for c in blob.get("categories") or [] if isinstance(c, str)],
        "keywords": [k for k in blob.get("keywords") or [] if isinstance(k, str)],
        "year": _integer(blob.get("releaseYear")),
        "duration": duration if isinstance(duration, (int, float)) and not isinstance(duration, bool) and duration > 0 else None,
        "seasons": _integer(blob.get("availableSeasonCount")),
        "availableFrom": _available_from(blob),
        "availableUntil": max(until) if until else None,
        "universes": [u.lower() for u in fields.get("ContentUniverses") or [] if isinstance(u, str)],
        "rating": _text(fields.get("ClassificationRating")),
        "country": _text(fields.get("ProductionCountry")),
        "access": [a for a in (_text(fields.get("AccessServicesOffered")) or "").split(",") if a],
        "ongoing": True if fields.get("PresentationTypeCode") == "Ongoing" else None,
    }
    # Without what isn't there, so the same item is always the same, but with its lists, if empty
    return {k: v for k, v in item.items() if v is not None}


def names_after(description: str, labels: list[str]) -> list[str]:
    """The names after a label at the start of a line of a description, like "Medvirkende: Sofie Torp, Thomas Hwan m.fl." """
    match = re.search(rf"(?:^|\n)\s*(?:{'|'.join(labels)}):\s*([^\n]+)", description)
    if match is None:
        return []
    line = re.split(r"\.\s+(?=[A-ZÆØÅ][a-zæøå]+:)", match[1])[0]
    line = re.sub(r"\s*(?:m\.\s?fl|med flere)\.?\s*$", "", line, flags=re.IGNORECASE)
    line = re.sub(r"[.\s]+$", "", line)
    found = []
    for name in (n.strip() for n in re.split(r"\s*,\s*|\s+og\s+", line)):
        if 1 < len(name) <= 60 and name[:1].isupper() and name not in found:
            found.append(name)
    return found[:10]


def _access_of(blobs) -> Optional[list[str]]:
    found = []
    for b in blobs:
        for a in (_text(((b or {}).get("customFields") or {}).get("AccessServicesOffered")) or "").split(","):
            if a and a not in found:
                found.append(a)
    return found or None


def programme_details(blob) -> dict:
    """What a programme's own item says, like a film's"""
    description = _text((blob or {}).get("description")) or ""
    return _clean({
        "expires": _available_until(blob),
        "country": _text(((blob or {}).get("customFields") or {}).get("ProductionCountry")),
        "access": _access_of([blob]),
        "cast": names_after(description, ["Medvirkende"]),
        "directors": names_after(description, ["Instruktion", "Instruktør", "Instrueret af"]),
    })


def series_details(show, season) -> dict:
    """What a series' own item says, with all of its seasons, and what its newest season's own item says"""
    seasons = ((show or {}).get("seasons") or {}).get("items") or []
    years = [y for y in (_integer((s or {}).get("releaseYear")) for s in seasons) if y is not None]
    count = sum((_integer((s or {}).get("availableEpisodeCount")) or _integer((s or {}).get("episodeCount")) or 0) for s in seasons)
    episodes = ((season or {}).get("episodes") or {}).get("items") or []

    def length(e):
        seconds = e.get("duration")
        return seconds / 60 if isinstance(seconds, (int, float)) and not isinstance(seconds, bool) and seconds > 0 else _length_in_minutes(e)

    lengths = sorted(m for m in map(length, episodes) if m is not None)
    published = [p for p in (_available_from(e) for e in episodes) if p is not None]
    next_episode = _integer(((show or {}).get("nextEpisode") or {}).get("availableUTC"))
    return _clean({
        "expires": _available_until(show) or (_available_until(season) if season else None),
        "years": [min(years), max(years)] if years else None,
        "seasons": len(seasons) or None,
        "episodes": count or None,
        "minutes": _round(lengths[len(lengths) // 2]) if lengths else None,
        "latest": max(published) if published else None,
        "next": next_episode * 1000 if next_episode is not None else None,
        "country": next((c for c in (_text((e.get("customFields") or {}).get("ProductionCountry")) for e in episodes) if c), None),
        "access": _access_of(episodes),
    })


def _letters(value: str) -> str:
    return re.sub(r"[^a-z]", "", value.lower())


def words_of(item: dict, details: Optional[dict] = None) -> list[str]:
    """DR's words for a title, like ["cat:krimi", "sub:thriller/krimi", "mood:nervepirrende", "country:SVERIGE"]"""
    found = []

    def add(word):
        if word not in found:
            found.append(word)

    for category in item["categories"]:
        add("acc:" + _letters(category[4:]) if category.startswith("acc_") else "cat:" + category)
    for keyword in item["keywords"]:
        at = keyword.find("_")
        prefix = PREFIXES.get(keyword[:at]) if at > 0 else None
        if prefix:
            add(f"{prefix}:{keyword[at + 1:].lower()}")
    for access in item["access"] + ((details or {}).get("access") or []):
        add("acc:" + _letters(access))
    country = (details or {}).get("country") or item.get("country")
    if country:
        add("country:" + country)
    if item.get("rating"):
        add("rating:" + re.sub(r"^MRAM-", "", item["rating"], flags=re.IGNORECASE).lower())
    return found


def kind_of(item: dict, words: list[str]) -> Optional[str]:
    """What kind a title is, or None for what isn't shown, like news and sport"""
    def has(*wanted):
        return any(w in words for w in wanted)

    if any(w in NOT_SHOWN for w in words):
        return None
    if has("cat:dokumentar", "top:dokumentar", "sub:dokumentar"):
        return "dokumentar"
    if item["type"] == "show":
        return "serie" if has("cat:fiktionsserie", "top:serier", "sub:serier") else "program"
    return "film" if has("cat:film", "top:film", "sub:film") else "program"


SMALL_WORDS = {"af", "og", "von", "van", "de", "der", "den", "la", "le", "du", "di", "da", "el", "al", "bin", "ibn"}
ROMAN = re.compile(r"(i{1,3}|iv|vi{0,3}|ix|x{1,2})")


def proper_name(name: str) -> str:
    """A name as it's written, like "Margrethe II, Dronning, Danmark" for DR's "margrethe ii, dronning, danmark" """
    if name in NAMES:
        return NAMES[name]
    first = True

    def word(match):
        nonlocal first
        was_first, first = first, False
        w = match[0]
        if ROMAN.fullmatch(w):
            return w.upper()
        if not was_first and w in SMALL_WORDS:
            return w
        return w[:1].upper() + w[1:]

    return re.sub(r"[\w'.]+", word, name)


def _keywords_of(item: dict, prefixes: list[str]) -> list[str]:
    values = []
    for k in item["keywords"]:
        if any(k.startswith(p + "_") for p in prefixes):
            value = k[k.find("_") + 1:].strip()
            if value and not value.lower().startswith("test"):
                values.append(value)
    return values


def _decade(year: int) -> str:
    return "aeldre" if year < 1960 else str(min(year // 10 * 10, 2020))


def _length(minutes: int) -> str:
    return "kort" if minutes <= 30 else "time" if minutes <= 60 else "aften" if minutes <= 90 else "lang"


def entry_of(item: dict, details: Optional[dict], rows: Optional[list[str]], first_seen: int) -> dict:
    """A title's entry, from what's kept of it, with its kind, whether it's for children, and when it leaves DR"""
    details = details or {}
    words = words_of(item, details)
    kind = kind_of(item, words)
    slug = item["path"].rstrip("/").split("/")[-1]
    f: dict[str, list[str]] = {}

    def add(facet, value):
        values = f.setdefault(facet, [])
        if value not in values:
            values.append(value)

    if kind:
        add("type", kind)
    for w in words:
        for facet, value in BY_WORD.get(w, []):
            add(facet, value)
    country = details.get("country") or item.get("country")
    if country and country not in NOT_COUNTRIES and country not in KNOWN_COUNTRIES:
        add("land", "verden")
    for topic in (t.lower() for t in _keywords_of(item, ["thesaurus", "controlled"])):
        if topic not in NOT_TOPICS and len(f.get("emne", [])) < 8:
            add("emne", topic)
    people = [proper_name(p) for p in _keywords_of(item, ["person", "franchise"])] + details.get("cast", []) + details.get("directors", [])
    for person in people:
        if person not in NOT_PEOPLE and len(f.get("person", [])) < 12:
            add("person", person)
    year = (details.get("years") or [None])[0] or item.get("year")
    if year:
        add("aarti", _decade(year))
    minutes = _round(item["duration"] / 60) if item["type"] == "program" and item.get("duration") else details.get("minutes")
    if minutes:
        add("tid", _length(minutes))
    seasons = item.get("seasons") or details.get("seasons")
    if item["type"] == "show" and seasons:
        add("omfang", "en" if seasons == 1 else "flere" if seasons <= 4 else "mange")
    for row in rows or []:
        add("udvalgt", row)
    expires = details.get("expires") or item.get("availableUntil")
    # When it came: when it was first seen, which for what was there from the start is 0, or a programme when DR says it did
    added = max((item.get("availableFrom") or 0) if item["type"] == "program" else 0, first_seen)
    entry = _clean({
        "id": item["id"], "t": item["title"],
        "u": f"/{slug}/" if item["type"] == "show" else f"/program/{slug}",
        "k": kind or "program", "i": thumbnail(item.get("image")), "y": year, "m": minutes,
        "s": seasons if item["type"] == "show" else None, "e": details.get("episodes"),
        "x": expires, "n": added, "l": details.get("latest"), "w": details.get("next"), "f": f,
    })
    return {"entry": entry, "kind": kind, "kids": any(u in KIDS for u in item["universes"]), "expires": expires, "added": added}


class Catalogue:
    """The titles, by DR's id, with what's kept of each: its item, details, rows, when it was first seen, and its entry"""

    def __init__(self):
        self.titles: dict[str, dict] = {}
        self.swept: float = 0
        self.first = True
        self.version = 0

    def make(self, title: dict):
        title.update(entry_of(title["item"], title.get("details"), title.get("rows"), title["first_seen"]))
        self.version = round(time() * 1000)

    def shown(self, now_ms: Optional[int] = None) -> list[dict]:
        now_ms = now_ms if now_ms is not None else round(time() * 1000)
        return [t["entry"] for t in self.titles.values()
                if t.get("kind") and not t.get("kids") and t.get("missing") is None and not (t.get("expires") and t["expires"] <= now_ms)]


catalogue = Catalogue()


def _missing_from(error) -> bool:
    return isinstance(error, NotFound) or getattr(error, "code", None) == 404


async def get_letters() -> list[dict]:
    """The rows of DR's list from A to Å: one for each letter"""
    page = await drtv.get_api("/page", path=A_TO_AA, list_page_size=1, max_list_prefetch=0)
    found = []
    for entry in page.get("entries") or []:
        lst = entry.get("list") or {}
        title = (entry.get("title") or "").strip()
        param = lst.get("parameter") or ""
        if lst.get("id") is not None and param.startswith("TitleGroupKey:") and title and all(l["title"] != title for l in found):
            found.append({"title": title, "list": str(lst["id"]), "param": param})
    return found


async def get_featured() -> dict[str, list[str]]:
    """Which of DR's own rows, on its front page and its categories' pages, each title is on"""
    categories = await drtv.get_api(f"/lists/{CATEGORY_LIST}", page_size=50)
    paths = ["/"] + [p for p in ((i.get("path") or "") for i in categories.get("items") or [])
                     if p.startswith("/kategorier/") and p != A_TO_AA and not re.search(r"nyheder|sport", p)]
    rows: list[tuple[str, str]] = []
    for path in paths:
        try:
            page = await drtv.get_api("/page", path=path, list_page_size=1, max_list_prefetch=0)
        except Exception as e:
            if _missing_from(e):
                continue
            raise
        for entry in page.get("entries") or []:
            template = entry.get("template") or ""
            title = (entry.get("title") or "").strip()
            list_id = str((entry.get("list") or {}).get("id")) if (entry.get("list") or {}).get("id") is not None else None
            if (list_id and template[:1] in ("P", "T") and not template.startswith("TX") and len(title) > 1
                    and not re.search(r"\bA\s*-\s*Å\b", title, re.IGNORECASE) and all(l != list_id for _, l in rows)):
                rows.append((title, list_id))
    featured: dict[str, list[str]] = {}
    for title, list_id in rows:
        try:
            blob = await drtv.get_api(f"/lists/{list_id}", page_size=ROW_SIZE)
        except Exception as e:
            if _missing_from(e):
                continue
            raise
        for item in blob.get("items") or []:
            kind = item.get("type")
            item_id = item.get("showId") if kind in ("season", "episode") else item.get("id") if kind in ("show", "program") else None
            if item_id is not None:
                titles = featured.setdefault(str(item_id), [])
                if title not in titles:
                    titles.append(title)
    return featured


async def sweep():
    """Goes through DR's list from A to Å, writing what's new or changed, and noting what's gone, to be looked up"""
    now_ms = round(time() * 1000)
    for letter in await get_letters():
        before = [t for t in catalogue.titles.values() if t["letter"] == letter["title"] and t.get("missing") is None]
        found = set()
        page = 1
        while True:
            try:
                blob = await drtv.get_api(f"/lists/{letter['list']}", page_size=PAGE_SIZE, page=page, param=letter["param"])
            except Exception as e:
                if _missing_from(e):
                    break
                raise
            for item in filter(None, map(kept_item, blob.get("items") or [])):
                found.add(item["id"])
                kept = catalogue.titles.get(item["id"])
                shown = not any(u in KIDS for u in item["universes"]) and kind_of(item, words_of(item)) is not None
                if kept is None:
                    kept = catalogue.titles[item["id"]] = {"first_seen": 0 if catalogue.first else now_ms, "due": 0 if shown else math.inf}
                elif kept["item"] != item:
                    kept["due"] = min(kept["due"], 0 if shown else math.inf)
                if kept.get("missing") is not None:
                    kept["due"] = -1
                kept.update(item=item, letter=letter["title"])
                catalogue.make(kept)
            if page >= ((blob.get("paging") or {}).get("total") or 1):
                break
            page += 1
        if len(found) >= len(before) * KEPT_SHARE:
            for t in before:
                if t["item"]["id"] not in found:
                    t["missing"] = now_ms
                    t["due"] = -1
    featured = await get_featured()
    for title in catalogue.titles.values():
        rows = featured.get(title["item"]["id"])
        if rows != title.get("rows"):
            title["rows"] = rows
            catalogue.make(title)
    for item_id in [i for i, t in catalogue.titles.items() if t.get("missing") is not None and t["missing"] < now_ms - 30 * DAY * 1000]:
        del catalogue.titles[item_id]
    catalogue.first = False
    catalogue.swept = time()


def _next_look_up(item: dict, details: dict) -> float:
    now = time()
    spread = random.random() * DAY
    expires = details.get("expires")
    if expires is not None and expires / 1000 - now < 8 * DAY:
        return min(now + DAY, max(now + 3600, expires / 1000 + 3600))
    if item["type"] == "show" and (details.get("next") is not None or item.get("ongoing")):
        return now + 3 * DAY + spread
    return now + 14 * DAY + spread


async def look_up(title: dict):
    """A title's own item, and a series' newest season's"""
    item = title["item"]
    try:
        if item["type"] == "show":
            show = await drtv.get_api(f"/items/{item['id']}", expand="all")
            newest = (((show.get("seasons") or {}).get("items")) or [None])[-1]
            season = None
            if newest and newest.get("id") is not None:
                try:
                    season = await drtv.get_api(f"/items/{newest['id']}", expand="all")
                except Exception as e:
                    if not _missing_from(e):
                        raise
            details = series_details(show, season)
        else:
            details = programme_details(await drtv.get_api(f"/items/{item['id']}"))
    except Exception as e:
        if _missing_from(e):
            # Gone: left out, and asked about again in a week
            title["missing"] = title.get("missing") or round(time() * 1000)
            title["due"] = time() + 7 * DAY
            return
        print("Could not look up", item["id"], repr(e))
        title["due"] = time() + 3600
        return
    title.update(details=details, due=_next_look_up(item, details), missing=None)
    catalogue.make(title)


async def keep_catalogue():
    """Goes through DR's list once a day, and looks up the titles that are due in between, one at a time"""
    while True:
        if catalogue.swept + SWEEP_EVERY < time():
            try:
                await sweep()
            except Exception as e:
                print("Could not go through DR's list", repr(e))
                # Tried again in an hour
                catalogue.swept = time() - SWEEP_EVERY + 3600
        due = sorted((t for t in catalogue.titles.values() if t["due"] <= time()), key=lambda t: t["due"])
        if due:
            await look_up(due[0])
        await asyncio.sleep(LOOK_UP_EVERY if due else 60)


def catalogue_json() -> dict:
    """The catalogue as the browser gets it, like the Worker's /katalog.json"""
    return {"version": catalogue.version, "facets": FACET_LABELS, "titles": catalogue.shown()}


# The front page's own rows, as the Worker's buildRows() makes them
MOOD_ROWS = [
    ("spaending", "Nervepirrende serier og film"),
    ("foelelser", "Store følelser"),
    ("sjovt", "Noget at grine af"),
    ("hygge", "Hyggelige serier og film"),
    ("moerkt", "Mørkt og råt"),
    ("klogt", "Tankevækkende"),
]
OWN_ROW_SIZE = 24
OWN_ROW_LEAST = 4
THEME_LEAST = 8


def own_rows(now: Optional[float] = None) -> list[dict]:
    """What leaves DR soon, new films, a mood, a theme and something short, from the catalogue"""
    now = now if now is not None else time()
    now_ms = round(now * 1000)
    shown = [t for t in catalogue.titles.values() if t.get("kind") and not t.get("kids") and t.get("missing") is None
             and not (t.get("expires") and t["expires"] <= now_ms)]
    local = datetime.fromtimestamp(now, COPENHAGEN)
    day = (local.date() - date(1970, 1, 1)).days
    seed = day % 1000 + 7919

    def of_the_day(found):
        return [t["entry"] for t in sorted(found, key=lambda t: (t.get("rows") is None, int(t["item"]["id"]) * seed % 1000003))][:OWN_ROW_SIZE]

    def has(t, facet, value):
        return value in t["entry"]["f"].get(facet, [])

    mood, mood_title = MOOD_ROWS[day % len(MOOD_ROWS)]
    rows = [
        {"id": "sidste-chance", "title": "Sidste chance", "more": "/alle/?aktuelt=sidste-chance&sorter=udloeber",
         "entries": [t["entry"] for t in sorted((t for t in shown if t.get("expires") and now_ms + 12 * 3600_000 < t["expires"] < now_ms + 14 * DAY * 1000),
                                                key=lambda t: t["expires"])][:OWN_ROW_SIZE]},
        {"id": "nye-film", "title": "Nye film", "more": "/alle/?type=film&sorter=nyeste",
         "entries": [t["entry"] for t in sorted((t for t in shown if t["kind"] == "film" and (t.get("added") or 0) > now_ms - 90 * DAY * 1000),
                                                key=lambda t: -(t.get("added") or 0))][:OWN_ROW_SIZE]},
        {"id": "stemning", "title": mood_title, "more": f"/alle/?stemning={mood}", "entries": of_the_day([t for t in shown if has(t, "stemning", mood)])},
        {"id": "kort", "title": "Kort tid? Under en halv time", "more": "/alle/?tid=kort",
         "entries": of_the_day([t for t in shown if t["kind"] != "film" and 5 <= (t["entry"].get("m") or 0) <= 30])},
    ]
    counts: dict[str, int] = {}
    for t in shown:
        for topic in t["entry"]["f"].get("emne", []):
            counts[topic] = counts.get(topic, 0) + 1
    themes = [topic for topic, n in sorted(counts.items(), key=lambda kv: -kv[1]) if n >= THEME_LEAST][:60]
    theme = "jul" if local.month == 12 and "jul" in themes else themes[day % len(themes)] if themes else None
    if theme is not None:
        rows.insert(3, {"id": "tema", "title": f"Tema: {theme[:1].upper()}{theme[1:]}", "more": f"/alle/?emne={quote(theme)}",
                        "entries": of_the_day([t for t in shown if has(t, "emne", theme)])})
    return [row for row in rows if len(row["entries"]) >= OWN_ROW_LEAST]


COPENHAGEN = ZoneInfo("Europe/Copenhagen")


def leaving_label(at_ms: Optional[int], now: Optional[float] = None) -> Optional[str]:
    """Like "Udløber om 5 dage", if it leaves DR within a month, in whole days of Denmark's calendar, like the Worker's"""
    now = now if now is not None else time()
    if not at_ms or at_ms / 1000 < now or at_ms / 1000 - now > 30 * DAY:
        return None
    days = (datetime.fromtimestamp(at_ms / 1000, COPENHAGEN).date() - datetime.fromtimestamp(now, COPENHAGEN).date()).days
    return "Udløber i dag" if days <= 0 else "Udløber i morgen" if days == 1 else f"Udløber om {days} dage"


def status() -> dict:
    return {"catalogue": {"titles": len(catalogue.shown()), "version": catalogue.version,
                          "waitingToBeLookedUp": sum(1 for t in catalogue.titles.values() if t["due"] <= time()),
                          "lastSweep": round(catalogue.swept * 1000) or None}}
