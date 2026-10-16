from contextlib import suppress
from datetime import datetime, timezone
from functools import lru_cache
from typing import Optional
import asyncio
import gzip
import hashlib
import os
import sqlite3

from quart import (
    abort,
    Quart,
    Response,
    render_template,
    redirect,
    request,
    send_from_directory,
)

from . import discover, drtv
from .pick import pick_pool
from . import sync as sync_store
from .drtv import (
    DRUnavailable,
    get_cached_show,
    get_long_description,
    get_program,
    get_show,
    search,
)
from . import live as live_tv
from .live import channel_named, channel_style, get_channels, get_schedules, plan_from, whats_on
from .show import Show, clock, is_documentary, danish_date, danish_datetime, duration, is_new, new_episodes, thumbnail, whole_sentences

app = Quart(__name__)
app.add_template_filter(thumbnail)
app.add_template_filter(danish_date)
app.add_template_filter(danish_datetime)
app.add_template_filter(duration)
app.add_template_filter(clock)
app.add_template_filter(whole_sentences)
app.add_template_global(whats_on)
app.add_template_global(channel_style)
app.add_template_test(is_new, "new")


# The endings of the site's name that the logo puts on a warm white tag, like the Worker's logo()
LOGO_TAGS = ("kassen", "tv")


@app.template_filter("logo_tag")
def logo_tag(name: str) -> str:
    """The end of the site's name that goes on the logo's tag, like "kassen" of Flimmerkassen, or "" """
    for tag in LOGO_TAGS:
        if len(name) > len(tag) and name.lower().endswith(tag):
            return name[-len(tag):]
    return ""


SERVICE_NAME = os.getenv("SERVICE_NAME", "Flimmerkassen")
# Where the code that runs here can be got
SOURCE_URL = os.getenv("SOURCE_URL", "https://github.com/devjoda/dktv")

# Shorter than the hour shows are cached for, so visitors never wait for these
RECOMMENDED_REFRESH_INTERVAL = 30 * 60

# How many favourite shows the front page asks about at once
MAX_FAVORITES = 50

# How many of DR's rows the front page shows, and of its featured programmes, like DR's own
FRONT_PAGE_ROWS = 8
FEATURED = 12

# Far more than a viewer's favourites and progress take up
MAX_SYNC_SIZE = 2 * 1024 * 1024


@lru_cache(maxsize=None)
def file_version(path: str, modified: int) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]


@app.template_global()
def static_url(filename: str) -> str:
    """The URL of one of our static files, which changes along with the file.
    Browsers keep static files for 12 hours, so without it, they'd mix new
    pages with old scripts for a while after every update."""
    path = os.path.join(app.static_folder, filename)
    return f"/static/{filename}?v={file_version(path, os.stat(path).st_mtime_ns)}"


# What's worth compressing: text, which pages are mostly the same tags and URLs of, over and over
COMPRESSIBLE = ("text/", "application/json", "application/rss+xml", "application/javascript", "image/svg+xml")
MIN_COMPRESSED_SIZE = 1024


@app.after_request
async def compress(response):
    """Gzips what's sent, which makes the pages about a sixteenth of their size"""
    if (
        response.status_code != 200
        or "gzip" not in request.headers.get("Accept-Encoding", "")
        or "Content-Encoding" in response.headers
        # Parts of a file, which would no longer fit together
        or "Content-Range" in response.headers
        or not (response.mimetype or "").startswith(COMPRESSIBLE)
    ):
        return response
    data = await response.get_data()
    if len(data) < MIN_COMPRESSED_SIZE:
        return response
    response.set_data(gzip.compress(data, compresslevel=6))
    response.headers["Content-Encoding"] = "gzip"
    response.vary.add("Accept-Encoding")
    # Not the same bytes as uncompressed any more, though the same file
    etag, weak = response.get_etag()
    if etag and not weak:
        response.set_etag(etag, weak=True)
    return response


@app.context_processor
def footer():
    return {"source_url": SOURCE_URL, "SERVICE_NAME": SERVICE_NAME}


async def keep_fresh(recommended_shows: list[str]):
    """Fetches the recommended shows and DR's front page, and keeps fetching them regularly"""
    while True:
        await discover.get_page("/", max_rows=FRONT_PAGE_ROWS, refresh=True)
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
    page = await discover.get_page("/", max_rows=FRONT_PAGE_ROWS)
    return await render_template(
        "index.html",
        # Only the ones fetched already, so the front page never waits for DR
        shows=[s for s in map(get_cached_show, recommended_shows) if s is not None],
        page=page,
        featured=page.featured[:FEATURED] if page else [],
        SERVICE_NAME=SERVICE_NAME,
        channels=await get_channels(),
        schedules=await get_schedules(),
    )


MAIN_CATEGORIES = ["/kategorier/fiktionsserier/", "/kategorier/film/", "/kategorier/dokumentar/"]


@app.route("/kategorier/")
async def categories():
    return await render_template(
        "categories.html",
        # Serier, Film and Dokumentar first, which small screens' tabs lead here for
        categories=sorted(await discover.get_categories(), key=lambda c: MAIN_CATEGORIES.index(c.url) if c.url in MAIN_CATEGORIES else len(MAIN_CATEGORIES)),
        SERVICE_NAME=SERVICE_NAME,
        channels=await get_channels(),
    )


@app.route("/kategorier/<slug>/")
async def category(slug):
    found = next((c for c in await discover.get_categories() if c.url == f"/kategorier/{slug}/"), None)
    if found is None:
        abort(404)
    page = await discover.get_page(f"/kategorier/{slug}", max_rows=12)
    if page is None:
        raise drtv.DRUnavailable(f"No page for the category {slug}")
    return await render_template(
        "category.html",
        category=found,
        page=page,
        SERVICE_NAME=SERVICE_NAME,
        channels=await get_channels(),
    )


@app.route("/liste/<int:list_id>/")
async def full_list(list_id):
    """All of a row of DR's, like all films from A to Å"""
    found = await discover.get_list(str(list_id))
    if found is None:
        abort(404)
    # The row's own title, which DR's list may not have, like "A - Å" for "Film | A - Å"
    title = request.args.get("titel") or found.title.replace(" | ", ": ")
    return await render_template(
        "list.html",
        title=title,
        cards=found.cards,
        SERVICE_NAME=SERVICE_NAME,
        channels=await get_channels(),
    )


@app.route("/live/")
async def live_channels():
    """Direkte: the channel the viewer last watched, which the browser keeps in the cookie lastChannel, or DR1.
    Different for each viewer, so never kept by anyone."""
    channels = await get_channels()
    last = request.cookies.get("lastChannel")
    slug = last if last in channels else ("DR1" if "DR1" in channels else next(iter(channels), None))
    if slug is None:
        abort(503)
    response = redirect(f"/live/{slug}", 302)
    response.headers["Cache-Control"] = "private, no-store"
    return response


@app.route("/live/plan.json")
async def live_plan():
    """What's left of the day on each channel, for the channel guide when the page's own schedule runs out"""
    channels = await get_channels()
    return {"plan": plan_from(channels, await get_schedules())}


@app.route("/favoritter/")
async def favorites_page():
    return await render_template(
        "favorites.html",
        SERVICE_NAME=SERVICE_NAME,
        channels=await get_channels(),
    )


@app.route("/vaelg/")
async def pick_page():
    """"Vælg for mig": its answers, like ?type=serie, are read by pick.js, which picks from /vaelg.json"""
    return await render_template("vaelg.html", SERVICE_NAME=SERVICE_NAME)


@app.route("/vaelg.json")
async def pick_list():
    return await pick_pool()


@app.route("/nyt/")
async def news_page():
    """What's new for the viewer, which the bell in the header opens on phones: filled in by news.js"""
    return await render_template("news.html")


@app.route("/privatliv/")
async def privacy():
    return await render_template("privacy.html")


@app.route("/favicon.ico")
async def favicon():
    return await send_from_directory(
        os.path.join(app.root_path, "templates"),
        "favicon.ico",
        mimetype="image/vnd.microsoft.icon",
    )


@app.route("/favicon.svg")
async def favicon_svg():
    return await send_from_directory(
        os.path.join(app.root_path, "templates"),
        "favicon.svg",
        mimetype="image/svg+xml",
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


@app.route("/forslag/<kind>/<slug>")
async def suggestions(kind, slug):
    """What to watch after a series or a film, once it's over: DR's own programmes from its narrowest category,
    as the category's page here has them"""
    if kind not in ("serie", "program"):
        abort(404)
    item = await get_show(slug) if kind == "serie" else await get_program(slug)
    return await discover.similar_to(item.categories or [], slug.split("_")[-1], item.tags)


@app.route("/program/<progid>")
async def view_program(progid):
    return await render_template(
        "video.html",
        e=await get_program(progid),
        SERVICE_NAME=SERVICE_NAME,
        channels=await get_channels(),
    )


# How many of a season's episodes its list beside the video has at most, and how many of them before the one playing
SEASON_LIST_SIZE = 40
SEASON_LIST_BEFORE = 10


def season_list(show, season, e) -> dict:
    """The season's episodes around the one playing, for the list beside the video, like the Worker's seasonList()"""
    i = season.episodes.index(e)
    count = len(season.episodes)
    start = 0 if count <= SEASON_LIST_SIZE else max(0, min(i - SEASON_LIST_BEFORE, count - SEASON_LIST_SIZE))
    shown = season.episodes[start : start + SEASON_LIST_SIZE]
    return {
        "title": season.title if len(show.seasons) > 1 else "Afsnit",
        "all": f"/{show.url}/" if len(shown) < count else None,
        "episodes": [
            {
                "url": f"/{show.url}/{other.ep_link}",
                "title": other.title,
                "wallpaper": other.wallpaper,
                "len_minutes": other.len_minutes,
                "video_id": other.video_id,
                "current": other is e,
            }
            for other in shown
        ],
    }


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
        return {
            "url": f"/{show.url}/{other.ep_link}",
            "title": title,
            "wallpaper": other.wallpaper,
            "len_minutes": other.len_minutes,
        }

    await get_long_description(e)
    return await render_template(
        "video.html",
        s=show,
        e=e,
        previous=neighbour(i - 1),
        next=neighbour(i + 1),
        season_list=season_list(show, season, e),
        SERVICE_NAME=SERVICE_NAME,
        channels=await get_channels(),
    )


@app.route("/<showid>/afsnit/<int:number>")
async def play_episode_number(showid, number):
    """Plays a show's episode by its number in a season, like DR's "Episode 1:7" says:
    in the season with the id ?saeson=, or the newest one"""
    show = await get_show(showid)
    season_id = request.args.get("saeson")
    season = next((s for s in show.seasons if season_id and s.id == season_id), show.seasons[-1])
    if not season.episodes:
        return redirect(f"/{show.url}/")
    episode = season.episodes[min(max(number, 1), len(season.episodes)) - 1]
    return redirect(f"/{show.url}/{episode.ep_link}")


@app.route("/<showid>/")
async def view_show(showid):
    show = await get_show(showid)
    return await render_template(
        "show.html",
        s=show,
        SERVICE_NAME=SERVICE_NAME,
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
        channels=await get_channels(),
    )


def describe_show(show: Show) -> dict:
    """What the front page needs to show a favourite show"""
    episodes = show.episodes
    return {
        "title": show.title,
        "url": f"/{show.url}/",
        "image": thumbnail(show.wallpaper),
        "seasons": len(show.seasons),
        "episodes": len(episodes),
        "episode_ids": [e.video_id for e in episodes],
        "new": bool(episodes) and is_new(episodes[-1].pubdate),
        # For "Nyt til dig", from the series as it's kept, without asking DR for more
        "new_episodes": new_episodes(show),
        # For the favourites page's filter, like the page Dokumentar
        "documentary": is_documentary(show),
    }


async def describe_film(film_id: str) -> dict:
    """What the front page needs to show a favourite film"""
    program = await get_program(film_id)
    return {
        "title": program.title,
        "url": f"/program/{film_id}",
        "image": thumbnail(program.wallpaper),
        "minutes": program.len_minutes,
        "documentary": is_documentary(program),
    }


@app.route("/favorites.json")
async def favorites():
    """Fresh details about the viewer's favourite shows and films, like
    ?shows=rejseholdet_503605:matador_540736&films=lise-noergaard_-ikke-kun-en-pige_362031.
    Which they are is kept in the viewer's browser, not here."""

    async def describe_all(param: str, describe) -> dict:
        ids = [i for i in request.args.get(param, "").split(":") if i][:MAX_FAVORITES]

        async def one(favorite_id: str) -> Optional[dict]:
            try:
                return await describe(favorite_id)
            except Exception as e:
                # One DR no longer has, or DR being down, shouldn't take the others with it
                print("Could not describe favourite", favorite_id, repr(e))
                return None

        found = await asyncio.gather(*map(one, ids))
        return {i: details for i, details in zip(ids, found) if details is not None}

    async def describe_show_by_id(show_id: str) -> dict:
        return describe_show(await get_show(show_id))

    shows, films = await asyncio.gather(
        describe_all("shows", describe_show_by_id), describe_all("films", describe_film)
    )
    return {"shows": shows, "films": films}


@app.route("/sync/")
async def sync_page():
    return await render_template(
        "sync.html",
        SERVICE_NAME=SERVICE_NAME,
        channels=await get_channels(),
    )


@app.route("/sync/", methods=["POST"])
async def sync_create():
    try:
        code = await asyncio.to_thread(sync_store.create)
    except sqlite3.Error as e:
        print("Could not make a sync code", repr(e))
        return {"error": "Serveren kan ikke gemme noget lige nu. Prøv igen senere."}, 503
    return {"code": code}, 201


@app.route("/sync/<code>", methods=["POST"])
async def sync_data(code):
    """Takes what a device knows, and gives back that merged with what the others knew"""
    code = sync_store.normalize_code(code)
    if code is None:
        return {"error": "Koden findes ikke."}, 404
    if (request.content_length or 0) > MAX_SYNC_SIZE:
        return {"error": "For meget at synkronisere."}, 413
    # Only JSON, which other sites can't send here without the browser asking first
    data = await request.get_json(silent=True)
    if not isinstance(data, dict):
        return {"error": "Forventede JSON."}, 400
    try:
        merged = await asyncio.to_thread(sync_store.sync, code, data)
    except sqlite3.Error as e:
        print("Could not sync", repr(e))
        return {"error": "Serveren kan ikke gemme noget lige nu. Prøv igen senere."}, 503
    if merged is None:
        return {"error": "Koden findes ikke."}, 404
    return merged


@app.route("/sync/<code>", methods=["DELETE"])
async def sync_delete(code):
    code = sync_store.normalize_code(code)
    if code is not None:
        try:
            await asyncio.to_thread(sync_store.delete, code)
        except sqlite3.Error as e:
            print("Could not delete synced data", repr(e))
            return {"error": "Serveren kan ikke slette noget lige nu. Prøv igen senere."}, 503
    return "", 204


@app.route("/live/<channel>")
async def live_channel(channel):
    channels = await get_channels()
    slug = channel_named(channels, channel)
    if slug is None:
        abort(404)
    # Like /live/dr2, for /live/DR2
    if slug != channel:
        return redirect(f"/live/{slug}", 308)
    schedules = await get_schedules()
    plan = plan_from(channels, schedules)
    at = live_tv.now().timestamp() * 1000

    def clock_at(ms: int) -> str:
        return clock(datetime.fromtimestamp(ms / 1000, timezone.utc))

    def on_channel(programmes: list[dict]):
        on_now = next((p for p in programmes if p["start"] <= at < p["end"]), None)
        return on_now, [p for p in programmes if p["start"] >= at]

    # What's on each channel, like the Worker's guideChannel()
    guide = []
    for number, (other, c) in enumerate(channels.items(), 1):
        on_now, later = on_channel(plan[other])
        following = later[0] if later else None
        guide.append({
            "slug": other,
            "title": c.title,
            "style": channel_style(other, c),
            "number": number,
            "current": other == slug,
            "now": on_now["title"] if on_now else (f"Sender igen kl. {clock_at(following['start'])}" if following else ""),
            "progress": round(100 * min(max((at - on_now["start"]) / (on_now["end"] - on_now["start"]), 0), 1)) if on_now else None,
            "next": (f"{clock_at(following['start'])} {following['title']}" if on_now else following["title"]) if following else "",
        })
    on_now, later = on_channel(plan[slug])
    programmes = [
        {
            **p,
            "is_now": p is on_now,
            "iso_start": datetime.fromtimestamp(p["start"] / 1000, timezone.utc).isoformat(),
            "iso_end": datetime.fromtimestamp(p["end"] / 1000, timezone.utc).isoformat(),
            "clock_start": clock_at(p["start"]),
            "clock_end": clock_at(p["end"]),
            "percent": round(100 * min(max((at - p["start"]) / (p["end"] - p["start"]), 0), 1)) if p is on_now else 0,
        }
        for p in ([on_now] if on_now else []) + later[:8]
    ]
    return await render_template(
        "live.html",
        channel=channels[slug],
        channel_style=channel_style(slug, channels[slug]),
        current_channel=slug,
        guide=guide,
        programmes=programmes,
        data={
            "channel": slug,
            "channels": [
                {"slug": s, "title": c.title, "stream": c.stream_url, "subtitles": c.subtitles_url, "style": channel_style(s, c)}
                for s, c in channels.items()
            ],
            "plan": plan,
        },
        SERVICE_NAME=SERVICE_NAME,
        channels=channels,
    )


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
            channels=channels,
        ),
        status,
    )


@app.errorhandler(404)
async def not_found(e):
    return await error_page(
        "Siden findes ikke",
        "Vi kunne ikke finde det, du leder efter. "
        "Måske kan det ikke længere ses.",
        404,
    )


@app.errorhandler(DRUnavailable)
async def dr_unavailable(e):
    print("DR is unavailable:", e)
    return await error_page(
        "Programmerne kan ikke hentes lige nu",
        "Prøv igen om lidt.",
        503,
    )


@app.errorhandler(500)
async def internal_error(e):
    return await error_page(
        "Noget gik galt",
        "Der skete en fejl, da siden skulle vises. Prøv igen om lidt.",
        500,
    )
