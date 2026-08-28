import json
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from time import time
from typing import Final


DB_PATH: Final[Path] = Path(os.environ.get("BLOG_DB_PATH", "data/blog.sqlite"))


_db: sqlite3.Connection | None = None
_lock = Lock()


@dataclass
class BlogPost:
    slug: str
    title: str
    description: str
    content: str
    kind: str
    tags: list[str]
    date: str
    sort_date: str
    duration: str
    og_image: str | None
    unlisted: bool
    published: bool
    created_at: int
    updated_at: int


@dataclass
class BlogInput:
    slug: str
    title: str
    description: str
    content: str
    kind: str
    tags: list[str]
    date: str
    sort_date: str
    duration: str
    og_image: str | None
    unlisted: bool
    published: bool


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
            CREATE TABLE IF NOT EXISTS blog (
                slug TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                content TEXT NOT NULL,
                kind TEXT NOT NULL,
                tags TEXT NOT NULL,
                date TEXT NOT NULL,
                sort_date TEXT NOT NULL,
                duration TEXT NOT NULL,
                og_image TEXT,
                unlisted INTEGER NOT NULL DEFAULT 0,
                published INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_blog_sort ON blog(sort_date)")
        conn.commit()
        _db = conn
        return _db


def _row_to_post(row: sqlite3.Row) -> BlogPost:
    try:
        parsed = json.loads(row["tags"])
        tags = [t for t in parsed if isinstance(t, str)] if isinstance(parsed, list) else []
    except Exception:
        tags = []
    return BlogPost(
        slug=row["slug"],
        title=row["title"],
        description=row["description"],
        content=row["content"],
        kind="writing" if row["kind"] == "writing" else "note",
        tags=tags,
        date=row["date"],
        sort_date=row["sort_date"],
        duration=row["duration"],
        og_image=row["og_image"],
        unlisted=bool(row["unlisted"]),
        published=bool(row["published"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _now() -> int:
    return int(time())


def list_posts(
    include_unlisted: bool = False,
    include_drafts: bool = False,
) -> list[BlogPost]:
    rows = _db_conn().execute(
        "SELECT * FROM blog ORDER BY sort_date DESC, created_at DESC"
    ).fetchall()
    posts = [_row_to_post(r) for r in rows]
    if not include_drafts:
        posts = [p for p in posts if p.published]
    if not include_unlisted:
        posts = [p for p in posts if not p.unlisted]
    return posts


def get_post(slug: str) -> BlogPost | None:
    row = _db_conn().execute("SELECT * FROM blog WHERE slug = ?", (slug,)).fetchone()
    return _row_to_post(row) if row else None


def slug_exists(slug: str) -> bool:
    row = _db_conn().execute("SELECT 1 FROM blog WHERE slug = ?", (slug,)).fetchone()
    return row is not None


def create_post(inp: BlogInput) -> BlogPost:
    n = _now()
    _db_conn().execute(
        """
        INSERT INTO blog (
            slug, title, description, content, kind, tags, date, sort_date,
            duration, og_image, unlisted, published, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            inp.slug, inp.title, inp.description, inp.content, inp.kind,
            json.dumps(inp.tags), inp.date, inp.sort_date, inp.duration,
            inp.og_image, 1 if inp.unlisted else 0, 1 if inp.published else 0,
            n, n,
        ),
    )
    _db_conn().commit()
    return get_post(inp.slug)  # type: ignore[return-value]


def update_post(slug: str, inp: BlogInput) -> BlogPost | None:
    if not slug_exists(slug):
        return None
    n = _now()
    _db_conn().execute(
        """
        UPDATE blog SET
            title = ?, description = ?, content = ?, kind = ?, tags = ?,
            date = ?, sort_date = ?, duration = ?, og_image = ?,
            unlisted = ?, published = ?, updated_at = ?
        WHERE slug = ?
        """,
        (
            inp.title, inp.description, inp.content, inp.kind,
            json.dumps(inp.tags), inp.date, inp.sort_date, inp.duration,
            inp.og_image, 1 if inp.unlisted else 0, 1 if inp.published else 0,
            n, slug,
        ),
    )
    _db_conn().commit()
    return get_post(slug)


def delete_post(slug: str) -> bool:
    cur = _db_conn().execute("DELETE FROM blog WHERE slug = ?", (slug,))
    _db_conn().commit()
    return cur.rowcount > 0
