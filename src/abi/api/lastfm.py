from http import HTTPStatus
import json
import os
from typing import TypedDict
from typing_extensions import Final

import httpx
from fastapi import APIRouter, Response
from dotenv import load_dotenv

from abi.api.cache import cache_json_get_or_fetch


router = APIRouter()


load_dotenv()


LASTFM_REVALIDATE: Final[int] = 30
LASTFM_FETCH_LIMIT: Final[int] = 200
LASTFM_API_KEY: Final[str] = str(os.environ.get("LASTFM_API_KEY"))
LASTFM_USERNAME: Final[str] = "uwugal"
LASTFM_API_BASE: Final[str] = "https://ws.audioscrobbler.com/2.0/"
IMAGE_PREFERENCE: Final[list[str]] = ["extralarge", "large", "medium", "small"]


class Track(TypedDict):
    artist: str
    album: str
    name: str
    url: str
    image: str | None
    playedAt: int | None
    nowPlaying: bool


def _pick_image(images: list) -> str | None:
    if not images:
        return None
    for size in IMAGE_PREFERENCE:
        for img in images:
            if img.get("size") == size and img.get("#text"):
                return img["#text"]
    for img in images:
        if img.get("#text"):
            return img["#text"]
    return None


def _normalize(track: dict) -> Track:
    return Track(
        artist=track["artist"]["#text"],
        album=track["album"]["#text"],
        name=track["name"],
        url=track["url"],
        image=_pick_image(track.get("image", [])),
        playedAt=int(track["date"]["uts"]) if track.get("date") else None,
        nowPlaying=track.get("@attr", {}).get("nowplaying") == "true",
    )


async def fetch_recent_tracks(limit: int = 200) -> list[Track]:
    params = {
        "method": "user.getRecentTracks",
        "user": LASTFM_USERNAME,
        "api_key": LASTFM_API_KEY,
        "format": "json",
        "limit": str(limit),
    }
    async with httpx.AsyncClient() as client:
        resp = await client.get(LASTFM_API_BASE, params=params, timeout=10)
        resp.raise_for_status()
    data = resp.json()
    raw = (data.get("recenttracks") or {}).get("track", [])
    if isinstance(raw, dict):
        raw = [raw]
    return [_normalize(t) for t in raw]


@router.get("/api/last-fm/listening-history")
async def api_listening_history() -> Response:
    try:
        tracks, fetched_at = await cache_json_get_or_fetch(
            key=f"lastfm:recent:{LASTFM_FETCH_LIMIT}",
            ttl=LASTFM_REVALIDATE,
            fetcher=lambda: fetch_recent_tracks(LASTFM_FETCH_LIMIT),
        )
        return Response(
            content=json.dumps({"tracks": tracks, "cachedAt": fetched_at}),
            media_type="application/json",
        )
    except Exception as e:
        return Response(
            content=json.dumps({"error": "lastfm_failed", "message": str(e)}),
            media_type="application/json",
            status_code=HTTPStatus.BAD_GATEWAY,
        )
