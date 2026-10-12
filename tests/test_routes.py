"""Renders every page against the fixtures, to catch template breakage"""

import xml.etree.ElementTree as ET

from drtvrss import drtv


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
    assert "Abonnér med RSS" in r.text
    # Newest season first
    assert r.text.index("Sæson 4") < r.text.index("Sæson 3") < r.text.index("Sæson 1")
    assert "Width=1920" not in r.text
    assert r.text.count('loading="lazy"') == r.text.count("<img")
    assert "1. okt. 2000" in r.text and "59 min." in r.text
    # For showing how far the viewer got with each episode
    assert '<script src="/static/progress.js"></script>' in r.text
    assert 'data-video-id="503615"' in r.text


def test_recommended_shows_are_listed_on_index(get, monkeypatch):
    monkeypatch.setenv("RECOMMENDED_SHOWS", "findes-ikke_1:rejseholdet_503605")
    get("/rejseholdet_503605/")
    r = get("/")
    assert "Anbefalede serier" in r.text
    assert 'href="rejseholdet_503605"' in r.text
    assert "Width=640&amp;Height=360" in r.text


def test_other_visitors_shows_are_not_listed_on_index(get):
    get("/rejseholdet_503605/")
    get("/rejseholdet_503605.xml")
    r = get("/")
    assert 'href="rejseholdet_503605"' not in r.text
    assert "Anbefalede serier" not in r.text


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
    assert "Rejseholdet</a> - 1. episode" in r.text
    assert 'type="application/rss+xml" title="Rejseholdet" href="/rejseholdet_503605.xml"' in r.text
    assert "1. okt. 2000 · 59 min." in r.text
    assert 'poster="https://' in r.text
    assert 'playVideo(document.getElementById(\'video\'), "503615")' in r.text
    # The first episode has nothing before it
    assert "Forrige" not in r.text
    assert '<a href="/rejseholdet_503605/rejseholdet_503640" rel="next">Næste: 2. episode →</a>' in r.text
    assert 'data-next-url="/rejseholdet_503605/rejseholdet_503640"' in r.text
    # What it saves about the video, to list it under "Fortsæt med at se"
    assert 'data-title="1. episode"' in r.text
    assert 'data-show="Rejseholdet"' in r.text
    assert 'data-image="https://' in r.text and "Width=640" in r.text


def test_episode_links_into_the_next_season(get):
    # The last episode of season 1
    r = get("/rejseholdet_503605/rejseholdet_503638")
    assert r.status_code == 200
    assert 'rel="prev">← Forrige: 8. episode</a>' in r.text
    assert 'rel="next">Næste: Sæson 2, 1. episode →</a>' in r.text
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
    assert "7. jan. 2023 · 48 min." in r.text
    assert 'poster="https://' in r.text
    assert 'playVideo(document.getElementById(\'video\'), "362031")' in r.text
    assert "Næste" not in r.text


def test_live_channel(get):
    r = get("/live/DR1")
    assert r.status_code == 200
    assert "https://drlivedr1hls.akamaized.net/" in r.text


def test_current_live_channel_is_marked(get):
    r = get("/live/DR1")
    assert '<a href="/live/DR1" class="nav-link px-2 text-white fw-semibold text-decoration-underline link-offset-2" aria-current="page">DR1</a>' in r.text
    assert r.text.count('aria-current="page"') == 1
    assert 'aria-current' not in get("/").text


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
    assert '<button class="btn btn-outline-light" type="submit">Søg</button>' in get("/").text


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
        assert '<script src="/static/player.js"></script>' in text


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
    assert '<div id="continue-watching" class="pt-5 bg-body-tertiary" hidden>' in r.text
    assert '<script src="/static/progress.js"></script>' in r.text
    assert 'addEventListener("pageshow", showContinueWatching)' in r.text
