"""Renders every page against the fixtures, to catch template breakage"""

import xml.etree.ElementTree as ET


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


def test_shows_are_listed_on_index_once_fetched(get):
    get("/rejseholdet_503605/")
    assert 'href="rejseholdet_503605"' in get("/").text


def test_unknown_show(get):
    assert get("/findes-ikke_1/").status_code == 404
    assert get("/ikke-et-tal/").status_code == 404


def test_episode(get):
    r = get("/rejseholdet_503605/rejseholdet_503615")
    assert r.status_code == 200
    assert "Rejseholdet</a> - 1. episode" in r.text
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


def test_live_channel(get):
    r = get("/live/DR1")
    assert r.status_code == 200
    assert "https://drlivedr1hls.akamaized.net/" in r.text


def test_unknown_live_channel(get):
    assert get("/live/DR9").status_code == 404


def test_search(get):
    r = get("/search/?query=matador")
    assert r.status_code == 200
    assert 'href="/matador_540736/"' in r.text
    assert 'href="/program/lise-noergaard_-ikke-kun-en-pige_362031"' in r.text


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
        assert "hls.js@latest" not in text
        assert '<script src="https://cdn.jsdelivr.net/npm/hls.js@1.7.3/' in text
        assert '<script src="/static/player.js"></script>' in text
