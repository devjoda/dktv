import asyncio
from datetime import datetime, timedelta, timezone

from drtvrss import drtv, live
from drtvrss.live import Programme, whats_on

AT = datetime(2026, 10, 12, 11, 50, tzinfo=timezone.utc)


def programme(start_minutes: int, end_minutes: int, title="Program") -> Programme:
    return Programme(title, AT + timedelta(minutes=start_minutes), AT + timedelta(minutes=end_minutes))


def test_whats_on():
    earlier = programme(-60, -10, "Før")
    current = programme(-10, 20, "Nu")
    later = programme(20, 50, "Derefter")
    assert whats_on([earlier, current, later], AT) == (current, [later])
    # Between programmes, nothing's on
    assert whats_on([earlier, later], AT) == (None, [later])
    assert whats_on([], AT) == (None, [])


def test_percent_done():
    p = programme(-10, 30)
    assert p.percent_done(AT) == 25
    assert p.percent_done(AT - timedelta(hours=1)) == 0
    assert p.percent_done(AT + timedelta(hours=1)) == 100


def test_get_schedules(fake_dr):
    schedules = asyncio.run(live.get_schedules())
    dr1 = schedules["20875"]
    assert dr1[0].title == "Hammerslag 2022 - Lejlighed i storbyen"
    assert dr1[0].start == datetime(2026, 10, 12, 11, 40, tzinfo=timezone.utc)
    assert dr1[0].end > dr1[0].start
    assert dr1[0].image.startswith("https://")
    assert any(r.startswith("/schedules?") for r in fake_dr)
    # Cached
    fake_dr.clear()
    assert asyncio.run(live.get_schedules()) is schedules
    assert not [r for r in fake_dr if r.startswith("/schedules")]


def test_schedules_are_only_extra(fake_dr, monkeypatch):
    async def get_api(path, **params):
        if path == "/schedules":
            raise drtv.DRUnavailable("DR responded 503")
        return {"items": []}

    monkeypatch.setattr(live, "get_api", get_api)
    assert asyncio.run(live.get_schedules()) == {}
