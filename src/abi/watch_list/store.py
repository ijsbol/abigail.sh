import json
import os
import sqlite3
from pathlib import Path
from threading import Lock
from time import time
from typing import Final



DB_PATH: Final[Path] = Path(os.environ.get("WATCH_LIST_DB_PATH", "data/watch_list.sqlite"))
STORE_KEY: Final[str] = "watch-list:data"


_db: sqlite3.Connection | None = None
_lock = Lock()


def _db_conn() -> sqlite3.Connection:
    global _db
    with _lock:
        if _db is not None:
            return _db
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS kv (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """)
        conn.commit()
        _db = conn
        return _db


DEFAULT_SITE: Final[dict[str, str]] = {
    "siteName": "watch list",
    "aboutText": "an ever-growing list of things i want to (or already did) watch.",
}

PIN_TAG: Final[str] = "#pin"
CONFIG_PREFIX: Final[str] = "#config"


def _clean_notes(notes: str | None) -> tuple[str | None, bool]:
    if not notes:
        return None, False
    is_pinned = PIN_TAG in notes
    stripped = notes.replace(PIN_TAG, "").strip()
    return stripped or None, is_pinned


def parse_reminders(raw: list[dict]) -> dict:
    site = dict(DEFAULT_SITE)
    categories: list[dict] = []
    leftovers: list[dict] = []

    for reminder in raw:
        title = (reminder.get("title") or "").strip()
        if not title.startswith(CONFIG_PREFIX):
            leftovers.append(reminder)
            continue
        if "[category]" in title:
            info = title.split("[category]", 1)[1].strip()
            parts = info.split("::", 1)
            name = parts[0].strip()
            description = parts[1].strip() if len(parts) > 1 else ""
            if name:
                categories.append({"name": name, "description": description})
        elif "[site:name]" in title:
            value = title.split("[site:name]", 1)[1].strip()
            if value:
                site["siteName"] = value
        elif "[site:about]" in title:
            value = title.split("[site:about]", 1)[1].strip()
            if value:
                site["aboutText"] = value

    groups = [{"category": c, "items": []} for c in categories]

    for reminder in leftovers:
        title = (reminder.get("title") or "").strip()
        for group in groups:
            prefix = f"{group['category']['name']}:"
            if not title.startswith(prefix):
                continue
            text = title[len(prefix):].strip()
            if not text:
                break
            notes, is_pinned = _clean_notes(reminder.get("notes"))
            group["items"].append({
                "title": text,
                "notes": notes,
                "isCompleted": bool(reminder.get("isCompleted")),
                "isPinned": is_pinned,
            })
            break

    reminders = [g for g in groups if g["items"]]
    return {"reminders": reminders, "site": site, "updatedAt": int(time())}


def load_watch_list() -> dict | None:
    try:
        row = _db_conn().execute(
            "SELECT value FROM kv WHERE key = ?", (STORE_KEY,)
        ).fetchone()
        if not row:
            return None
        return json.loads(row["value"])
    except Exception:
        return None


def store_watch_list(data: dict) -> None:
    now = int(time())
    _db_conn().execute(
        "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)",
        (STORE_KEY, json.dumps(data), now),
    )
    _db_conn().commit()
