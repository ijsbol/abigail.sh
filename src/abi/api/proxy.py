import base64
from http import HTTPStatus
import json
from typing import Final
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Response

from abi.api.cache import cache_bytes_get_or_fetch


router = APIRouter()


def _load_friend_button_hosts() -> set[str]:
    try:
        with open("src/abi/data/friend-buttons.json") as f:
            data = json.load(f)
        return {urlparse(url).netloc for url in data if urlparse(url).netloc}
    except Exception:
        return set()


FRIEND_BUTTON_HOSTS: Final[set[str]] = _load_friend_button_hosts()
PROXY_CACHE_SECONDS: Final[int] = 7 * 24 * 60 * 60
PROXIED_HOSTS: Final[set[str]] = {
    "cdn.discordapp.com",
    "media.discordapp.net",
    "dcdn.dstn.to",
    "s4.anilist.co",
    "i.scdn.co",
    "lastfm.freetls.fastly.net",
    "cdn.bsky.app",
    "video.bsky.app",
} | FRIEND_BUTTON_HOSTS


def is_proxiable(url: str) -> bool:
    try:
        u = urlparse(url)
        return u.scheme == "https" and u.netloc in PROXIED_HOSTS
    except Exception:
        return False


def encode_media_hash(url: str) -> str:
    return base64.urlsafe_b64encode(url.encode("utf-8")).rstrip(b"=").decode("ascii")


def decode_media_hash(hash: str) -> str | None:
    try:
        pad = 4 - len(hash) % 4
        if pad != 4:
            hash += "=" * pad
        return base64.urlsafe_b64decode(hash).decode("utf-8")
    except Exception:
        return None


def media_proxy_url(url: str | None) -> str | None:
    if not url:
        return None
    if not is_proxiable(url):
        return url
    return f"/api/media-proxy/{encode_media_hash(url)}"


@router.get("/api/media-proxy/{hash}")
async def api_media_proxy(hash: str) -> Response:
    target = decode_media_hash(hash)
    if not target or not is_proxiable(target):
        return Response(
            content="invalid or disallowed url",
            status_code=HTTPStatus.BAD_REQUEST,
        )

    async def fetch():
        async with httpx.AsyncClient() as client:
            resp = await client.get(target, timeout=15, follow_redirects=True)
            if not resp.is_success:
                return None
            return resp.content, resp.headers.get("content-type", "application/octet-stream")

    result = await cache_bytes_get_or_fetch(f"media:{hash}", PROXY_CACHE_SECONDS, fetch)
    if result is None:
        return Response(
            status_code=HTTPStatus.BAD_GATEWAY,
            content="failed to fetch media",
        )

    content, content_type, _ = result
    return Response(
        content=content,
        media_type=content_type,
        headers={"Cache-Control": f"public, max-age={PROXY_CACHE_SECONDS}, s-maxage={PROXY_CACHE_SECONDS}, stale-while-revalidate=86400"},
    )
