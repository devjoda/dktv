"""Re-captures the test fixtures from the live DRTV site.

Run from the repository root with `python -m tests.update_fixtures`.

The pages are trimmed down to the parts of `window.__data` we actually read,
but DR's items are kept whole, so the fixtures stay realistic.
When DR changes their format, run this and look at the git diff.
"""

import asyncio
import json
from pathlib import Path

from aiohttp import ClientSession, TCPConnector

from drtvrss.drtv import fetch_search, get_jsonblob, ssl_context

FIXTURES = Path(__file__).parent / "fixtures"

SERIES = "rejseholdet_503605"
EPISODE = "matador_-foedselsdagen_540744"
PROGRAM = "lise-noergaard_-ikke-kun-en-pige_362031"
SEARCH = "matador"


def save(name: str, blob):
    path = FIXTURES / name
    path.write_text(json.dumps(blob, ensure_ascii=False, indent=1) + "\n")
    print("Wrote", path)


def trim_page(blob: dict) -> dict:
    """Keeps only cache.page[...].item"""
    pages = blob["cache"]["page"]
    return {"cache": {"page": {k: {"item": v["item"]} for k, v in pages.items()}}}


async def main():
    async with ClientSession(connector=TCPConnector(ssl=ssl_context)) as session:
        series = await get_jsonblob(session, f"https://www.dr.dk/drtv/serie/{SERIES}")
        save("series.json", {"cache": {"itemDetail": series["cache"]["itemDetail"]}})

        latest = list(series["cache"]["itemDetail"].values())[-1]["item"]
        for season in latest["show"]["seasons"]["items"]:
            path = season["path"]
            blob = await get_jsonblob(session, "https://www.dr.dk/drtv" + path)
            save(f"season_{path.split('_')[-1]}.json", trim_page(blob))

        blob = await get_jsonblob(session, f"https://dr.dk/drtv/episode/{EPISODE}")
        save("episode.json", trim_page(blob))

        blob = await get_jsonblob(session, f"https://www.dr.dk/drtv/program/{PROGRAM}")
        save("program.json", trim_page(blob))

        blob = await get_jsonblob(session, "https://www.dr.dk/drtv/kanal/dr1_20875")
        save("channels.json", {"cache": {"list": blob["cache"]["list"]}})

    r = await fetch_search(SEARCH)
    save("search.json", {"series": r["series"], "playable": r["playable"]})


if __name__ == "__main__":
    asyncio.run(main())
