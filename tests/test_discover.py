import asyncio

from drtvrss import discover, models as dr

CHANNELS = {"20875": "DR1"}


def card(**item):
    return discover.card(dr.DiscoverItem.model_validate({"id": "1", "title": "Titel", **item}), CHANNELS)


def test_where_drs_items_go_here():
    assert card(type="show", path="/serie/matador_540736").url == "/matador_540736/"
    assert card(type="show", path="/serie/matador_540736").show_id == "matador_540736"
    # A season goes to its show
    assert card(type="season", path="/saeson/hoest_623828", showId="623827").url == "/623827/"
    episode = card(type="episode", path="/episode/matador_-foedselsdagen_540744", showId="540736")
    assert episode.url == "/540736/matador_-foedselsdagen_540744"
    assert episode.video_id == "540744"
    assert card(type="episode", path="/episode/noget_5").url == "/program/noget_5"
    assert card(type="program", path="/program/lise-noergaard_-ikke-kun-en-pige_362031").url == "/program/lise-noergaard_-ikke-kun-en-pige_362031"
    live = card(type="link", path="/kanal/dr1_20875")
    assert live.url == "/live/DR1" and live.live
    # Nothing here for these
    assert card(type="link", path="/kategorier/film") is None
    assert card(type="link", path="/kanal/ukendt_1") is None
    assert card(type="season", path="/saeson/x_1") is None


def test_taglines_are_split():
    c = card(type="show", path="/serie/hoest_1", tagline="Episode 1:7 | Stor ny dansk dramaserie",
             customFields={"DisplayCategory": "Fiktionsserie,DR1", "ShortVideoUrl": "https://example.com/clip.m3u8"})
    assert (c.detail, c.tagline, c.category) == ("Episode 1:7", "Stor ny dansk dramaserie", "Fiktionsserie")
    assert c.preview == "https://example.com/clip.m3u8"


def test_drs_front_page(fake_dr):
    page = asyncio.run(discover.get_page("/", max_rows=8))
    assert len(page.featured) >= 3
    assert all(c.url.startswith("/") for c in page.featured)
    assert page.rows
    titles = [row.title for row in page.rows]
    assert "Se live tv" not in titles and "Kategorier" not in titles
    assert all(len(row.cards) >= discover.MIN_ROW for row in page.rows)
    # Cached
    fake_dr.clear()
    assert asyncio.run(discover.get_page("/", max_rows=8)) is page
    assert fake_dr == []


def test_when_dr_does_not_answer(fake_dr, monkeypatch):
    page = asyncio.run(discover.get_page("/", max_rows=8))

    async def get_api(path, /, **params):
        raise ConnectionError("DR is down")

    monkeypatch.setattr(discover, "get_api", get_api)
    # The last one DR gave is used for a while longer
    assert asyncio.run(discover.get_page("/", refresh=True)) is page
    assert asyncio.run(discover.get_page("/kategorier/film")) is None


def test_categories(fake_dr):
    categories = asyncio.run(discover.get_categories())
    assert [c.title for c in categories][:3] == ["Serier", "Film", "Dokumentar"]
    assert all(c.url.startswith("/kategorier/") and c.url.endswith("/") for c in categories)
    assert "/kategorier/a-aa/" not in [c.url for c in categories]


def test_a_row_has_each_programme_once():
    show = {"id": "1", "type": "show", "title": "Mors dreng", "path": "/serie/mors-dreng_1"}
    season = {"id": "2", "type": "season", "title": "Mors dreng", "path": "/saeson/mors-dreng_2", "showId": "mors-dreng_1"}
    # A show and its season go to the same page
    assert len(discover.cards([show, season, show], CHANNELS)) == 1
    other = {"id": "3", "type": "show", "title": "Høst", "path": "/serie/hoest_3"}
    assert [c.title for c in discover.cards([show, other, show], CHANNELS)] == ["Mors dreng", "Høst"]
