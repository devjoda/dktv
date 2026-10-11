"""Re-captures the test fixtures from DR's API.

Run from the repository root with `python -m tests.update_fixtures`.

Each response is saved as it is, named after its path in the API,
so `/items/503605` is saved as `items_503605.json`.
When DR changes their format, run this and look at the git diff.
"""

import asyncio
import json
from pathlib import Path

from drtvrss.drtv import fetch_search, get_api, http_session
from drtvrss.live import CHANNEL_LIST

FIXTURES = Path(__file__).parent / "fixtures"

SHOW = "503605"  # Rejseholdet
EPISODE = "540744"  # Matador: Fødselsdagen
PROGRAM = "362031"  # Lise Nørgaard: Ikke kun en pige
SEARCH = "matador"


def fixture_name(path: str) -> str:
    return path.strip("/").replace("/", "_") + ".json"


def save(name: str, blob):
    path = FIXTURES / name
    path.write_text(json.dumps(blob, ensure_ascii=False, indent=1) + "\n")
    print("Wrote", path)


async def capture(path: str, **params) -> dict:
    blob = await get_api(path, **params)
    save(fixture_name(path), blob)
    return blob


async def main():
    async with http_session():
        show = await capture(f"/items/{SHOW}", expand="all")
        for season in show["seasons"]["items"]:
            await capture(f"/items/{season['id']}", expand="all")
        await capture(f"/items/{EPISODE}")
        await capture(f"/items/{PROGRAM}")
        await capture(f"/lists/{CHANNEL_LIST}", page_size=24)

        r = await fetch_search(SEARCH)
        save("search.json", {"series": r["series"], "playable": r["playable"]})


if __name__ == "__main__":
    asyncio.run(main())
