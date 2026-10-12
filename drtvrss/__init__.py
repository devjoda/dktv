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
from .drtv import (
    DRUnavailable,
    get_cached_show,
    get_long_description,
    get_program,
    get_show,
    search,
)
from .live import get_channels
from .show import danish_date, duration, thumbnail

app = Quart(__name__)
app.add_template_filter(thumbnail)
app.add_template_filter(danish_date)
app.add_template_filter(duration)

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
recommended_shows: list[str] = []


@app.before_serving
async def startup():
    global refresher, recommended_shows
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
        # Only the ones fetched already, so the front page never waits for DR
        shows=[s for s in map(get_cached_show, recommended_shows) if s is not None],
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


@app.route("/sw.js")
async def service_worker():
    """From the root, so it may keep images for every page"""
    response = await send_from_directory(
        os.path.join(app.root_path, "static"),
        "sw.js",
        mimetype="text/javascript",
    )
    # Browsers should pick up a new version right away
    response.headers["Cache-Control"] = "no-cache"
    return response


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
    episodes = [(season, entry) for season in show.seasons for entry in season.episodes]
    matches = [i for i, (_, entry) in enumerate(episodes) if episode in entry.url]
    if not matches:
        abort(404)
    i = matches[-1]
    season, e = episodes[i]

    def neighbour(j: int) -> Optional[dict]:
        """The episode before or after this one, if there is one"""
        if not 0 <= j < len(episodes):
            return None
        other_season, other = episodes[j]
        title = other.title
        if other_season is not season:
            title = f"{other_season.title}, {title}"
        return {"url": f"/{show.url}/{other.ep_link}", "title": title}

    await get_long_description(e)
    return await render_template(
        "video.html",
        s=show,
        e=e,
        previous=neighbour(i - 1),
        next=neighbour(i + 1),
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
    query = request.args.get("query", "").strip()
    results = await search(query) if query else None
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
            current_channel=channel,
            SERVICE_NAME=SERVICE_NAME,
            birthday=birthday(),
            channels=await get_channels(),
        )
    else:
        abort(404)


async def error_page(title: str, message: str, status: int):
    try:
        channels = await get_channels()
    except Exception:
        # The error might well be that DR is down
        channels = {}
    return (
        await render_template(
            "error.html",
            title=title,
            message=message,
            SERVICE_NAME=SERVICE_NAME,
            birthday=birthday(),
            channels=channels,
        ),
        status,
    )


@app.errorhandler(404)
async def not_found(e):
    return await error_page(
        "Siden findes ikke",
        "Vi kunne ikke finde det, du leder efter. "
        "Måske er det ikke længere tilgængeligt på DRTV.",
        404,
    )


@app.errorhandler(DRUnavailable)
async def dr_unavailable(e):
    print("DR is unavailable:", e)
    return await error_page(
        "DR svarer ikke lige nu",
        "Siden kunne ikke hentes fra DR. Prøv igen om lidt.",
        503,
    )


@app.errorhandler(500)
async def internal_error(e):
    return await error_page(
        "Noget gik galt",
        "Der skete en fejl, da siden skulle vises. Prøv igen om lidt.",
        500,
    )
