"""Models describing the parts of DR's API that we rely on.

Everything we know about DR's data format lives in this module. When DR
changes something, validation fails here with an error naming the exact
field, instead of a KeyError somewhere deep inside the code.

Fields we can't do without are required. Cosmetic fields (descriptions,
dates, lengths, images) are optional, so that DR dropping one of them
degrades a page instead of breaking it.
"""

from datetime import datetime
from typing import Annotated, Generic, Literal, Optional, TypeVar
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, ValidationError, WrapValidator
from pydantic.alias_generators import to_camel, to_pascal

COPENHAGEN = ZoneInfo("Europe/Copenhagen")

T = TypeVar("T")


def _none_on_error(value, handler):
    try:
        return handler(value)
    except ValidationError:
        return None


# For cosmetic fields where a malformed value should be treated as missing
Lenient = WrapValidator(_none_on_error)


class DRModel(BaseModel):
    """DR uses camelCase keys. Unknown keys are ignored."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class CustomFields(BaseModel):
    """DR's "customFields" use PascalCase keys and stringly typed values."""

    model_config = ConfigDict(alias_generator=to_pascal, populate_by_name=True)

    # Sent as the strings "True"/"False", which pydantic turns into bools
    is_geo_restricted: bool = False
    # Either "1. DEC 2021 | 38M" or "SÆSON 1 EPISODE 10 | 1T 5M"
    extra_details: Optional[str] = None
    available_from: Annotated[Optional[datetime], Lenient] = None


class Images(DRModel):
    wallpaper: Optional[str] = None


class Item(DRModel):
    """Fields shared by every kind of DR item (show, season, episode, program)"""

    id: str
    title: str
    path: str
    short_description: str = ""
    description: str = ""
    images: Images = Images()
    custom_fields: CustomFields = CustomFields()
    # Set on episodes, like in search results
    show_id: Optional[str] = None


class ItemList(DRModel, Generic[T]):
    items: list[T]


def parse_len(s: str) -> int:
    """Parses a length like "43M" or "1T 5M" into minutes"""
    t = 0
    if "T" in s:
        hours, s = s.split("T")
        t += int(hours) * 60
    s = s.strip()
    if s[-1] == "M":
        t += int(s[:-1])
    return t


class Episode(Item):
    title: Optional[str] = None
    contextual_title: Optional[str] = None
    release_year: Optional[int] = None
    episode_number: Annotated[Optional[int], Lenient] = None

    @property
    def display_title(self) -> str:
        return self.contextual_title or self.title or self.id

    @property
    def len_minutes(self) -> Optional[int]:
        try:
            _, len_part = self.custom_fields.extra_details.split(" | ")
            return parse_len(len_part)
        except (AttributeError, ValueError, IndexError):
            return None

    @property
    def pubdate(self) -> datetime:
        """The best publication date we can find, falling back to now"""
        if self.custom_fields.available_from is not None:
            return self.custom_fields.available_from
        try:
            date_part, _ = self.custom_fields.extra_details.split(" | ")
            return datetime.strptime(date_part, "%d. %b %Y").astimezone(COPENHAGEN)
        except (AttributeError, ValueError):
            pass
        if self.release_year:
            return datetime(year=self.release_year, month=1, day=1)
        return datetime.now(tz=COPENHAGEN)


class SeasonRef(DRModel):
    """A season as listed on its show"""

    id: str
    title: str
    path: str
    season_number: Optional[int] = None
    release_year: Optional[int] = None


class NextEpisode(DRModel):
    available_utc: int = Field(alias="availableUTC")


class Show(Item):
    type: Literal["show"]
    seasons: ItemList[SeasonRef]
    next_episode: Optional[NextEpisode] = None


class Season(Item):
    """A season, including its show and episodes"""

    type: Literal["season"]
    show: Show
    episodes: ItemList[Episode]


class ChannelCustomFields(BaseModel):
    hls_url: str = Field(alias="hlsURL")
    # The same channel, with Danish subtitles burnt into the picture
    hls_subtitles_url: Annotated[Optional[str], Lenient] = Field(None, alias="hlsWithSubtitlesURL")
    # Like "#FF001E"
    colour: Annotated[Optional[str], Lenient] = Field(
        None, alias="channelHexColour", pattern=r"^#[0-9A-Fa-f]{6}$"
    )


class Channel(DRModel):
    id: str
    title: str
    channel_short_code: str
    custom_fields: ChannelCustomFields


class Broadcast(Item):
    """A programme as it's shown on a live channel"""

    id: Optional[str] = None
    path: Optional[str] = None


class ScheduledBroadcast(DRModel):
    start_date: datetime
    end_date: datetime
    item: Broadcast


class ChannelSchedule(DRModel):
    """What's on a live channel, from /schedules"""

    channel_id: str
    schedules: list[ScheduledBroadcast]


class DiscoverCustomFields(BaseModel):
    model_config = ConfigDict(alias_generator=to_pascal, populate_by_name=True)

    # A short clip, as HLS, which DR plays without sound at the top of its front page
    short_video_url: Annotated[Optional[str], Lenient] = None
    # Like "Fiktionsserie" or "Livsstil,Underholdning"
    display_category: Annotated[Optional[str], Lenient] = None


class DiscoverItem(DRModel):
    """A show, season, episode, programme or link, in one of DR's rows"""

    id: str
    type: str
    title: str
    path: str
    show_id: Optional[str] = None
    short_description: str = ""
    tagline: Annotated[Optional[str], Lenient] = None
    images: Images = Images()
    custom_fields: DiscoverCustomFields = DiscoverCustomFields()


class Paging(DRModel):
    # In pages, not items
    total: int = 1


class PageList(DRModel):
    id: str
    title: Optional[str] = None
    # Each checked on its own, so one odd item doesn't lose the whole row
    items: list[dict] = []
    paging: Annotated[Paging, Lenient] = Paging()


class PageEntry(DRModel):
    """A part of one of DR's pages, like the featured programmes at the top, or a row"""

    template: Optional[str] = None
    title: Optional[str] = None
    list: Annotated[Optional[PageList], Lenient] = None


class Page(DRModel):
    title: Optional[str] = None
    entries: list[PageEntry] = []


class SearchResponse(DRModel):
    """Response from the search API.

    It also has a "movies" key, but it's always empty.
    Movies are found among the playables."""

    series: ItemList[Item]
    playable: ItemList[Item]


class Token(DRModel):
    value: str
    type: str
    expiration_date: datetime
