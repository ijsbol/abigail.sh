import asyncio
import json
import os
import sqlite3
import threading
import time
from typing import Any, Callable, Final


DB_PATH: Final[str] = "data/cache.sqlite"


_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        os.makedirs("data", exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.execute("PRAGMA journal_mode = WAL")
        _conn.execute("PRAGMA synchronous = NORMAL")
        _conn.execute("""
            CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                value BLOB NOT NULL,
                content_type TEXT,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )
        """)
        _conn.execute("CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at)")
        _conn.commit()
    return _conn


def _now() -> int:
    return int(time.time())


def _cache_get(key: str) -> tuple[bytes, str | None, int] | None:
    with _lock:
        conn = _get_conn()
        row = conn.execute(
            "SELECT value, content_type, expires_at, created_at FROM cache WHERE key = ?",
            (key,),
        ).fetchone()
        if row is None:
            return None
        value, content_type, expires_at, created_at = row
        if expires_at <= _now():
            conn.execute("DELETE FROM cache WHERE key = ?", (key,))
            conn.commit()
            return None
        return bytes(value), content_type, created_at


def _cache_set(key: str, value: bytes, ttl: int, content_type: str | None = None) -> int:
    with _lock:
        conn = _get_conn()
        n = _now()
        conn.execute(
            "INSERT OR REPLACE INTO cache (key, value, content_type, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
            (key, value, content_type, n + ttl, n),
        )
        conn.commit()
        return n


async def cache_json_get_or_fetch(
    key: str,
    ttl: int,
    fetcher: Callable,
) -> tuple[Any, int]:
    hit = await asyncio.to_thread(_cache_get, key)
    if hit is not None:
        raw, _, fetched_at = hit
        return json.loads(raw.decode("utf-8")), fetched_at
    fresh = await fetcher()
    fetched_at = await asyncio.to_thread(
        _cache_set,
        key,
        json.dumps(fresh).encode("utf-8"),
        ttl,
        "application/json",
    )
    return fresh, fetched_at


async def cache_bytes_get_or_fetch(
    key: str,
    ttl: int,
    fetcher: Callable,
) -> tuple[bytes, str, int] | None:
    hit = await asyncio.to_thread(_cache_get, key)
    if hit is not None:
        value, content_type, fetched_at = hit
        return value, content_type or "application/octet-stream", fetched_at
    result = await fetcher()
    if result is None:
        return None
    content, content_type = result
    fetched_at = await asyncio.to_thread(_cache_set, key, content, ttl, content_type)
    return content, content_type, fetched_at
