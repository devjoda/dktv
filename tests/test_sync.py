import json

import pytest

from drtvrss import sync


@pytest.fixture(autouse=True)
def database(tmp_path, monkeypatch):
    monkeypatch.setenv("SYNC_DB", str(tmp_path / "sync.sqlite3"))


def progress(time, updated, **extra):
    return {"time": time, "duration": 3600, "watched": False, "updated": updated,
            "title": "1. episode", "url": "/show_1/ep_1", **extra}


def test_codes():
    code = sync.new_code()
    assert len(code) == 16
    assert sync.normalize_code(code) == code
    assert sync.normalize_code("-".join([code[0:4], code[4:8], code[8:12], code[12:]]).lower()) == code
    assert sync.normalize_code("ABCD") is None
    # Not in codes, since they're mixed up with 1 and 0
    assert sync.normalize_code("IIIIOOOOIIIIOOOO") is None


def test_newest_progress_wins():
    a = sync.clean({"progress": {"1": progress(100, 1000), "2": progress(50, 3000)}})
    b = sync.clean({"progress": {"1": progress(900, 2000), "2": progress(10, 2000), "3": progress(5, 1)}})
    merged = sync.merge(a, b)["progress"]
    assert merged["1"]["time"] == 900
    assert merged["2"]["time"] == 50
    assert merged["3"]["time"] == 5


def test_newest_of_adding_or_removing_a_favourite_wins():
    phone = sync.clean({"favorites": [{"id": "matador_1", "title": "Matador", "added": 100}]})
    laptop = sync.clean({"removed_favorites": {"matador_1": 200},
                         "favorites": [{"id": "rejseholdet_2", "title": "Rejseholdet", "added": 50}]})
    merged = sync.merge(phone, laptop)
    assert [f["id"] for f in merged["favorites"]] == ["rejseholdet_2"]
    assert merged["removed_favorites"] == {"matador_1": 200}
    # And made a favourite again, later
    again = sync.clean({"favorites": [{"id": "matador_1", "title": "Matador", "added": 300}]})
    merged = sync.merge(merged, again)
    assert [f["id"] for f in merged["favorites"]] == ["matador_1", "rejseholdet_2"]
    assert merged["removed_favorites"] == {}


def test_favourite_films_stay_films():
    cleaned = sync.clean({"favorites": [{"id": "film_1", "kind": "film", "added": 1}, {"id": "show_2", "added": 2}, {"id": "x_3", "kind": "other", "added": 3}]})
    assert [f["kind"] for f in cleaned["favorites"]] == ["film", "show", "show"]


def test_what_devices_send_is_checked():
    cleaned = sync.clean({
        "favorites": [{"id": "../../etc", "title": "x", "added": 1}, {"id": "matador_1", "image": "javascript:alert(1)", "added": 1}],
        "removed_favorites": {"ok_1": "yesterday", "ok_2": 5},
        "progress": {
            "123": progress(10, 5, url="javascript:alert(1)", image="http://example.com/x.jpg"),
            "456": progress(10, 5, url="//evil.example/"),
            "not-an-id": progress(1, 1),
            "789": {"time": "soon"},
        },
        "other": "ignored",
    })
    assert [f["id"] for f in cleaned["favorites"]] == ["matador_1"]
    assert cleaned["favorites"][0]["image"] is None
    assert cleaned["removed_favorites"] == {"ok_2": 5}
    assert sorted(cleaned["progress"]) == ["123", "456"]
    assert cleaned["progress"]["123"]["url"] is None
    assert cleaned["progress"]["123"]["image"] is None
    assert cleaned["progress"]["456"]["url"] is None
    with pytest.raises(ValueError):
        sync.clean(["not", "an", "object"])


def test_syncing_between_two_devices(get, post, delete):
    r = post("/sync/")
    assert r.status_code == 201
    code = json.loads(r.text)["code"]

    phone = {"favorites": [{"id": "matador_540736", "title": "Matador", "added": 100}],
             "progress": {"503615": progress(600, 1000)}}
    r = post(f"/sync/{code}", phone)
    assert r.status_code == 200
    assert json.loads(r.text)["favorites"][0]["id"] == "matador_540736"

    # The code can be typed with dashes and in lower case
    typed = "-".join([code[0:4], code[4:8], code[8:12], code[12:]]).lower()
    laptop = {"progress": {"503615": progress(1200, 2000), "503640": progress(30, 1500)}}
    merged = json.loads(post(f"/sync/{typed}", laptop).text)
    assert [f["id"] for f in merged["favorites"]] == ["matador_540736"]
    assert merged["progress"]["503615"]["time"] == 1200
    assert set(merged["progress"]) == {"503615", "503640"}

    assert delete(f"/sync/{code}").status_code == 204
    assert post(f"/sync/{code}", phone).status_code == 404


def test_unknown_codes_and_bad_data(post):
    assert post("/sync/ABCD-EFGH-JKMN-PQRS", {}).status_code == 404
    assert post("/sync/not-a-code", {}).status_code == 404
    code = json.loads(post("/sync/").text)["code"]
    assert post(f"/sync/{code}", "not json", content_type="text/plain").status_code == 400
    assert post(f"/sync/{code}", [1, 2]).status_code == 400


def test_without_storage(post, monkeypatch, tmp_path):
    monkeypatch.setenv("SYNC_DB", str(tmp_path / "no" / "such" / "folder" / "sync.sqlite3"))
    r = post("/sync/")
    assert r.status_code == 503
    assert "Prøv igen senere" in json.loads(r.text)["error"]


def test_sync_page(get):
    r = get("/sync/")
    assert r.status_code == 200
    assert 'id="sync-page"' in r.text
    assert "Opret en kode" in r.text
    assert '<a href="/sync/">' in get("/").text
