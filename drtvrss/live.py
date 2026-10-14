from dataclasses import dataclass
from datetime import datetime, timezone
from time import time
from typing import Optional

from pydantic import TypeAdapter

from . import models as dr
from .drtv import get_api

# The list of live channels on DR's website
CHANNEL_LIST = 155156

# How far ahead to get the live channels' schedules, in hours: the rest of the day, and some
SCHEDULE_HOURS = 24
SCHEDULE_CACHE_TIME = 5 * 60


# Our own colours for the channels whose own are too like another's: TV A's red is DR1's, and Ramasjang's
# turquoise is too like DR2's blue
CHANNEL_COLOURS = {"EVA": "#f2efe9", "TVR": "#9b6cff"}
# The ink the site is written in, for a bar in a colour nearly as light as the chosen channel's warm white
INK = "#0f1013"


class LiveChannel:
    def __init__(self, id, title, stream_url, subtitles_url=None, colour=None):
        self.id = id
        self.title = title
        self.stream_url = stream_url
        self.subtitles_url = subtitles_url
        self.colour = colour


def channel_style(slug: str, channel: LiveChannel) -> Optional[str]:
    """The channel's colour, as a style for what's marked with it, like its progress bars, or None"""
    colour = CHANNEL_COLOURS.get(slug) or channel.colour
    if colour is None:
        return None
    r, g, b = (int(colour[i : i + 2], 16) for i in (1, 3, 5))
    light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 200
    return f"--channel: {colour};" + (f" --channel-on-paper: {INK};" if light else "")


@dataclass
class Programme:
    """A programme on a live channel"""

    title: str
    start: datetime
    end: datetime
    description: str = ""
    image: Optional[str] = None

    def percent_done(self, at: Optional[datetime] = None) -> int:
        at = at or now()
        done = (at - self.start) / (self.end - self.start)
        return round(100 * min(max(done, 0), 1))


def now() -> datetime:
    return datetime.now(timezone.utc)


def whats_on(programmes: list[Programme], at: Optional[datetime] = None):
    """The programme on now, if any, and the ones after it"""
    at = at or now()
    current = next((p for p in programmes if p.start <= at < p.end), None)
    later = [p for p in programmes if p.start >= at]
    return current, later


live_channels = None
last_fetch = 0


async def get_channels():
    global live_channels
    global last_fetch
    if last_fetch + 60 * 30 < time() or (len(live_channels) == 0 and last_fetch + 60 < time()):
        blob = await get_api(f"/lists/{CHANNEL_LIST}", page_size=24)
        channels = dr.ItemList[dr.Channel].model_validate(blob)
        live_channels = {
            c.channel_short_code: LiveChannel(
                c.id,
                c.title,
                c.custom_fields.hls_url,
                subtitles_url=c.custom_fields.hls_subtitles_url,
                colour=c.custom_fields.colour,
            )
            for c in channels.items
        }
        last_fetch = time()
    return live_channels


schedules: dict[str, list[Programme]] = {}
schedules_fetched = 0


async def get_schedules() -> dict[str, list[Programme]]:
    """What's on the live channels, by channel id, from a little before now
    and some hours ahead. Empty when DR doesn't say, since it's only extra."""
    global schedules, schedules_fetched
    if schedules_fetched + SCHEDULE_CACHE_TIME > time():
        return schedules
    try:
        channels = await get_channels()
        at = now()
        blob = await get_api(
            "/schedules",
            date=at.strftime("%Y-%m-%d"),
            hour=at.hour,
            channels=",".join(c.id for c in channels.values()),
            duration=SCHEDULE_HOURS,
        )
        schedules = {
            s.channel_id: [
                Programme(
                    b.item.title,
                    b.start_date,
                    b.end_date,
                    description=b.item.description or b.item.short_description,
                    image=b.item.images.wallpaper,
                )
                for b in s.schedules
            ]
            for s in TypeAdapter(list[dr.ChannelSchedule]).validate_python(blob)
        }
        schedules_fetched = time()
    except Exception as e:
        print("Could not get the live channels' schedules", repr(e))
        # Try again in a minute
        schedules_fetched = time() - SCHEDULE_CACHE_TIME + 60
    return schedules


def plan_from(channels: dict, schedules: dict[str, list[Programme]], at: Optional[datetime] = None) -> dict[str, list[dict]]:
    """What's left of each channel's schedule from `at`, by the channel's short name, as the browser gets it:
    times in milliseconds, like the Worker's planFrom()"""
    at = at or now()

    def planned(p: Programme) -> dict:
        description = p.description or ""
        if len(description) > 280:
            description = description[:279].rstrip() + "…"
        return {
            "title": p.title,
            "start": round(p.start.timestamp() * 1000),
            "end": round(p.end.timestamp() * 1000),
            "description": description,
        }

    return {slug: [planned(p) for p in schedules.get(c.id, []) if p.end > at] for slug, c in channels.items()}


def channel_named(channels: dict, name: str) -> Optional[str]:
    """The channel a live channel's address names, like DR2 for dr2, if any"""
    if name in channels:
        return name
    return next((slug for slug in channels if slug.lower() == name.lower()), None)
