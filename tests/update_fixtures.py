"""Re-captures the test fixtures from DR's API.

Run from the repository root with `python -m tests.update_fixtures`.

Each response is saved as it is, named after its path in the API,
so `/items/503605` is saved as `items_503605.json`, and DR's pages after
theirs, so `/page?path=/kategorier/film` is saved as `page_kategorier_film.json`.
The letters of DR's list from A to Å are saved with their letter, like
`lists_348_m.json`, with only the titles the tests have the items of.
When DR changes their format, run this and look at the git diff.
"""

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from drtvrss.catalogue import A_TO_AA
from drtvrss.discover import CATEGORY_LIST, ROW_SIZE
from drtvrss.drtv import fetch_search, get_api, http_session
from drtvrss.live import CHANNEL_LIST, SCHEDULE_HOURS

FIXTURES = Path(__file__).parent / "fixtures"

SHOW = "503605"  # Rejseholdet
EPISODE = "540744"  # Matador: Fødselsdagen
PROGRAM = "362031"  # Lise Nørgaard: Ikke kun en pige
SEARCH = "matador"
# DR's pages, as in discover.py
PAGES = ["/", "/kategorier/fiktionsserier"]
# The titles of DR's list from A to Å that the tests have, by letter: a documentary, a film, series, news and children's
# series, which aren't shown, and Red Rock West, whose item isn't kept, so it's as if DR doesn't have it any more
CATALOGUE = {
    "L": ["362031"],
    "M": ["619917", "584100", "617585", "540736", "296793"],
    "R": ["595127", "503605", "225290"],
}
# Their items, besides those above, and the series of them, whose newest seasons are kept too
CATALOGUE_PROGRAMS = ["619917"]
CATALOGUE_SHOWS = ["540736", "617585"]


def fixture_name(path: str, params: dict = None) -> str:
    if path == "/page":
        return "page_" + (params["path"].strip("/").replace("/", "_") or "front") + ".json"
    name = path.strip("/").replace("/", "_")
    param = (params or {}).get("param", "")
    if param.startswith("TitleGroupKey:"):
        letter = param.split(":", 1)[1].lower().replace("æ", "ae").replace("ø", "oe").replace("å", "aa")
        name += "_" + letter
    return name + ".json"


def save(name: str, blob):
    path = FIXTURES / name
    path.write_text(json.dumps(blob, ensure_ascii=False, indent=1) + "\n")
    print("Wrote", path)


async def capture(path: str, /, **params) -> dict:
    blob = await get_api(path, **params)
    save(fixture_name(path, params), blob)
    return blob


async def capture_schedules(channels: dict):
    now = datetime.now(timezone.utc)
    await capture(
        "/schedules",
        date=now.strftime("%Y-%m-%d"),
        hour=now.hour,
        channels=",".join(c["id"] for c in channels["items"]),
        duration=SCHEDULE_HOURS,
    )


async def capture_pages():
    """Only the pages, and the rows DR sends along with them; tests do without the other rows"""
    for path in PAGES:
        await capture("/page", path=path, list_page_size=ROW_SIZE, max_list_prefetch=3)
    await capture(f"/lists/{CATEGORY_LIST}", page_size=50)


async def capture_catalogue():
    """DR's list from A to Å, with only the letters and titles in CATALOGUE, and their items"""
    layout = await get_api("/page", path=A_TO_AA, list_page_size=1, max_list_prefetch=0)
    layout["entries"] = [e for e in layout["entries"]
                         if not ((e.get("list") or {}).get("parameter") or "").startswith("TitleGroupKey:") or e.get("title") in CATALOGUE]
    save(fixture_name("/page", {"path": A_TO_AA}), layout)
    for entry in layout["entries"]:
        ids = CATALOGUE.get(entry.get("title"))
        if ids is None:
            continue
        params = {"page_size": 100, "page": 1, "param": entry["list"]["parameter"]}
        path = f"/lists/{entry['list']['id']}"
        blob = await get_api(path, **params)
        blob["items"] = [i for i in blob["items"] if str(i["id"]) in ids]
        blob["paging"] = {"total": 1, "page": 1, "size": 100}
        save(fixture_name(path, params), blob)
    for program in CATALOGUE_PROGRAMS:
        await capture(f"/items/{program}")
    for show in CATALOGUE_SHOWS:
        item = await capture(f"/items/{show}", expand="all")
        await capture(f"/items/{item['seasons']['items'][-1]['id']}", expand="all")


async def main():
    async with http_session():
        show = await capture(f"/items/{SHOW}", expand="all")
        for season in show["seasons"]["items"]:
            await capture(f"/items/{season['id']}", expand="all")
        await capture(f"/items/{EPISODE}")
        await capture(f"/items/{PROGRAM}")
        channels = await capture(f"/lists/{CHANNEL_LIST}", page_size=24)
        await capture_schedules(channels)
        await capture_pages()
        await capture_catalogue()

        r = await fetch_search(SEARCH)
        save("search.json", {"series": r["series"], "playable": r["playable"]})


if __name__ == "__main__":
    asyncio.run(main())
