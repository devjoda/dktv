"""Keeps viewers' favourites, and how far they got with each video, the same on
all their devices.

It's kept under a code the viewer makes on one device and types on the others.
Anyone with the code can read and change what's kept under it, so it's too long
to be guessed. Without a code, nothing about a viewer is kept here.

Each device sends everything it knows, and gets back that merged with what the
others sent: for each video, the newest progress wins, and for each show, the
newest of being made a favourite or not."""

from contextlib import closing
from typing import Optional
import json
import os
import re
import secrets
import sqlite3
from time import time

# Without I, O, 0 and 1, which are easily mixed up
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
# 80 bits
CODE_LENGTH = 16

MAX_PROGRESS = 2000
MAX_FAVORITES = 500

VIDEO_ID = re.compile(r"^\d{1,12}$")
SHOW_ID = re.compile(r"^[\w-]{1,200}$")


def database_path() -> str:
    """systemd's StateDirectory= sets STATE_DIRECTORY"""
    return os.getenv("SYNC_DB") or os.path.join(
        os.getenv("STATE_DIRECTORY", "."), "sync.sqlite3"
    )


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(database_path(), timeout=10, isolation_level=None)
    db.execute(
        "CREATE TABLE IF NOT EXISTS sync (code TEXT PRIMARY KEY, data TEXT NOT NULL, updated REAL NOT NULL)"
    )
    return db


def new_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))


def normalize_code(code: str) -> Optional[str]:
    """A code as the viewer typed it, like "abcd-efgh-jkmn-pqrs", or None if it can't be one"""
    code = "".join(c for c in code.upper() if c.isalnum())
    if len(code) == CODE_LENGTH and all(c in ALPHABET for c in code):
        return code
    return None


def empty() -> dict:
    return {"favorites": [], "removed_favorites": {}, "progress": {}}


def _number(value) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _text(value, limit: int = 500) -> Optional[str]:
    return value[:limit] if isinstance(value, str) else None


def _local_url(value) -> Optional[str]:
    """Only links within this site, so a code can't carry a javascript: link to another device"""
    if isinstance(value, str) and value.startswith("/") and not value.startswith("//"):
        return value[:500]
    return None


def _image_url(value) -> Optional[str]:
    if isinstance(value, str) and value.startswith("https://"):
        return value[:1000]
    return None


def clean(data) -> dict:
    """What a device sent, keeping only what looks like what progress.js and favorites.js keep"""
    if not isinstance(data, dict):
        raise ValueError("Expected an object")
    favorites = []
    for f in data.get("favorites", []) if isinstance(data.get("favorites"), list) else []:
        if isinstance(f, dict) and isinstance(f.get("id"), str) and SHOW_ID.match(f["id"]):
            favorites.append(
                {
                    "id": f["id"],
                    "kind": "film" if f.get("kind") == "film" else "show",
                    "title": _text(f.get("title")) or f["id"],
                    "image": _image_url(f.get("image")),
                    "added": _number(f.get("added")) or 0,
                }
            )
    removed = {}
    if isinstance(data.get("removed_favorites"), dict):
        for show_id, when in data["removed_favorites"].items():
            if SHOW_ID.match(show_id) and _number(when) is not None:
                removed[show_id] = _number(when)
    progress = {}
    if isinstance(data.get("progress"), dict):
        for video_id, p in data["progress"].items():
            if not (VIDEO_ID.match(video_id) and isinstance(p, dict)):
                continue
            if _number(p.get("time")) is None:
                continue
            progress[video_id] = {
                "time": _number(p.get("time")),
                "duration": _number(p.get("duration")),
                "watched": p.get("watched") is True,
                "dismissed": p.get("dismissed") is True,
                "title": _text(p.get("title")),
                "show": _text(p.get("show")),
                "url": _local_url(p.get("url")),
                "image": _image_url(p.get("image")),
                # When the video leaves DR
                "expires": _number(p.get("expires")),
                "updated": _number(p.get("updated")) or 0,
            }
    return {"favorites": favorites, "removed_favorites": removed, "progress": progress}


def merge(a: dict, b: dict) -> dict:
    progress = dict(a["progress"])
    for video_id, p in b["progress"].items():
        if video_id not in progress or p["updated"] > progress[video_id]["updated"]:
            progress[video_id] = p
    if len(progress) > MAX_PROGRESS:
        newest = sorted(progress.items(), key=lambda kv: kv[1]["updated"], reverse=True)
        progress = dict(newest[:MAX_PROGRESS])

    # The newest thing that happened to each show: made a favourite, or not
    latest: dict[str, tuple[float, Optional[dict]]] = {}
    for data in (a, b):
        for f in data["favorites"]:
            if f["id"] not in latest or f["added"] > latest[f["id"]][0]:
                latest[f["id"]] = (f["added"], f)
        for show_id, when in data["removed_favorites"].items():
            if show_id not in latest or when > latest[show_id][0]:
                latest[show_id] = (when, None)
    favorites = sorted(
        (f for _, f in latest.values() if f is not None), key=lambda f: f["added"], reverse=True
    )[:MAX_FAVORITES]
    removed = {show_id: when for show_id, (when, f) in latest.items() if f is None}
    return {"favorites": favorites, "removed_favorites": removed, "progress": progress}


def create() -> str:
    with closing(connect()) as db:
        code = new_code()
        db.execute(
            "INSERT INTO sync (code, data, updated) VALUES (?, ?, ?)",
            (code, json.dumps(empty()), time()),
        )
        return code


def sync(code: str, data: dict) -> Optional[dict]:
    """Merges what a device sent with what's kept under the code, and keeps the result.
    None if there's nothing under the code."""
    with closing(connect()) as db:
        # So two devices syncing at once don't lose each other's changes
        db.execute("BEGIN IMMEDIATE")
        try:
            merged = None
            row = db.execute("SELECT data FROM sync WHERE code = ?", (code,)).fetchone()
            if row is not None:
                merged = merge(clean(json.loads(row[0])), clean(data))
                db.execute(
                    "UPDATE sync SET data = ?, updated = ? WHERE code = ?",
                    (json.dumps(merged), time(), code),
                )
        except BaseException:
            db.execute("ROLLBACK")
            raise
        db.execute("COMMIT")
        return merged


def delete(code: str) -> None:
    with closing(connect()) as db:
        db.execute("DELETE FROM sync WHERE code = ?", (code,))
