from datetime import datetime
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


def thumbnail(image_url: Optional[str]) -> Optional[str]:
    """Asks DR's image service for a smaller version of an image,
    since DR's image URLs are for full HD"""
    if image_url is None:
        return None
    width = re.search(r"\bWidth=(\d+)", image_url)
    height = re.search(r"\bHeight=(\d+)", image_url)
    if width is None or height is None or int(width[1]) <= THUMBNAIL_WIDTH:
        return image_url
    new_height = round(int(height[1]) * THUMBNAIL_WIDTH / int(width[1]))
    image_url = image_url.replace(width[0], f"Width={THUMBNAIL_WIDTH}")
    return image_url.replace(height[0], f"Height={new_height}")


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
    ):
        self.title = title
        self.short_description = short_description
        self.description = ""
        self.url = url
        self.pubdate = pubdate
        self.wallpaper = wallpaper
        self.len_minutes = len_minutes
        self.geo_restricted = geo_restricted
        if url is not None:
            self.ep_link = url.split("/")[-1]


class Season:
    def __init__(self, title: str):
        self.title = title
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
    ):
        self.title = title
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
    ):
        self.title = title
        self.description = description
        self.url = url
        self.pubdate = pubdate
        self.wallpaper = wallpaper
        self.len_minutes = len_minutes
        self.age = time()


COPENHAGEN = ZoneInfo("Europe/Copenhagen")
MONTHS = ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."]


def danish_date(d: datetime) -> str:
    """Formats a date like 1. okt. 2000, as it was in Denmark"""
    if d.tzinfo is not None:
        d = d.astimezone(COPENHAGEN)
    return f"{d.day}. {MONTHS[d.month - 1]} {d.year}"


def duration(minutes: int) -> str:
    """Formats a length like 59 min. or 1 t. 15 min."""
    hours, minutes = divmod(minutes, 60)
    if hours == 0:
        return f"{minutes} min."
    if minutes == 0:
        return f"{hours} t."
    return f"{hours} t. {minutes} min."
