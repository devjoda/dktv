from contextlib import suppress
from datetime import datetime
from typing import Optional
import asyncio
import os

from quart import (
    abort,
    Quart,
    Response,
    render_template,
    redirect,
    request,
    send_from_directory,
)

from . import drtv
from .drtv import get_show, get_shows, search, get_program, get_long_description
from .live import get_channels

app = Quart(__name__)

complaints_email = os.getenv("KLAGE_MAIL", None)
SERVICE_NAME = os.getenv("SERVICE_NAME", "Public Service")

# Shorter than the hour shows are cached for, so visitors never wait for these
RECOMMENDED_REFRESH_INTERVAL = 30 * 60


def birthday() -> Optional[int]:
    """If today is April 1st, returns the age of Danmarks Radio in years.
    On any other day of the year, return None"""
    n = datetime.now()
    if n.month == 4 and n.day == 1:
        return n.year - 1925
    return None


async def keep_fresh(recommended_shows: list[str]):
    """Fetches the recommended shows, and keeps fetching them regularly"""
    while True:
        for show in recommended_shows:
            print("Fetching recommended show", show)
            try:
                await get_show(show, max_age=0)
            except Exception as e:
                print("Could not fetch recommended show", show, repr(e))
        await asyncio.sleep(RECOMMENDED_REFRESH_INTERVAL)


refresher: Optional[asyncio.Task] = None


@app.before_serving
async def startup():
    global refresher
    drtv.open_session()
    recommended_shows = [s for s in os.getenv("RECOMMENDED_SHOWS", "").split(":") if s]
    refresher = asyncio.create_task(keep_fresh(recommended_shows))


@app.after_serving
async def shutdown():
    refresher.cancel()
    with suppress(asyncio.CancelledError):
        await refresher
    await drtv.close_session()


@app.route("/")
async def index():
    return await render_template(
        "index.html",
        shows=list(get_shows().items())[:9],
        complaints_email=complaints_email,
        SERVICE_NAME=SERVICE_NAME,
        birthday=birthday(),
        channels=await get_channels(),
    )


@app.route("/favicon.ico")
async def favicon():
    return await send_from_directory(
        os.path.join(app.root_path, "templates"),
        "favicon.ico",
        mimetype="image/vnd.microsoft.icon",
    )


@app.route("/program/<progid>")
async def view_program(progid):
    return await render_template(
        "video.html",
        e=await get_program(progid),
        SERVICE_NAME=SERVICE_NAME,
        birthday=birthday(),
        channels=await get_channels(),
    )


@app.route("/<showid>/<episode>")
async def view_episode(showid, episode):
    show = await get_show(showid)
    e = None
    for season in show.seasons:
        for entry in season.episodes:
            if episode in entry.url:
                e = entry
    if e is None:
        abort(404)
    await get_long_description(e)
    return await render_template(
        "video.html",
        s=show,
        e=e,
        SERVICE_NAME=SERVICE_NAME,
        birthday=birthday(),
        channels=await get_channels(),
    )


@app.route("/<showid>/")
async def view_show(showid):
    show = await get_show(showid)
    return await render_template(
        "show.html",
        s=show,
        SERVICE_NAME=SERVICE_NAME,
        birthday=birthday(),
        channels=await get_channels(),
    )


@app.route("/drtv/serie/<showid>")
@app.route("/serie/<showid>")
async def longlink(showid):
    return redirect(f"/{showid}/", code=302)


@app.route("/<show>.xml")
async def get_feed(show):
    return Response(
        (await get_show(show)).to_rss_feed(),
        headers={"content-type": "application/rss+xml"},
    )


@app.route("/search/")
async def search_view():
    query = request.args.get("query")
    results = await search(query)
    return await render_template(
        "search.html",
        results=results,
        query=query,
        SERVICE_NAME=SERVICE_NAME,
        birthday=birthday(),
        channels=await get_channels(),
    )


@app.route("/live/<channel>")
async def live_channel(channel):
    channels = await get_channels()
    if channel in channels:
        return await render_template(
            "live.html",
            channel=channels[channel],
            SERVICE_NAME=SERVICE_NAME,
            birthday=birthday(),
            channels=await get_channels(),
        )
    else:
        abort(404)
