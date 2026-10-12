"""Renders every page against the fixtures, to catch template breakage"""

import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from drtvrss import drtv

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
    assert "DR's serier, film og direkte TV" in r.text
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


def test_header_has_sections_instead_of_a_name(get):
    r = get("/")
    nav = r.text.split('<nav class="site-nav"')[1].split("</nav>")[0]
    for title in ["Forside", "Direkte", "Serier", "Film", "Dokumentar", "Kategorier", "Favoritter"]:
        assert f"{title}</a>" in nav
    assert '<a href="/" class="nav-item" aria-current="page">Forside</a>' in nav
    # Only in the window's title
    assert r.text.count("Public Service") == 1
    assert "<title>Public Service</title>" in r.text


def test_films_can_be_favourites_from_their_page(get):
    r = get("/program/lise-noergaard_-ikke-kun-en-pige_362031")
    assert 'data-favorite-id="lise-noergaard_-ikke-kun-en-pige_362031" data-kind="film"' in r.text
    # But not an episode, which belongs to its show
    assert "js-favorite" not in get("/rejseholdet_503605/rejseholdet_503615").text.split('class="watch"')[1].split("</aside>")[0].split('class="watch-side"')[0]


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


def test_footer_only_links_to_syncing(get):
    footer = get("/").text.split('<footer class="site-footer">')[1].split("</footer>")[0]
    assert '<a href="/sync/">' in footer
    assert "GitHub" not in footer and "Invidious" not in footer


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


def test_category(get):
    r = get("/kategorier/fiktionsserier/")
    assert r.status_code == 200
    assert "<h1>Serier</h1>" in r.text
    assert '<a href="/kategorier/fiktionsserier/" class="nav-item" aria-current="page">Serier</a>' in r.text
    assert '<h2 class="shelf-title" id="row-1">' in r.text
    assert get("/kategorier/findes-ikke/").status_code == 404


def test_live_channels(get):
    r = get("/live/")
    assert r.status_code == 200
    assert '<a class="tile-link" href="/live/DR1" style="--channel: #FF001E;">' in r.text
    assert '<a href="/live/" class="nav-item" aria-current="page"><span class="live-dot"></span>Direkte</a>' in r.text


def test_favorites_page(get):
    r = get("/favoritter/")
    assert r.status_code == 200
    # Shows first, and films below
    shows = r.text.index('<section class="results" id="favorite-shows" data-favorites="show"')
    films = r.text.index('<section class="results" id="favorite-films" data-favorites="film"')
    assert shows < films
    assert '<section class="results" id="continue-watching" aria-labelledby="continue-title" hidden>' in r.text


def test_unknown_show(get):
    r = get("/findes-ikke_1/")
    assert r.status_code == 404
    assert "Siden findes ikke" in r.text
    assert 'action="/search/"' in r.text
    assert get("/ikke-et-tal/").status_code == 404
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
    assert '<h2 class="side-title">Næste afsnit</h2>' in r.text
    assert '<a class="tile-link" href="/rejseholdet_503605/rejseholdet_503640">' in r.text
    assert '<article class="tile" data-video-id="503640">' in r.text
    assert 'data-next-url="/rejseholdet_503605/rejseholdet_503640"' in r.text
    # What it saves about the video, to list it under "Fortsæt med at se"
    assert 'data-title="1. episode"' in r.text
    assert 'data-show="Rejseholdet"' in r.text
    assert 'data-image="https://' in r.text and "Width=640" in r.text


def test_episode_links_into_the_next_season(get):
    # The last episode of season 1
    r = get("/rejseholdet_503605/rejseholdet_503638")
    assert r.status_code == 200
    assert '<h2 class="side-title">Forrige afsnit</h2>' in r.text
    assert '<h3 class="tile-title">8. episode</h3>' in r.text
    assert '<h3 class="tile-title">Sæson 2, 1. episode</h3>' in r.text
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
    assert "https://drlivedr1hls.akamaized.net/" in r.text


def test_current_live_channel_is_marked(get):
    r = get("/live/DR1")
    switcher = r.text.split('<nav class="channel-switcher"')[1].split("</nav>")[0]
    assert '<a href="/live/DR1" class="nav-item" aria-current="page"><span class="live-dot"></span>DR1</a>' in switcher
    assert switcher.count("aria-current") == 1


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
        assert "DR svarer ikke lige nu" in r.text


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
    assert "setupLive(document.getElementById('video'), " in get("/live/DR1").text
    for path in ["/static/vendor/plyr-3.8.4.min.js", "/static/vendor/plyr-3.8.4.css", "/static/vendor/plyr-3.8.4.svg"]:
        assert get(path).status_code == 200


def test_index_lists_the_live_channels(get):
    r = get("/")
    assert '<h2 class="shelf-title" id="live-title">Direkte TV</h2>' in r.text
    assert '<a class="tile-link" href="/live/DR1" style="--channel: #FF001E;">' in r.text


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
    assert 'class="button button-secondary js-live-subtitles" aria-pressed="false"' in r.text
    assert "drlivedr1texthls" in r.text


def test_channels_without_a_schedule(get, monkeypatch):
    # Long after the fixture's schedule
    monkeypatch.setattr("drtvrss.live.now", lambda: datetime(2030, 1, 1, tzinfo=timezone.utc))
    assert '<div class="channel-art">DR1</div>' in get("/").text
    r = get("/live/DR1")
    assert r.status_code == 200
    assert "Programoversigt" not in r.text


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
