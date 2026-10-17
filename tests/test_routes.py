"""Renders every page against the fixtures, to catch template breakage"""

import asyncio
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from drtvrss import discover, drtv
from drtvrss import models as dr

from .conftest import load


def test_index(get):
    r = get("/")
    assert r.status_code == 200
    assert 'href="/live/DR1"' in r.text


def test_show(get):
    r = get("/rejseholdet_503605/")
    assert r.status_code == 200
    assert "Rejseholdet" in r.text
    assert "Sæson 1" in r.text
    assert 'href="rejseholdet_503615"' in r.text
    assert 'href="/rejseholdet_503605.xml"' in r.text
    assert '<link rel="alternate" type="application/rss+xml" title="Rejseholdet" href="/rejseholdet_503605.xml">' in r.text
    # Only for feed readers to find, until it's a setting
    assert "Abonnér med RSS" not in r.text
    # Seasons in order
    assert r.text.index("Sæson 1") < r.text.index("Sæson 2") < r.text.index("Sæson 3") < r.text.index("Sæson 4")
    # Small pictures for the episodes; full HD only on offer for the big one, for screens that need it
    episodes = r.text.split('class="seasons"')[1]
    assert "Width=1920" not in episodes and "Width=640" in episodes
    assert "1920w\" sizes=\"100vw\"" in r.text
    # All but the big picture at the top, which is seen right away
    assert r.text.count('loading="lazy"') == r.text.count("<img") - 1
    assert "Width=1280" in r.text
    assert "1. okt. 2000" in r.text and "59 min." in r.text
    assert "4 sæsoner" in r.text and "32 afsnit" in r.text
    # Seasons become tabs, with the first selected until ui.js knows where the viewer got to
    assert '<button type="button" class="season-tab" role="tab" id="season-tab-1" aria-controls="season-1" aria-selected="true">Sæson 1</button>' in r.text
    assert '<button type="button" class="season-tab" role="tab" id="season-tab-4" aria-controls="season-4" aria-selected="false" tabindex="-1">Sæson 4</button>' in r.text
    # Can be made a favourite
    assert 'class="button button-secondary js-favorite" aria-pressed="false" data-favorite-id="rejseholdet_503605" data-kind="show" data-title="Rejseholdet"' in r.text
    # For showing how far the viewer got with each episode, and what to play
    assert '<script src="/static/progress.js?v=' in r.text
    assert 'data-video-id="503615"' in r.text
    assert 'class="button button-primary js-play" href="/rejseholdet_503605/rejseholdet_503615"' in r.text
    assert '{"id": "503615", "season": "S\\u00e6son 1", "title": "1. episode", "url": "/rejseholdet_503605/rejseholdet_503615"}' in r.text


def test_show_next_episode_is_announced(get, monkeypatch):
    blob = load("items_503612.json")
    blob["show"]["nextEpisode"] = {"availableUTC": "1760000000"}
    get_api = drtv.get_api

    async def with_next_episode(path, **params):
        return blob if path == "/items/503612" else await get_api(path, **params)

    monkeypatch.setattr(drtv, "get_api", with_next_episode)
    # 08:53 UTC, so 10:53 in Denmark
    assert "Nyt afsnit 9. okt. kl. 10.53" in get("/rejseholdet_503605/").text


def test_recommended_shows_are_listed_on_index(get, monkeypatch):
    monkeypatch.setenv("RECOMMENDED_SHOWS", "findes-ikke_1:rejseholdet_503605")
    get("/rejseholdet_503605/")
    r = get("/")
    assert "Anbefalede serier" in r.text
    assert 'href="/rejseholdet_503605/"' in r.text
    assert "Width=640&amp;Height=360" in r.text
    # For marking how many of its episodes the viewer has seen
    assert 'data-episode-ids="503615 ' in r.text


def test_other_visitors_shows_are_not_listed_on_index(get):
    get("/rejseholdet_503605/")
    get("/rejseholdet_503605.xml")
    r = get("/")
    assert 'href="/rejseholdet_503605/"' not in r.text
    assert "Anbefalede serier" not in r.text


def test_front_page_without_drs(get, monkeypatch):
    async def get_page(path, **kwargs):
        return None

    monkeypatch.setattr("drtvrss.discover.get_page", get_page)
    r = get("/")
    assert r.status_code == 200
    assert "<h2>Serier, film og direkte TV</h2>" in r.text
    assert 'action="/search/"' in r.text


def test_front_page_features_drs_programmes(get):
    r = get("/")
    # Like DR's own, which has a dozen or so
    slides = r.text.count('class="hero-slide"')
    assert 3 < slides <= 12
    # Bars instead of the titles a second time, named for screen readers
    assert r.text.count('class="featured-bar"') == slides
    assert 'aria-label="' in r.text.split('class="featured-bars"')[1].split("</div>")[0]
    assert 'data-preview="https://' in r.text
    assert "featured-clips" not in r.text
    # DR's rows, with links to the pages here
    assert '<h2 class="shelf-title" id="row-1">' in r.text
    featured = r.text.split('id="featured-1"')[1].split('id="featured-2"')[0]
    assert '<a class="button button-primary" href="/' in featured
    # Each a favourite, but the live channels
    for slide in r.text.split('class="hero-slide"')[1:]:
        slide = slide.split("</section>")[0]
        assert ("js-favorite" in slide) == ("data-live" not in slide)


def test_header_has_the_logo_and_the_sections(get):
    r = get("/")
    assert '<a class="logo" href="/" aria-label="Flimmerkassen, forsiden" aria-current="page"><span class="logo-word">Fl<span class="logo-i">ı</span>mmer</span></a>' in r.text
    nav = r.text.split('<nav class="site-nav"')[1].split("</nav>")[0]
    for title in ["Direkte", "Serier", "Film", "Dokumentar", "Kategorier", "Favoritter"]:
        assert f"{title}</a>" in nav
    assert "Forside" not in nav
    assert "<title>Flimmerkassen</title>" in r.text
    assert '<link rel="icon" href="/favicon.svg" type="image/svg+xml">' in r.text


def test_small_screens_have_tabs(get):
    def tabs(path):
        return get(path).text.split('<nav class="tab-bar"')[1].split("</nav>")[0]
    assert re.findall(r"</span>([^<]+)</a>", tabs("/")) == ["Forside", "Direkte", "Kategorier", "Søg", "Favoritter"]
    assert '<a href="/" class="tab" aria-current="page">' in tabs("/")
    film = tabs("/kategorier/film/")
    assert '<a href="/kategorier/" class="tab" aria-current="page">' in film
    assert film.count("aria-current") == 1


def test_films_can_be_favourites_from_their_page(get):
    r = get("/program/lise-noergaard_-ikke-kun-en-pige_362031")
    assert 'data-favorite-id="lise-noergaard_-ikke-kun-en-pige_362031" data-kind="film"' in r.text
    # But not an episode, which belongs to its show
    assert "js-favorite" not in get("/rejseholdet_503605/rejseholdet_503615").text.split('class="watch"')[1].split('class="episode-nav"')[0]


def test_rows_link_to_all_of_them(get):
    r = get("/kategorier/fiktionsserier/")
    assert re.search(r'<a class="shelf-more" href="/liste/\d+/\?titel=[^"]+">Se alle', r.text)


def test_all_of_a_list(get, fake_dr, monkeypatch):
    async def get_api(path, /, **params):
        fake_dr.append(path + str(params.get("page")))
        if path != "/lists/355817":
            return await original(path, **params)
        page = params["page"]
        return {"id": "355817", "title": "Film | A - Å", "paging": {"total": 2},
                "items": [{"id": str(page * 1000 + i), "type": "program", "title": f"Film {page}-{i}",
                           "path": f"/program/film-{page}-{i}_{page * 1000 + i}"} for i in range(3)]}

    from drtvrss import discover
    original = discover.get_api
    monkeypatch.setattr(discover, "get_api", get_api)
    r = get("/liste/355817/?titel=A%20-%20%C3%85")
    assert r.status_code == 200
    assert "<h1>A - Å</h1>" in r.text
    # Both pages
    assert r.text.count('class="tile"') == 6
    assert 'href="/program/film-2-2_2002"' in r.text
    assert get("/liste/355817/").text.count("<h1>Film: A - Å</h1>") == 1


def test_footer_says_it_isnt_drs_and_links_to_privacy_syncing_and_the_source(get):
    footer = get("/").text.split('<footer class="site-footer">')[1].split("</footer>")[0]
    assert "Flimmerkassen er en uofficiel alternativ brugerflade, og er ikke tilknyttet til DR." in footer
    assert "Alt indhold hentes direkte fra DR's servere, og siden giver ikke adgang til andet materiale end det, DR selv stiller til rådighed. DR og DRTV er DR's varemærker." in footer
    assert '<a href="/privatliv/">Privatliv</a>' in footer
    assert '<a href="/sync/">' in footer
    assert '<a href="https://github.com/devjoda/dktv">Kildekode</a>' in footer


def test_names_dr_only_in_the_footer(get):
    # Not the front page or searches, whose channels and descriptions are DR's own, like "DR Ramasjang"
    for path in ["/rejseholdet_503605/", "/rejseholdet_503605/rejseholdet_503615", "/search/", "/kategorier/", "/favoritter/", "/sync/"]:
        page = get(path).text
        said = re.sub(r"<[^>]*>", " ", re.sub(r"<script.*?</script>", "", page.split('<footer class="site-footer">')[0], flags=re.S))
        said += " ".join(re.findall(r'(?:placeholder|aria-label|title)="([^"]*)"', page))
        assert not re.search(r"\bDR\b|DRTV", said), path


def test_privacy(get):
    r = get("/privatliv/")
    assert r.status_code == 200
    assert "<title>Privatliv - Flimmerkassen</title>" in r.text
    assert "ingen reklamer og ingen sporing" in r.text


def test_favicon(get):
    assert get("/favicon.svg").text.startswith("<svg")


def test_the_source_can_be_elsewhere(get, monkeypatch):
    monkeypatch.setattr("drtvrss.SOURCE_URL", "https://example.com/kode")
    assert '<a href="https://example.com/kode">Kildekode</a>' in get("/").text


def test_featured_facts_lead_somewhere(get):
    r = get("/")
    featured = r.text.split('id="featured-1"')[1].split('id="featured-2"')[0]
    # Its category, and the episode DR mentions
    assert '<a class="meta-link" href="/kategorier/' in featured
    assert re.search(r'<a class="meta-link" href="/\d+/afsnit/\d+\?saeson=\d+">Episode', featured)
    # Plays it, instead of showing the show's page
    assert re.search(r'<a class="button button-primary" href="/\d+/afsnit/', featured)


def test_playing_an_episode_by_its_number(get):
    # Rejseholdet's second season
    r = get("/rejseholdet_503605/afsnit/2?saeson=503607")
    assert r.status_code == 302
    assert r.location == "/rejseholdet_503605/rejseholdet_503624"
    # Without a season, the newest; and numbers past the end, the last one
    assert get("/rejseholdet_503605/afsnit/1").location == "/rejseholdet_503605/rejseholdet_503616"
    assert get("/rejseholdet_503605/afsnit/99?saeson=503612").location == "/rejseholdet_503605/rejseholdet_503636"


def test_categories(get):
    r = get("/kategorier/")
    assert r.status_code == 200
    assert '<a class="category" href="/kategorier/fiktionsserier/">' in r.text
    assert '<span class="category-title">Dokumentar</span>' in r.text
    # Search does A to Å better
    assert "a-aa" not in r.text
    # Serier, Film and Dokumentar first
    urls = re.findall(r'<a class="category" href="([^"]+)">', r.text)
    assert urls[:3] == ["/kategorier/fiktionsserier/", "/kategorier/film/", "/kategorier/dokumentar/"]
    assert len(urls) > 3


def test_category(get):
    r = get("/kategorier/fiktionsserier/")
    assert r.status_code == 200
    assert "<h1>Serier</h1>" in r.text
    assert '<a href="/kategorier/fiktionsserier/" class="nav-item" aria-current="page">Serier</a>' in r.text
    assert '<h2 class="shelf-title" id="row-1">' in r.text
    assert get("/kategorier/findes-ikke/").status_code == 404


def test_direkte_opens_dr1_without_a_channel_watched(get):
    r = get("/live/")
    assert r.status_code == 302
    assert r.location == "/live/DR1"
    assert r.headers["Cache-Control"] == "private, no-store"


def test_direkte_opens_the_channel_watched_last(get):
    for slug in ["DR2", "EVA", "TVR"]:
        r = get("/live/", {"Cookie": f"lastChannel={slug}"})
        assert r.status_code == 302
        assert r.location == f"/live/{slug}"
        assert r.headers["Cache-Control"] == "private, no-store"
    assert get("/live/").location == "/live/DR1"


def test_direkte_ignores_what_isnt_a_channel(get):
    for value in ["DR9", "dr2", "__proto__", "..%2Fsync%2F", ""]:
        assert get("/live/", {"Cookie": f"lastChannel={value}"}).location == "/live/DR1"


def test_live_plan(get, monkeypatch):
    monkeypatch.setattr("drtvrss.live.now", lambda: datetime(2026, 10, 12, 15, 0, tzinfo=timezone.utc))
    r = get("/live/plan.json")
    assert r.status_code == 200
    plan = json.loads(r.text)["plan"]
    assert list(plan) == ["DR1", "DR2", "EVA", "TVR"]
    for programmes in plan.values():
        assert programmes
        for p in programmes:
            assert p["end"] > datetime(2026, 10, 12, 15, 0, tzinfo=timezone.utc).timestamp() * 1000
            assert sorted(p) == ["description", "end", "start", "title"]
    # All of each description, as in the programme list
    assert any(len(p["description"]) > 280 and not p["description"].endswith("…") for p in sum(plan.values(), []))


def test_favorites_page(get):
    r = get("/favoritter/")
    assert r.status_code == 200
    # Series and films together, in one grid
    grid = r.text.index('<section class="results" id="favorite-list" data-favorites="all" aria-label="Dine favoritter" hidden>')
    assert r.text.count("data-favorites=") == 1
    # Se videre is on the front page
    assert 'id="continue-watching"' not in r.text
    # The filters, which favorites.js shows when there are enough of more than one kind, before the favourites
    filters = r.text.split('<div class="favorite-filters wrap js-favorite-filters" role="group" aria-label="Vis" hidden>')[1].split("</div>")[0]
    assert re.findall(r'data-filter="(\w+)" aria-pressed="(\w+)">([^<]+)<', filters) == [
        ("alle", "true", "Alle "), ("serier", "false", "Serier "), ("film", "false", "Film "), ("dokumentar", "false", "Dokumentar "),
    ]
    assert r.text.index("js-favorite-filters") < grid
    # The same page, whatever filter the address has, which only the browser reads
    assert get("/favoritter/?vis=dokumentar").text == r.text


def test_unknown_show(get):
    # One DR doesn't have any more, or never had
    r = get("/findes-ikke_1/")
    assert r.status_code == 404
    assert "Kan ikke længere ses" in r.text
    assert 'action="/search/"' in r.text
    not_one = get("/ikke-et-tal/")
    assert not_one.status_code == 404
    assert "Siden findes ikke" in not_one.text
    # A program isn't a show
    assert get("/lise-noergaard_-ikke-kun-en-pige_362031/").status_code == 404


def test_episode(get):
    r = get("/rejseholdet_503605/rejseholdet_503615")
    assert r.status_code == 200
    assert '<a class="eyebrow" href="/rejseholdet_503605/">' in r.text
    assert '<h1 class="watch-title">1. episode</h1>' in r.text
    assert 'type="application/rss+xml" title="Rejseholdet" href="/rejseholdet_503605.xml"' in r.text
    assert "<span>1. okt. 2000</span><span>59 min.</span>" in r.text
    assert 'poster="https://' in r.text
    assert 'playVideo(document.getElementById(\'video\'), "503615")' in r.text
    # The first episode has nothing before it
    assert "Forrige afsnit" not in r.text
    assert '<a class="episode-link episode-next" href="/rejseholdet_503605/rejseholdet_503640" data-video-id="503640" rel="next">' in r.text
    assert '<span class="episode-name">2. episode</span>' in r.text
    assert 'data-next-url="/rejseholdet_503605/rejseholdet_503640"' in r.text
    # What it saves about the video, to list it under "Se videre"
    assert 'data-title="1. episode"' in r.text
    assert 'data-show="Rejseholdet"' in r.text
    assert 'data-image="https://' in r.text and "Width=640" in r.text
    # Its season's episodes, beside the video or below it, with this one playing
    assert '<body class="video-page has-episodes">' in r.text
    episode_list = r.text.split('<aside class="episode-list" aria-labelledby="episode-list-title">')[1].split("</aside>")[0]
    assert '<h2 class="side-title" id="episode-list-title">Sæson 1</h2>' in episode_list
    assert '<a class="episode-row" href="/rejseholdet_503605/rejseholdet_503615" data-video-id="503615" aria-current="page">' in episode_list
    assert '<a class="episode-row" href="/rejseholdet_503605/rejseholdet_503640" data-video-id="503640">' in episode_list
    assert episode_list.count("aria-current") == 1
    assert "Alle afsnit" not in episode_list
    # Biograftilstand, before the page is drawn
    assert r.text.index('localStorage.getItem("cinema")') < r.text.index('<div class="stage">')


def test_episode_links_into_the_next_season(get):
    # The last episode of season 1
    r = get("/rejseholdet_503605/rejseholdet_503638")
    assert r.status_code == 200
    assert '<a class="episode-link episode-previous" href="/rejseholdet_503605/rejseholdet_503618" data-video-id="503618" rel="prev">' in r.text
    assert '<span class="episode-name">8. episode</span>' in r.text
    assert '<span class="episode-name">Sæson 2, 1. episode</span>' in r.text
    # There's no fixture for this episode's page, so it falls back to the short description
    assert "Dansk krimiserie fra 2000." in r.text


def test_unknown_episode(get):
    assert get("/rejseholdet_503605/findes-ikke_1").status_code == 404


def test_rss_feed(get):
    r = get("/rejseholdet_503605.xml")
    assert r.status_code == 200
    assert r.content_type == "application/rss+xml"
    assert ET.fromstring(r.text).findtext("channel/title") == "Rejseholdet"


def test_program(get):
    r = get("/program/lise-noergaard_-ikke-kun-en-pige_362031")
    assert r.status_code == 200
    assert "Lise Nørgaard: Ikke kun en pige" in r.text
    assert "<span>7. jan. 2023</span><span>48 min.</span>" in r.text
    assert 'poster="https://' in r.text
    assert 'playVideo(document.getElementById(\'video\'), "362031")' in r.text
    assert "Næste afsnit" not in r.text


def test_live_channel(get):
    r = get("/live/DR1")
    assert r.status_code == 200
    assert '<a href="/live/" class="nav-item" aria-current="page"><span class="live-dot"></span>Direkte</a>' in r.text
    data = json.loads(r.text.split('<script type="application/json" id="live-data">')[1].split("</script>")[0])
    assert data["channel"] == "DR1"
    assert [c["slug"] for c in data["channels"]] == ["DR1", "DR2", "EVA", "TVR"]
    assert data["channels"][0]["stream"].startswith("https://drlivedr1hls.akamaized.net/")
    assert "setupChannels(document.getElementById('video'), " in r.text


def test_live_channels_are_in_a_guide_of_ordinary_links(get):
    r = get("/live/DR1")
    guide = r.text.split('<nav class="channel-guide" id="channel-guide" aria-label="Kanaler">')[1].split("</nav>")[0]
    assert re.findall(r'<a class="guide-channel" href="(/live/\w+)"', guide) == ["/live/DR1", "/live/DR2", "/live/EVA", "/live/TVR"]
    assert '<a class="guide-channel" href="/live/DR1" data-channel="DR1" aria-current="page" style="--channel: #FF001E;">' in guide
    assert guide.count("aria-current") == 1
    assert '<a class="guide-channel" href="/live/EVA" data-channel="EVA" style="--channel: #f2efe9; --channel-on-paper: #0f1013;">' in guide
    assert '<a class="guide-channel" href="/live/TVR" data-channel="TVR" style="--channel: #9b6cff;">' in guide
    assert re.search(r'<section class="schedule" aria-labelledby="schedule-title" style="--channel: #FF001E;"( hidden)?>', r.text)
    assert "channel-switcher" not in r.text


def test_live_guide_says_whats_on_and_when_a_channel_is_on_again(get, monkeypatch):
    monkeypatch.setattr("drtvrss.live.now", lambda: datetime(2026, 10, 12, 11, 0, tzinfo=timezone.utc))
    r = get("/live/DR1")
    ramasjang = r.text.split('<a class="guide-channel" href="/live/TVR"')[1].split("</a>")[0]
    assert '<span class="guide-now">Sender igen kl. 13.35</span>' in ramasjang
    monkeypatch.setattr("drtvrss.live.now", lambda: datetime(2026, 10, 12, 11, 55, tzinfo=timezone.utc))
    dr1 = get("/live/DR1").text.split('<a class="guide-channel" href="/live/DR1"')[1].split("</a>")[0]
    assert '<span style="width: 50%;"></span>' in dr1
    assert re.search(r'<span class="guide-next">14\.10 [^<]+</span>', dr1)


def test_live_channel_in_small_letters(get):
    r = get("/live/dr2")
    assert r.status_code == 308
    assert r.location == "/live/DR2"


def test_pages_load_no_unused_scripts(get):
    assert "bootstrap.bundle" not in get("/").text


def test_unknown_live_channel(get):
    assert get("/live/DR9").status_code == 404


def test_search(get):
    r = get("/search/?query=matador")
    assert r.status_code == 200
    assert 'href="/matador_540736/"' in r.text
    assert 'href="/program/lise-noergaard_-ikke-kun-en-pige_362031"' in r.text
    assert "Afsnit" in r.text
    assert 'href="/557181/matadorerne_-den-foerste-kaempe_557186"' in r.text
    assert "Ingen resultater" not in r.text


def test_search_without_a_query_asks_for_one(get, fake_dr):
    for path in ["/search/", "/search/?query=", "/search/?query=++"]:
        r = get(path)
        assert r.status_code == 200
        assert "Søg efter serier, film og afsnit" in r.text
    assert not [r for r in fake_dr if r.startswith("search:")]


def test_search_without_results(get, monkeypatch):
    async def fetch_search(query):
        return {"series": {"items": []}, "playable": {"items": []}}

    monkeypatch.setattr(drtv, "fetch_search", fetch_search)
    r = get("/search/?query=xyzzy")
    assert r.status_code == 200
    assert "Ingen resultater for „xyzzy“" in r.text


def test_search_box_has_a_button(get):
    text = get("/").text
    assert '<button type="submit" class="search-submit" aria-label="Søg">' in text


def test_dr_being_down_is_not_a_missing_page(get, monkeypatch):
    async def get_api(path, **params):
        raise drtv.DRUnavailable("DR responded 503")

    monkeypatch.setattr(drtv, "get_api", get_api)
    monkeypatch.setattr("drtvrss.live.get_api", get_api)
    # Even the channels in the header can't be fetched, so every page fails
    for path in ["/", "/rejseholdet_503605/"]:
        r = get(path)
        assert r.status_code == 503
        assert "Programmerne kan ikke hentes lige nu" in r.text


def test_unexpected_errors_get_a_page_too(get, monkeypatch):
    async def get_show(show):
        raise ValueError("Show 503605 has no seasons")

    monkeypatch.setattr("drtvrss.get_show", get_show)
    r = get("/rejseholdet_503605/")
    assert r.status_code == 500
    assert "Noget gik galt" in r.text


def test_dr_style_links_redirect(get):
    for path in ["/serie/rejseholdet_503605", "/drtv/serie/rejseholdet_503605"]:
        r = get(path)
        assert r.status_code == 302
        assert r.location == "/rejseholdet_503605/"


def test_player_script(get):
    r = get("/static/player.js")
    assert r.status_code == 200
    assert "javascript" in r.content_type
    assert "async function playVideo(" in r.text


def test_players_load_pinned_hls_js_and_player_script(get):
    for path in ["/program/lise-noergaard_-ikke-kun-en-pige_362031", "/live/DR1"]:
        text = get(path).text
        assert '<script src="/static/vendor/hls-1.7.3.min.js" integrity="sha384-' in text
        assert '<script src="/static/player.js?v=' in text


def test_libraries_are_served_from_here(get):
    for path in ["/", "/rejseholdet_503605/", "/program/lise-noergaard_-ikke-kun-en-pige_362031"]:
        text = get(path).text
        assert "cdn.jsdelivr.net" not in text
        assert '<link href="/static/vendor/bootstrap-5.3.3.min.css" rel="stylesheet" integrity="sha384-' in text
    for path in ["/static/vendor/bootstrap-5.3.3.min.css", "/static/vendor/hls-1.7.3.min.js"]:
        assert get(path).status_code == 200


def test_service_worker_is_served_from_the_root(get):
    r = get("/sw.js")
    assert r.status_code == 200
    assert "javascript" in r.content_type
    assert "ResizeImage" in r.text
    assert 'navigator.serviceWorker.register("/sw.js")' in get("/").text


def test_dr_is_not_told_where_it_is_used_from(get):
    assert '<meta name="referrer" content="no-referrer">' in get("/").text


def test_index_can_continue_watching(get):
    r = get("/")
    assert '<section class="shelf" id="continue-watching" aria-labelledby="continue-title" hidden>' in r.text
    assert '<script src="/static/progress.js?v=' in r.text
    assert '<script src="/static/ui.js?v=' in r.text


def test_index_can_list_favorites(get):
    r = get("/")
    assert '<section class="shelf" id="favorites" data-favorites="all" aria-labelledby="favorites-title" hidden>' in r.text
    assert '<script src="/static/favorites.js?v=' in r.text
    assert '<div id="toast" class="toast-message" role="status" aria-live="polite"></div>' in r.text


def test_favorites_are_described(get):
    r = get("/favorites.json?shows=rejseholdet_503605:findes-ikke_1:ikke-et-tal&films=lise-noergaard_-ikke-kun-en-pige_362031:findes-ikke_2")
    assert r.status_code == 200
    favorites = __import__("json").loads(r.text)
    # The ones that can't be found are left out, instead of failing it all
    assert list(favorites["shows"]) == ["rejseholdet_503605"]
    assert list(favorites["films"]) == ["lise-noergaard_-ikke-kun-en-pige_362031"]
    film = favorites["films"]["lise-noergaard_-ikke-kun-en-pige_362031"]
    assert film["title"] == "Lise Nørgaard: Ikke kun en pige"
    assert film["url"] == "/program/lise-noergaard_-ikke-kun-en-pige_362031"
    assert film["minutes"] == 48
    rejseholdet = favorites["shows"]["rejseholdet_503605"]
    assert rejseholdet["title"] == "Rejseholdet"
    assert rejseholdet["url"] == "/rejseholdet_503605/"
    assert "Width=640" in rejseholdet["image"]
    assert rejseholdet["seasons"] == 4
    assert rejseholdet["episodes"] == 32 == len(rejseholdet["episode_ids"])
    assert rejseholdet["episode_ids"][0] == "503615"
    assert rejseholdet["new"] is False
    # Whether each is a documentary, from DR's categories in what's kept, as on the page Dokumentar
    assert rejseholdet["documentary"] is False
    assert film["documentary"] is True


def test_favorites_tell_of_new_episodes_from_the_series_as_its_kept(get, fake_dr, monkeypatch):
    from datetime import datetime, timezone
    from drtvrss import show as show_module

    monkeypatch.setattr(show_module, "current_time", lambda tz=None: datetime(2004, 1, 2, 12, tzinfo=timezone.utc).astimezone(tz))
    get("/rejseholdet_503605/")
    asked = len(fake_dr)
    found = __import__("json").loads(get("/favorites.json?shows=rejseholdet_503605").text)
    # Without asking DR again
    assert [p for p in fake_dr[asked:] if p.startswith("/items/")] == []
    new = found["shows"]["rejseholdet_503605"]["new_episodes"]
    assert [(e["id"], e["season"], e["number"], e["url"]) for e in new] == [
        ("503636", 4, 2, "/rejseholdet_503605/rejseholdet_503636"),
        ("503616", 4, 1, "/rejseholdet_503605/rejseholdet_503616"),
    ]
    assert new[0]["published"] == int(datetime(2004, 1, 1, 20, tzinfo=timezone.utc).timestamp() * 1000)
    assert "Width=640" in new[0]["image"]
    assert set(new[0]) == {"id", "title", "season", "number", "url", "published", "image"}


def test_favorites_without_new_episodes(get):
    found = __import__("json").loads(get("/favorites.json?shows=rejseholdet_503605").text)
    assert found["shows"]["rejseholdet_503605"]["new_episodes"] == []


def test_no_links_to_dr_on_series_episodes_or_films(get):
    for path in ["/rejseholdet_503605/", "/rejseholdet_503605/rejseholdet_503615", "/program/lise-noergaard_-ikke-kun-en-pige_362031"]:
        r = get(path)
        assert r.status_code == 200
        assert "Se originalen" not in r.text
        assert "www.dr.dk/drtv" not in r.text


def test_every_page_has_the_bell_and_its_page(get):
    for path in ["/", "/favoritter/", "/sync/"]:
        r = get(path)
        assert '<a class="bell-link js-bell" href="/nyt/" aria-label="Nyt til dig">' in r.text
        assert '<script src="/static/news.js?v=' in r.text
    r = get("/nyt/")
    assert r.status_code == 200
    assert "<title>Nyt til dig - " in r.text
    assert '<div class="news js-news" id="news-page" data-full></div>' in r.text
    assert 'aria-label="Nyt til dig" aria-current="page"' in r.text


def test_no_favorites(get, fake_dr):
    r = get("/favorites.json")
    assert r.status_code == 200
    assert __import__("json").loads(r.text) == {"shows": {}, "films": {}}
    assert not [r for r in fake_dr if r.startswith("/items/")]


def test_shows_can_be_made_favorites_from_their_tiles(get, monkeypatch):
    r = get("/search/?query=matador")
    assert 'aria-label="Favorit: Matador" title="Favorit"' in r.text
    assert 'data-favorite-id="matador_540736" data-kind="show"' in r.text
    # Films too
    assert 'data-favorite-id="lise-noergaard_-ikke-kun-en-pige_362031" data-kind="film"' in r.text
    monkeypatch.setenv("RECOMMENDED_SHOWS", "rejseholdet_503605")
    get("/rejseholdet_503605/")
    assert 'data-favorite-id="rejseholdet_503605"' in get("/").text


def test_players_use_plyr(get):
    for path in ["/rejseholdet_503605/rejseholdet_503615", "/live/DR1"]:
        text = get(path).text
        assert '<script src="/static/vendor/plyr-3.8.4.min.js" integrity="sha384-' in text
        assert '<link href="/static/vendor/plyr-3.8.4.css" rel="stylesheet" integrity="sha384-' in text
    assert "setupChannels(document.getElementById('video'), " in get("/live/DR1").text
    for path in ["/static/vendor/plyr-3.8.4.min.js", "/static/vendor/plyr-3.8.4.css", "/static/vendor/plyr-3.8.4.svg"]:
        assert get(path).status_code == 200


def test_index_lists_the_live_channels(get):
    r = get("/")
    assert '<h2 class="shelf-title" id="live-title">Direkte TV</h2>' in r.text
    assert '<a class="tile-link" href="/live/DR1" style="--channel: #FF001E;">' in r.text
    # TV A in warm white, and Ramasjang in purple, instead of DR's red and turquoise, too like DR1's and DR2's
    assert '<a class="tile-link" href="/live/EVA" style="--channel: #f2efe9; --channel-on-paper: #0f1013;">' in r.text
    assert '<a class="tile-link" href="/live/TVR" style="--channel: #9b6cff;">' in r.text


def test_channels_show_whats_on(get, monkeypatch):
    # During "Hammerslag" on DR1, 11.40 to 12.10 UTC in the fixture
    monkeypatch.setattr("drtvrss.live.now", lambda: datetime(2026, 10, 12, 11, 55, tzinfo=timezone.utc))
    r = get("/")
    assert '<span class="visually-hidden">DR1: </span>Hammerslag 2022 - Lejlighed i storbyen</h3>' in r.text
    # In Danish time
    assert "Til 14.10, derefter" in r.text
    assert 'aria-valuenow="50"' in r.text

    r = get("/live/DR1")
    assert '<li class="programme is-now" data-start="2026-10-12T11:40:00+00:00" data-end="2026-10-12T12:10:00+00:00">' in r.text
    assert '<time class="programme-time" datetime="2026-10-12T11:40:00+00:00">13.40</time>' in r.text
    assert "Til 14.10" in r.text
    # With a choice of subtitles
    assert '<button type="button" class="button button-secondary js-live-subtitles" aria-pressed="false">' in r.text
    assert "drlivedr1texthls" in r.text


def test_channels_without_a_schedule(get, monkeypatch):
    # Long after the fixture's schedule
    monkeypatch.setattr("drtvrss.live.now", lambda: datetime(2030, 1, 1, tzinfo=timezone.utc))
    assert '<div class="channel-art">DR1</div>' in get("/").text
    r = get("/live/DR1")
    assert r.status_code == 200
    assert '<section class="schedule" aria-labelledby="schedule-title" style="--channel: #FF001E;" hidden>' in r.text


def test_pages_are_dark(get):
    for path in ["/", "/rejseholdet_503605/", "/search/", "/live/DR1"]:
        text = get(path).text
        assert '<html lang="da" data-bs-theme="dark">' in text
        assert '<link href="/static/style.css?v=' in text


def test_search_results_are_labelled_by_kind(get):
    r = get("/search/?query=matador")
    assert '<span class="tag tag-type">Serie</span>' in r.text
    assert '<span class="tag tag-type">Film</span>' in r.text
    assert '<span class="tag tag-type">Afsnit</span>' in r.text
    # Films and episodes can be marked as seen, series can't from here
    assert 'data-video-id="362031"' in r.text
    assert 'data-video-id="540736"' not in r.text


def test_our_static_files_are_versioned(get, tmp_path, monkeypatch):
    """So browsers, which keep them for a while, get the new ones right after an update"""
    from drtvrss import app, static_url

    text = get("/").text
    url = re.search(r'src="(/static/ui\.js\?v=\w+)"', text)[1]
    assert get(url).status_code == 200

    monkeypatch.setattr(app, "static_folder", str(tmp_path))
    (tmp_path / "ui.js").write_text("// old")
    old = static_url("ui.js")
    (tmp_path / "ui.js").write_text("// new, and longer")
    assert static_url("ui.js") != old
    assert static_url("ui.js").startswith("/static/ui.js?v=")


def test_responses_are_compressed(fake_dr):
    """For browsers that say they can take it"""
    import asyncio
    import gzip as gzip_module
    from drtvrss import app

    async def request(path, headers):
        async with app.test_app() as test_app:
            r = await test_app.test_client().get(path, headers=headers)
            return r, await r.get_data()

    def get(path, **headers):
        return asyncio.run(request(path, headers))

    r, body = get("/rejseholdet_503605/", **{"Accept-Encoding": "gzip, deflate, br"})
    assert r.headers["Content-Encoding"] == "gzip"
    assert "Accept-Encoding" in r.headers["Vary"]
    page = gzip_module.decompress(body).decode()
    assert "<h1 class=\"hero-title\">Rejseholdet</h1>" in page
    assert len(body) < len(page) / 4

    r, body = get("/rejseholdet_503605/")
    assert "Content-Encoding" not in r.headers
    assert b"Rejseholdet" in body

    # Scripts and feeds too, but not what's compressed already, or too small to be worth it
    assert get("/static/ui.js", **{"Accept-Encoding": "gzip"})[0].headers["Content-Encoding"] == "gzip"
    assert get("/rejseholdet_503605.xml", **{"Accept-Encoding": "gzip"})[0].headers["Content-Encoding"] == "gzip"
    assert "Content-Encoding" not in get("/static/vendor/schibsted-grotesk-5.3.0-latin.woff2", **{"Accept-Encoding": "gzip"})[0].headers
    assert "Content-Encoding" not in get("/favorites.json", **{"Accept-Encoding": "gzip"})[0].headers


def test_what_to_watch_next_is_from_the_narrowest_category_dr_has_a_page_for(get):
    r = get("/forslag/serie/rejseholdet_503605")
    assert r.status_code == 200
    similar = json.loads(r.text)
    # Rejseholdet is Krimi and Gensyn too, which the fixtures have no page for
    assert similar["label"] == "Serier"
    assert 0 < len(similar["cards"]) <= 8
    assert all("503605" not in c["url"] and c["title"] and c["url"].startswith("/") for c in similar["cards"])
    assert len({c["url"] for c in similar["cards"]}) == len(similar["cards"])
    assert json.loads(get("/forslag/program/lise-noergaard_-ikke-kun-en-pige_362031").text) == {"label": "", "cards": []}
    assert get("/forslag/noget/rejseholdet_503605").status_code == 404


def test_the_page_that_plays_one_knows_where_to_ask(get):
    episode = get("/rejseholdet_503605/rejseholdet_503615").text
    assert '<video id="video" controls crossorigin="anonymous" data-episode-id="503615" data-suggest="/forslag/serie/rejseholdet_503605"' in episode
    film = get("/program/lise-noergaard_-ikke-kun-en-pige_362031").text
    assert 'data-episode-id="362031" data-suggest="/forslag/program/lise-noergaard_-ikke-kun-en-pige_362031"' in film
    assert "/static/next.js?v=" in episode


def test_what_dr_says_a_programme_is_like_without_its_channels_people_and_how_it_can_be_watched():
    item = dr.DiscoverItem.model_validate({
        "id": "1", "type": "show", "title": "Rejseholdet", "path": "/serie/rejseholdet_1",
        "categories": ["Fiktionsserie", "Krimi", "DR1", "acc_spoken_subtitles"],
        "keywords": ["editorialptaxtop_serier", "editorialptaxsub_thriller/krimi", "mood_nervepirrende", "culturalorigin_ikke-dansk",
                     "person_lise nørgaard", "thesaurus_bankvæsen", "agetargetgroup_familie", "editorialptaxsub_krimi"],
        "availableSeasonCount": 3,
    })
    assert dr.tags(item) == ["fiktionsserie", "krimi", "serier", "thriller/krimi", "nervepirrende", "ikke-dansk", "familie"]
    c = discover.card(item, {})
    assert (c.tags, c.seasons) == (dr.tags(item), 3)
    film = discover.card(dr.DiscoverItem.model_validate({"id": "2", "type": "program", "title": "Film", "path": "/program/film_2", "duration": 5430, "categories": ["film"]}), {})
    assert film.minutes == 91


def test_vaelg_for_mig_has_its_page_and_the_ways_to_it(get):
    page = get("/vaelg/").text
    assert "<h1>Vælg for mig</h1>" in page
    assert '<a class="pick-link" href="/vaelg/" aria-label="Vælg for mig" title="Vælg for mig" aria-current="page">' in page
    assert 'class="pick wrap js-pick"' in page and '<dialog class="pick-result js-pick-result"' in page
    assert "/static/pick.js?v=" in page
    assert '<a class="pick-promo wrap" href="/vaelg/">' in get("/kategorier/").text
    assert '<p class="pick-line wrap"><a href="/vaelg/">' in get("/").text
    category = get("/kategorier/fiktionsserier/").text
    assert 'class="button button-secondary js-pick-surprise" hidden>' in category
    assert '<dialog class="pick-result js-pick-result"' in category


def test_what_to_watch_next_is_what_is_most_like_it_first(fake_dr):
    async def run():
        show = await drtv.get_show("rejseholdet_503605")
        page = await discover.get_page("/kategorier/fiktionsserier", max_rows=12)
        tags_of = {c.url: c.tags for c in [*page.featured, *(c for row in page.rows for c in row.cards)]}
        unsorted = await discover.similar_to(show.categories or [], "503605")
        moved = await discover.similar_to(show.categories or [], "503605", ["følelsesladet"])
        return show, tags_of, unsorted, moved

    show, tags_of, unsorted, moved = asyncio.run(run())
    assert "krimi" in show.tags
    assert "følelsesladet" not in tags_of[unsorted["cards"][0]["url"]]
    assert "følelsesladet" in tags_of[moved["cards"][0]["url"]]


def preview(get, path):
    """The page's Open Graph tags, by name, like the Worker's test"""
    text = get(path).text
    return dict(re.findall(r'<meta (?:property|name)="((?:og|twitter):[^"]+|description)" content="([^"]*)">', text))


def test_a_series_preview_has_its_name_description_and_picture(get):
    tags = preview(get, "/rejseholdet_503605/")
    assert tags["og:site_name"] == "Flimmerkassen"
    assert tags["og:title"] == "Rejseholdet"
    assert tags["og:type"] == "video.tv_show"
    assert tags["twitter:card"] == "summary_large_image"
    assert re.match(r"https://.*Width=1280", tags["og:image"])
    assert 20 < len(tags["og:description"]) <= 201
    assert tags["description"] == tags["og:description"]


def test_an_episodes_preview_has_its_series_name(get):
    assert preview(get, "/rejseholdet_503605/rejseholdet_503615")["og:title"] == "Rejseholdet: 1. episode"
    assert preview(get, "/rejseholdet_503605/rejseholdet_503615")["og:type"] == "video.episode"
    assert preview(get, "/program/lise-noergaard_-ikke-kun-en-pige_362031")["og:type"] == "video.other"


def test_other_pages_previews_say_what_they_are_with_the_sites_icon(get):
    for path, title in [("/", "Flimmerkassen"), ("/vaelg/", "Vælg for mig"), ("/favoritter/", "Flimmerkassen")]:
        tags = preview(get, path)
        assert tags["og:title"] == title, path
        assert tags["og:image"] == "http://localhost/static/icons/icon-512.png", path
        assert tags["twitter:card"] == "summary", path
        assert not re.search(r"\bDR\b|DRTV", tags.get("og:description", "")), path


def test_a_series_can_be_shared_from_its_page(get):
    assert '<button type="button" class="button button-secondary js-share-page" data-share-title="Rejseholdet">' in get("/rejseholdet_503605/").text


def test_preview_text_is_whole_sentences_that_fit_or_cut_after_a_word():
    from drtvrss.show import preview_text
    assert preview_text("Kort.") == "Kort."
    assert preview_text("En sætning om noget. " * 12) == ("En sætning om noget. " * 9).strip()
    assert re.fullmatch(r"(ord ){49}ord…", preview_text("ord " * 80))
