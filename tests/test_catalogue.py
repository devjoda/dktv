"""The catalogue: DR's list from A to Å, gone through with each title's own item looked up, from the fixtures of three of
its letters, and what the browser gets of it, the same as the Worker's catalogue.ts makes"""

import asyncio
import json

from drtvrss import catalogue

from .conftest import load


def fill():
    """Goes through the fixtures' letters, and looks up every title that's due, as the app does by itself"""
    async def run():
        await catalogue.sweep()
        for title in sorted(catalogue.catalogue.titles.values(), key=lambda t: t["due"]):
            if title["due"] != float("inf"):
                await catalogue.look_up(title)

    asyncio.run(run())


def test_the_entries_are_the_same_as_the_worker_makes():
    items = [catalogue.kept_item(i) for letter in "lmr" for i in load(f"lists_348_{letter}.json")["items"]]
    details = {
        "362031": catalogue.programme_details(load("items_362031.json")),
        "619917": catalogue.programme_details(load("items_619917.json")),
        "540736": catalogue.series_details(load("items_540736.json"), load("items_540737.json")),
        "617585": catalogue.series_details(load("items_617585.json"), load("items_617586.json")),
        "503605": catalogue.series_details(load("items_503605.json"), load("items_503612.json")),
    }
    made = [catalogue.entry_of(item, details.get(item["id"]), ["Store danske serier"] if item["id"] == "540736" else None,
                               0 if item["id"] == "540736" else 1000)["entry"] for item in items]
    # As the Worker's tests wrote them
    assert made == load("catalogue_entries.json")


def test_names_after_the_labels_of_a_films_description():
    text = "Marie tager til Velling.\nMedvirkende: Sofie Torp, Thomas Hwan og Lotte Andersen m.fl.\nInstruktør: Hella Joof. Udløber: 20. okt 2026"
    assert catalogue.names_after(text, ["Medvirkende"]) == ["Sofie Torp", "Thomas Hwan", "Lotte Andersen"]
    assert catalogue.names_after(text, ["Instruktion", "Instruktør"]) == ["Hella Joof"]
    assert catalogue.proper_name("margrethe ii, dronning, danmark") == "Margrethe II, Dronning, Danmark"


def test_goes_through_drs_list_and_looks_up_each_title(fake_dr):
    fill()
    found = catalogue.catalogue_json()
    assert sorted(e["t"] for e in found["titles"]) == ["Lise Nørgaard: Ikke kun en pige", "Madame Ida", "Maria Wern", "Matador", "Rejseholdet"]
    assert any(f["id"] == "genre" for f in found["facets"])
    # Children's programmes and news aren't looked up, and Red Rock West, whose item DR doesn't have, is gone
    assert "/items/296793" not in fake_dr and "/items/584100" not in fake_dr
    assert catalogue.catalogue.titles["595127"]["missing"] is not None
    matador = next(e for e in found["titles"] if e["t"] == "Matador")
    assert (matador["y"], matador["e"], matador["f"]["land"]) == (1978, 24, ["danmark"])


def test_katalog_json_alle_titler_and_the_categories_lead_to_it(get):
    fill()
    r = get("/katalog.json")
    assert r.status_code == 200
    assert len(json.loads(r.text)["titles"]) == 5
    assert get("/katalog.json", headers={"If-None-Match": r.headers["ETag"]}).status_code == 304
    page = get("/alle/").text
    assert 'class="explore wrap js-explore"' in page and "/static/explore.js?v=" in page
    assert '<a class="pick-promo wrap" href="/alle/">' in get("/kategorier/").text
    assert '<a class="button button-secondary" href="/alle/?type=serie">' in get("/kategorier/fiktionsserier/").text
    assert json.loads(get("/status.json").text)["catalogue"]["titles"] == 5


def test_whats_gone_says_so_with_the_series_for_an_episode(get):
    gone = get("/program/red-rock-west_595127")
    assert gone.status_code == 404
    assert "<h1>Kan ikke længere ses</h1>" in gone.text
    assert 'class="shelf js-gone-suggestions" data-kind="program"' in gone.text
    episode = get("/rejseholdet_503605/rejseholdet_1")
    assert episode.status_code == 404
    assert 'href="/rejseholdet_503605/">Gå til Rejseholdet</a>' in episode.text


def test_the_front_page_has_rows_of_its_own_and_gets_the_rest_of_drs_later(get, monkeypatch):
    fill()
    rows = [{"id": "stemning", "title": "Store følelser", "more": "/alle/?stemning=foelelser", "entries": catalogue.catalogue.shown()}]
    monkeypatch.setattr(catalogue, "own_rows", lambda: rows)
    front = get("/").text
    assert '<section class="shelf" data-own-row="stemning" aria-labelledby="own-stemning">' in front
    assert 'href="/matador_540736/"' in front
    assert '<div class="more-rows js-more-rows" data-from="8" aria-hidden="true"></div>' in front
    later = get("/raekker/?fra=8")
    assert later.status_code == 200
    assert "<html" not in later.text


def test_the_front_pages_own_rows_need_enough_titles(fake_dr):
    fill()
    assert all(len(row["entries"]) >= 4 for row in catalogue.own_rows())


def test_when_dr_asks_to_be_asked_less_nothing_is_taken_to_be_gone(fake_dr, monkeypatch):
    fill()
    from drtvrss import drtv

    async def slow_down(path, /, **params):
        raise drtv.DRUnavailable("DR responded 429")

    monkeypatch.setattr(drtv, "get_api", slow_down)
    matador = catalogue.catalogue.titles["540736"]
    assert asyncio.run(catalogue.look_up(matador)) is False
    assert matador.get("missing") is None
    assert len(catalogue.catalogue_json()["titles"]) == 5
