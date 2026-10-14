from datetime import datetime, timedelta
from time import time
from typing import Optional
from zoneinfo import ZoneInfo
import os
import re
import xml.etree.ElementTree as ET

BASE_URL = os.getenv("BASE_URL", "http://localhost:5000")
if BASE_URL[-1] == "/":
    BASE_URL = BASE_URL[:-1]

MEDIA_RSS = "http://search.yahoo.com/mrss/"
ET.register_namespace("media", MEDIA_RSS)

THUMBNAIL_WIDTH = 640


def thumbnail(image_url: Optional[str], width: int = THUMBNAIL_WIDTH) -> Optional[str]:
    """Asks DR's image service for a smaller version of an image,
    since DR's image URLs are for full HD"""
    if image_url is None:
        return None
    old_width = re.search(r"\bWidth=(\d+)", image_url)
    old_height = re.search(r"\bHeight=(\d+)", image_url)
    if old_width is None or old_height is None or int(old_width[1]) <= width:
        return image_url
    height = round(int(old_height[1]) * width / int(old_width[1]))
    image_url = image_url.replace(old_width[0], f"Width={width}")
    # Some are photos as PNG, which are many times bigger than as JPEG
    image_url = image_url.replace("Format='png'", "Format='jpg'")
    return image_url.replace(old_height[0], f"Height={height}")


# How much of a cut-off text must be left, to end it at its last whole sentence instead
WHOLE_SENTENCES_FROM = 60


def whole_sentences(text: Optional[str]) -> Optional[str]:
    """DR's short descriptions are cut off, like "… og meget...". Ends one at its last whole sentence
    instead, where that leaves enough of it; the episode's own page has all of it. Like the Worker's."""
    if not text:
        return text
    cut = re.search(r"(\.\.\.|…)\s*$", text)
    if cut is None:
        return text
    before = text[: cut.start()]
    ends = list(re.finditer(r"[.!?][\"'”»)]?(?=\s)", before))
    if not ends or ends[-1].end() < WHOLE_SENTENCES_FROM:
        return before.rstrip() + "…"
    return before[: ends[-1].end()]


def video_id(url: str) -> str:
    """DR's id for a video, from its URL, which ends in it"""
    return url.split("_")[-1]


class Episode:
    def __init__(
        self,
        title,
        short_description: Optional[str] = None,
        url: Optional[str] = None,
        pubdate: Optional[datetime] = None,
        wallpaper: Optional[str] = None,
        len_minutes: Optional[int] = None,
        geo_restricted: bool = False,
        number: Optional[int] = None,
    ):
        self.title = title
        # Its number in its season, as DR has it
        self.number = number
        self.short_description = short_description
        self.description = ""
        self.url = url
        self.pubdate = pubdate
        self.wallpaper = wallpaper
        self.len_minutes = len_minutes
        self.geo_restricted = geo_restricted
        if url is not None:
            self.ep_link = url.split("/")[-1]
            self.video_id = video_id(url)


class Season:
    def __init__(self, title: str, id: Optional[str] = None, number: Optional[int] = None):
        self.title = title
        # DR's id for the season
        self.id = id
        # Like 11, for "Sæson 11", if DR numbers it
        self.number = number
        self.episodes = []

    def add_episode(self, episode: Episode):
        self.episodes.append(episode)


class Show:
    def __init__(
        self,
        title: str,
        description: Optional[str] = None,
        url: Optional[str] = None,
        wallpaper: Optional[str] = None,
        geo_restricted: bool = False,
        next_episode: Optional[datetime] = None,
        categories: Optional[list[str]] = None,
    ):
        self.title = title
        # DR's categories for it, like ["dokumentar", "kultur"]
        self.categories = categories
        self.description = description
        self.url = url
        self.seasons = []
        self.age = time()
        self.wallpaper = wallpaper
        self.geo_restricted = geo_restricted
        if url is not None:
            self.feed_url = "/" + url + ".xml"
        self.next_episode = next_episode

    def add_season(self, season: Season):
        self.seasons.append(season)

    @property
    def episodes(self) -> list[Episode]:
        """All the episodes, from the first season's first one"""
        return [entry for season in self.seasons for entry in season.episodes]

    def playlist(self) -> list[dict]:
        """The episodes in the order they're watched in, for the play button
        to find where the viewer got to"""
        return [
            {
                "id": entry.video_id,
                "url": f"/{self.url}/{entry.ep_link}",
                "title": entry.title,
                "season": season.title if len(self.seasons) > 1 else None,
            }
            for season in self.seasons
            for entry in season.episodes
        ]

    def to_rss_feed(self) -> str:
        rss = ET.Element("rss", attrib={"version": "2.0"})
        channel = ET.SubElement(rss, "channel")
        title = ET.SubElement(channel, "title")
        title.text = self.title
        ttl = ET.SubElement(channel, "ttl")
        ttl.text = "60"
        if self.description is not None:
            description = ET.SubElement(channel, "description")
            description.text = self.description
        if self.url is not None:
            url = ET.SubElement(channel, "link")
            url.text = BASE_URL + "/" + self.url + "/"

        for season in self.seasons:
            for entry in season.episodes:
                item = ET.SubElement(channel, "item")
                title = ET.SubElement(item, "title")
                title.text = entry.title
                # The long description is only fetched once someone opens the episode
                if entry.description or entry.short_description:
                    description = ET.SubElement(item, "description")
                    description.text = entry.description or entry.short_description
                if self.url is not None and entry.url is not None:
                    url = ET.SubElement(item, "link")
                    url.text = BASE_URL + "/" + self.url + "/" + entry.ep_link
                    guid = ET.SubElement(item, "guid", attrib={"isPermaLink": "false"})
                    guid.text = "DRTV:" + entry.ep_link
                if entry.pubdate is not None:
                    pub_date = ET.SubElement(item, "pubDate")
                    pub_date.text = entry.pubdate.strftime("%a, %d %b %Y %H:%M:%S %z")
                if entry.wallpaper is not None:
                    ET.SubElement(
                        item,
                        f"{{{MEDIA_RSS}}}thumbnail",
                        attrib={"url": thumbnail(entry.wallpaper)},
                    )

        return ET.tostring(rss, xml_declaration=True, encoding="unicode")


class Program:
    def __init__(
        self,
        title: str,
        description: Optional[str] = None,
        url: Optional[str] = None,
        pubdate: Optional[datetime] = None,
        wallpaper: Optional[str] = None,
        len_minutes: Optional[int] = None,
        categories: Optional[list[str]] = None,
    ):
        self.title = title
        self.description = description
        self.url = url
        self.pubdate = pubdate
        self.wallpaper = wallpaper
        self.len_minutes = len_minutes
        # DR's categories for it, like ["dokumentar", "kultur"]
        self.categories = categories
        self.video_id = video_id(url) if url is not None else None
        self.age = time()


COPENHAGEN = ZoneInfo("Europe/Copenhagen")
MONTHS = ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."]


def danish_date(d: datetime) -> str:
    """Formats a date like 1. okt. 2000, as it was in Denmark"""
    if d.tzinfo is not None:
        d = d.astimezone(COPENHAGEN)
    return f"{d.day}. {MONTHS[d.month - 1]} {d.year}"


def clock(d: datetime) -> str:
    """Formats the time of day like 20.00, as it is in Denmark"""
    if d.tzinfo is not None:
        d = d.astimezone(COPENHAGEN)
    return f"{d.hour:02}.{d.minute:02}"


def danish_datetime(d: datetime) -> str:
    """Formats a time like 17. okt. kl. 20.00, as it is in Denmark"""
    if d.tzinfo is not None:
        d = d.astimezone(COPENHAGEN)
    return f"{d.day}. {MONTHS[d.month - 1]} kl. {d.hour:02}.{d.minute:02}"


NEW_FOR = timedelta(days=14)


def current_time(tz: Optional[ZoneInfo] = None) -> datetime:
    """Now, which tests can move"""
    return datetime.now(tz=tz)


def is_new(d: Optional[datetime]) -> bool:
    """Whether something came out within the last two weeks"""
    if d is None:
        return False
    now = current_time(COPENHAGEN) if d.tzinfo is not None else current_time()
    return timedelta(0) <= now - d <= NEW_FOR


def is_documentary(item) -> Optional[bool]:
    """Whether a Show or Program is a documentary, as on the page Dokumentar, whose programmes DR gives the
    category "dokumentar", or None if it doesn't say"""
    return "dokumentar" in item.categories if item.categories is not None else None


def categories_of(item) -> Optional[list[str]]:
    """DR's categories for an item, in small letters"""
    return [c.lower() for c in item.categories] if item.categories is not None else None


# How many of a series' newest episodes /favorites.json tells of
NEWEST_EPISODES = 10


def new_episodes(show: "Show") -> list[dict]:
    """The series' episodes from the last two weeks, the newest first, for the viewer to hear of"""
    found = []
    for season in show.seasons:
        for i, entry in enumerate(season.episodes):
            if is_new(entry.pubdate):
                found.append(
                    {
                        "id": entry.video_id,
                        "title": entry.title,
                        "season": season.number,
                        "number": entry.number or i + 1,
                        "url": f"/{show.url}/{entry.ep_link}",
                        "published": round(entry.pubdate.timestamp() * 1000),
                        "image": thumbnail(entry.wallpaper),
                    }
                )
    # In the order they're watched in, and then the newest first, so those that came out together stay in order
    found.reverse()
    found.sort(key=lambda e: e["published"], reverse=True)
    return found[:NEWEST_EPISODES]


def duration(minutes: int) -> str:
    """Formats a length like 59 min. or 1 t. 15 min."""
    hours, minutes = divmod(minutes, 60)
    if hours == 0:
        return f"{minutes} min."
    if minutes == 0:
        return f"{hours} t."
    return f"{hours} t. {minutes} min."
