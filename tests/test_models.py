from datetime import datetime, timezone

import pytest
from pydantic import TypeAdapter, ValidationError

from drtvrss import models as dr
from drtvrss.models import COPENHAGEN, parse_len

from .conftest import load


def episode(**fields) -> dr.Episode:
    return dr.Episode.model_validate(
        {"id": "1", "title": "Titel", "path": "/episode/titel_1", **fields}
    )


@pytest.mark.parametrize(
    "s, minutes", [("43M", 43), ("1T 5M", 65), ("1T 0M", 60), ("2T 30M", 150)]
)
def test_parse_len(s, minutes):
    assert parse_len(s) == minutes


@pytest.mark.parametrize(
    "extra_details, minutes",
    [
        ("SÆSON 1 EPISODE 10 | 1T 5M", 65),
        ("1. DEC 2021 | 38M", 38),
        ("Fiktionsserie", None),
        ("SÆSON 1 | ", None),
        (None, None),
    ],
)
def test_episode_len_minutes(extra_details, minutes):
    assert episode(customFields={"ExtraDetails": extra_details}).len_minutes == minutes


def test_pubdate_prefers_available_from():
    ep = episode(
        releaseYear=1999,
        customFields={
            "ExtraDetails": "1. DEC 2021 | 38M",
            "AvailableFrom": "2000-10-01T18:00:08.0000000Z",
        },
    )
    assert ep.pubdate == datetime(2000, 10, 1, 18, 0, 8, tzinfo=timezone.utc)


def test_pubdate_falls_back_to_extra_details_date():
    ep = episode(releaseYear=1999, customFields={"ExtraDetails": "1. DEC 2021 | 38M"})
    assert ep.pubdate == datetime(2021, 12, 1).astimezone(COPENHAGEN)


def test_pubdate_falls_back_to_release_year():
    ep = episode(
        releaseYear=1999, customFields={"ExtraDetails": "SÆSON 1 EPISODE 1 | 59M"}
    )
    assert ep.pubdate == datetime(1999, 1, 1)


def test_pubdate_treats_malformed_available_from_as_missing():
    ep = episode(releaseYear=1999, customFields={"AvailableFrom": "i går"})
    assert ep.custom_fields.available_from is None
    assert ep.pubdate == datetime(1999, 1, 1)


def test_pubdate_ignores_release_year_zero():
    before = datetime.now(tz=COPENHAGEN)
    assert episode(releaseYear=0).pubdate >= before


def test_episode_display_title():
    assert episode(contextualTitle="1. episode").display_title == "1. episode"
    assert episode(contextualTitle="").display_title == "Titel"
    assert dr.Episode(id="42", path="/episode/x_42").display_title == "42"


def test_geo_restriction_is_parsed_from_strings():
    assert dr.CustomFields.model_validate({"IsGeoRestricted": "True"}).is_geo_restricted
    assert not dr.CustomFields.model_validate({"IsGeoRestricted": "False"}).is_geo_restricted
    assert not dr.CustomFields.model_validate({}).is_geo_restricted


def test_series_page():
    latest = dr.SeriesPage.model_validate(load("series.json")).latest_season()
    assert latest.show.title == "Rejseholdet"
    assert latest.show.path == "/serie/rejseholdet_503605"
    assert [s.season_number for s in latest.show.seasons.items] == [1, 2, 3, 4]


def test_series_page_without_a_season_is_an_error():
    blob = load("series.json")
    item_detail = blob["cache"]["itemDetail"]
    for key in list(item_detail)[1:]:
        del item_detail[key]
    with pytest.raises(ValueError, match="got show"):
        dr.SeriesPage.model_validate(blob).latest_season()


def test_missing_required_field_names_its_location():
    """The point of the models: when DR changes their format,
    the error says exactly what changed and where"""
    blob = load("series.json")
    latest = list(blob["cache"]["itemDetail"].values())[-1]["item"]
    del latest["show"]["title"]
    with pytest.raises(ValidationError) as e:
        dr.SeriesPage.model_validate(blob)
    [error] = e.value.errors()
    assert error["type"] == "missing"
    assert error["loc"][-4:] == ("item", "season", "show", "title")


def test_season_page():
    season = dr.Page[dr.Season].model_validate(load("season_503606.json"))
    item = season.item("/saeson/rejseholdet_503606")
    assert item.title == "Rejseholdet"
    first = item.episodes.items[0]
    assert first.path == "/episode/rejseholdet_503615"
    assert first.display_title == "1. episode"
    assert first.len_minutes == 59
    assert first.pubdate == datetime(2000, 10, 1, 18, 0, 8, tzinfo=timezone.utc)
    assert first.images.wallpaper.startswith("https://")


def test_episode_page():
    item = dr.Page[dr.Episode].model_validate(load("episode.json")).item()
    assert item.title == "Matador: Fødselsdagen"
    assert len(item.description) > len(item.short_description)


def test_program_page():
    item = dr.Page[dr.Item].model_validate(load("program.json")).item()
    assert item.title == "Lise Nørgaard: Ikke kun en pige"
    assert item.path == "/program/lise-noergaard_-ikke-kun-en-pige_362031"


def test_channel_page():
    channels = dr.ChannelPage.model_validate(load("channels.json")).channels()
    dr1 = next(c for c in channels if c.channel_short_code == "DR1")
    assert dr1.title == "DR1"
    assert ".m3u8" in dr1.custom_fields.hls_url


def test_channel_page_skips_other_lists():
    blob = load("channels.json")
    blob["cache"]["list"] = {
        "Bookmarks": {"list": {"items": []}},
        **blob["cache"]["list"],
    }
    channels = dr.ChannelPage.model_validate(blob).channels()
    assert "DR1" in [c.channel_short_code for c in channels]


def test_channel_page_without_channels():
    blob = {"cache": {"list": {"Bookmarks": {"list": {"items": []}}}}}
    assert dr.ChannelPage.model_validate(blob).channels() == []


def test_search_response():
    r = dr.SearchResponse.model_validate(load("search.json"))
    assert "/serie/matador_540736" in [i.path for i in r.series.items]
    assert len(r.playable.items) > 0


def test_token_response():
    tokens = TypeAdapter(list[dr.Token]).validate_python(
        [
            {
                "expirationDate": "2026-10-12T09:43:19.5597912Z",
                "refreshable": True,
                "value": "account",
                "type": "UserAccount",
            },
            {
                "expirationDate": "2026-10-12T09:43:19.5682811Z",
                "refreshable": True,
                "value": "profile",
                "type": "UserProfile",
            },
        ]
    )
    assert tokens[1].value == "profile"
    assert tokens[1].expiration_date.tzinfo is not None
