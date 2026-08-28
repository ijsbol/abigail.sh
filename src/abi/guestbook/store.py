import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from time import time
from typing import Final


DB_PATH: Final[Path] = Path(os.environ.get("GUESTBOOK_DB_PATH", "data/guestbook.sqlite"))
CANVAS_SIZE: Final[int] = 64
PIXEL_COUNT: Final[int] = CANVAS_SIZE * CANVAS_SIZE


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
            CREATE TABLE IF NOT EXISTS guestbook_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                discord_user_id TEXT NOT NULL UNIQUE,
                username TEXT NOT NULL,
                display_name TEXT NOT NULL,
                pixels TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_guestbook_created ON guestbook_entries(created_at)"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS guestbook_bans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                discord_user_id TEXT NOT NULL UNIQUE,
                username TEXT NOT NULL,
                display_name TEXT NOT NULL,
                banned_at INTEGER NOT NULL,
                banned_by_admin_id TEXT NOT NULL
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_guestbook_banned_at ON guestbook_bans(banned_at)"
        )
        conn.commit()
        _db = conn
        return _db


@dataclass
class GuestbookEntry:
    id: int
    username: str
    display_name: str
    pixels: str
    created_at: int
    updated_at: int

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "displayName": self.display_name,
            "pixels": self.pixels,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }


@dataclass
class GuestbookBan:
    id: int
    entry_id: int | None
    username: str
    display_name: str
    banned_at: int

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "entryId": self.entry_id,
            "username": self.username,
            "displayName": self.display_name,
            "bannedAt": self.banned_at,
        }


def _row_to_entry(row: sqlite3.Row) -> GuestbookEntry:
    return GuestbookEntry(
        id=row["id"],
        username=row["username"],
        display_name=row["display_name"],
        pixels=row["pixels"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def validate_pixels(pixels: object) -> str | None:
    if not isinstance(pixels, list) or len(pixels) != PIXEL_COUNT:
        return None
    encoded = "".join(format(int(p), "x") for p in pixels if isinstance(p, int) and 0 <= p <= 15)
    if len(encoded) != PIXEL_COUNT:
        return None
    return encoded


def list_entries() -> list[GuestbookEntry]:
    rows = _db_conn().execute(
        "SELECT id, username, display_name, pixels, created_at, updated_at "
        "FROM guestbook_entries ORDER BY created_at ASC, id ASC"
    ).fetchall()
    return [_row_to_entry(r) for r in rows]


def get_entry_for_user(discord_user_id: str) -> GuestbookEntry | None:
    row = _db_conn().execute(
        "SELECT id, username, display_name, pixels, created_at, updated_at "
        "FROM guestbook_entries WHERE discord_user_id = ?",
        (discord_user_id,),
    ).fetchone()
    return _row_to_entry(row) if row else None


def get_entry_by_id(entry_id: int) -> GuestbookEntry | None:
    row = _db_conn().execute(
        "SELECT id, username, display_name, pixels, created_at, updated_at "
        "FROM guestbook_entries WHERE id = ?",
        (entry_id,),
    ).fetchone()
    return _row_to_entry(row) if row else None


def get_entry_owner(entry_id: int) -> dict | None:
    row = _db_conn().execute(
        "SELECT discord_user_id, username, display_name FROM guestbook_entries WHERE id = ?",
        (entry_id,),
    ).fetchone()
    if not row:
        return None
    return {"discord_user_id": row["discord_user_id"], "username": row["username"], "display_name": row["display_name"]}


def create_entry(discord_user_id: str, username: str, display_name: str, pixels: str) -> GuestbookEntry | None:
    now = int(time())
    cur = _db_conn().execute(
        """INSERT OR IGNORE INTO guestbook_entries
           (discord_user_id, username, display_name, pixels, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM guestbook_bans WHERE discord_user_id = ?)""",
        (discord_user_id, username, display_name, pixels, now, now, discord_user_id),
    )
    _db_conn().commit()
    if cur.rowcount == 0:
        return None
    return get_entry_for_user(discord_user_id)


def update_entry(discord_user_id: str, username: str, display_name: str, pixels: str) -> GuestbookEntry | None:
    now = int(time())
    cur = _db_conn().execute(
        """UPDATE guestbook_entries
           SET username = ?, display_name = ?, pixels = ?, updated_at = ?
           WHERE discord_user_id = ?
           AND NOT EXISTS (SELECT 1 FROM guestbook_bans WHERE discord_user_id = ?)""",
        (username, display_name, pixels, now, discord_user_id, discord_user_id),
    )
    _db_conn().commit()
    if cur.rowcount == 0:
        return None
    return get_entry_for_user(discord_user_id)


def update_entry_by_id(entry_id: int, pixels: str) -> GuestbookEntry | None:
    now = int(time())
    cur = _db_conn().execute(
        "UPDATE guestbook_entries SET pixels = ?, updated_at = ? WHERE id = ?",
        (pixels, now, entry_id),
    )
    _db_conn().commit()
    if cur.rowcount == 0:
        return None
    return get_entry_by_id(entry_id)


def delete_entry(discord_user_id: str) -> bool:
    cur = _db_conn().execute(
        "DELETE FROM guestbook_entries WHERE discord_user_id = ?",
        (discord_user_id,),
    )
    _db_conn().commit()
    return cur.rowcount > 0


def delete_entry_by_id(entry_id: int) -> bool:
    cur = _db_conn().execute(
        "DELETE FROM guestbook_entries WHERE id = ?", (entry_id,)
    )
    _db_conn().commit()
    return cur.rowcount > 0


def is_user_banned(discord_user_id: str) -> bool:
    row = _db_conn().execute(
        "SELECT 1 FROM guestbook_bans WHERE discord_user_id = ?",
        (discord_user_id,),
    ).fetchone()
    return row is not None


def list_bans() -> list[GuestbookBan]:
    rows = _db_conn().execute(
        """SELECT b.id, e.id AS entry_id, b.username, b.display_name, b.banned_at
           FROM guestbook_bans b
           LEFT JOIN guestbook_entries e ON e.discord_user_id = b.discord_user_id
           ORDER BY b.banned_at DESC, b.id DESC"""
    ).fetchall()
    return [GuestbookBan(
        id=r["id"],
        entry_id=r["entry_id"],
        username=r["username"],
        display_name=r["display_name"],
        banned_at=r["banned_at"],
    ) for r in rows]


def ban_by_entry(entry_id: int, banned_by_admin_id: str) -> GuestbookBan | None:
    owner = get_entry_owner(entry_id)
    if not owner:
        return None
    now = int(time())
    _db_conn().execute(
        """INSERT INTO guestbook_bans (discord_user_id, username, display_name, banned_at, banned_by_admin_id)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(discord_user_id) DO UPDATE SET
             username = excluded.username,
             display_name = excluded.display_name""",
        (owner["discord_user_id"], owner["username"], owner["display_name"], now, banned_by_admin_id),
    )
    _db_conn().commit()
    row = _db_conn().execute(
        """SELECT b.id, e.id AS entry_id, b.username, b.display_name, b.banned_at
           FROM guestbook_bans b
           LEFT JOIN guestbook_entries e ON e.discord_user_id = b.discord_user_id
           WHERE b.discord_user_id = ?""",
        (owner["discord_user_id"],),
    ).fetchone()
    if not row:
        return None
    return GuestbookBan(
        id=row["id"],
        entry_id=row["entry_id"],
        username=row["username"],
        display_name=row["display_name"],
        banned_at=row["banned_at"],
    )


def unban(ban_id: int) -> bool:
    cur = _db_conn().execute("DELETE FROM guestbook_bans WHERE id = ?", (ban_id,))
    _db_conn().commit()
    return cur.rowcount > 0
