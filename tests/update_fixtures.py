"""Re-captures the test fixtures from DR's API.

Run from the repository root with `python -m tests.update_fixtures`.

Each response is saved as it is, named after its path in the API,
so `/items/503605` is saved as `items_503605.json`, and DR's pages after
theirs, so `/page?path=/kategorier/film` is saved as `page_kategorier_film.json`.
When DR changes their format, run this and look at the git diff.
"""

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

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


def fixture_name(path: str, params: dict = None) -> str:
    if path == "/page":
        return "page_" + (params["path"].strip("/").replace("/", "_") or "front") + ".json"
    return path.strip("/").replace("/", "_") + ".json"


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

        r = await fetch_search(SEARCH)
        save("search.json", {"series": r["series"], "playable": r["playable"]})


if __name__ == "__main__":
    asyncio.run(main())
