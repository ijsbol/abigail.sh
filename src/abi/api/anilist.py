from typing import TypedDict
from typing_extensions import Final

import httpx

ANILIST_USERNAME: Final[str] = "scrumpy"
ANILIST_API: Final[str] = "https://graphql.anilist.co"

PROFILE_QUERY: Final[str] = """
query ($name: String!) {
  User(name: $name) {
    id name siteUrl
    avatar { large medium }
    bannerImage
    about(asHtml: false)
    statistics { anime { count episodesWatched minutesWatched meanScore } }
  }
}
"""

WATCH_HISTORY_QUERY: Final[str] = """
query ($name: String!, $perPage: Int!) {
  Page(perPage: $perPage) {
    mediaList(userName: $name, type: ANIME, sort: UPDATED_TIME_DESC) {
      status score progress updatedAt
      media {
        id siteUrl
        title { romaji english native }
        coverImage { large color }
        episodes format averageScore
      }
    }
  }
}
"""


class AnimeStats(TypedDict):
    count: int
    episodesWatched: int
    minutesWatched: int
    meanScore: float


class AnilistProfile(TypedDict):
    id: int
    name: str
    siteUrl: str
    avatar: str | None
    bannerImage: str | None
    about: str | None
    anime: AnimeStats


class MediaTitle(TypedDict):
    romaji: str | None
    english: str | None
    native: str | None


class WatchHistoryMedia(TypedDict):
    id: int
    siteUrl: str
    title: MediaTitle
    coverImage: str | None
    coverColor: str | None
    episodes: int | None
    format: str | None
    averageScore: int | None


class WatchHistoryEntry(TypedDict):
    status: str
    score: float | None
    progress: int
    updatedAt: int
    media: WatchHistoryMedia


async def _graph_ql_query(query: str, variables: dict) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url=ANILIST_API,
            json={
                "query": query,
                "variables": variables,
            },
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=15,
        )
    data = resp.json()
    if data.get("errors"):
        raise ValueError("; ".join(e["message"] for e in data["errors"]))
    if not resp.is_success:
        raise ValueError(f"AniList request failed with status {resp.status_code}")
    if not data.get("data"):
        raise ValueError("AniList response missing data")
    return data["data"]


async def fetch_profile() -> AnilistProfile:
    data = await _graph_ql_query(PROFILE_QUERY, {"name": ANILIST_USERNAME})
    u = data["User"]
    avatar = u.get("avatar") or {}
    return AnilistProfile(
        id=u["id"],
        name=u["name"],
        siteUrl=u["siteUrl"],
        avatar=avatar.get("large") or avatar.get("medium"),
        bannerImage=u.get("bannerImage"),
        about=u.get("about"),
        anime=u["statistics"]["anime"],
    )


async def fetch_watch_history(per_page: int = 36) -> list[WatchHistoryEntry]:
    data = await _graph_ql_query(
        query=WATCH_HISTORY_QUERY,
        variables={
            "name": ANILIST_USERNAME,
            "perPage": per_page,
        },
    )
    entries: list[WatchHistoryEntry] = []
    for e in data["Page"]["mediaList"]:
        cover = e["media"].get("coverImage") or {}
        entries.append(WatchHistoryEntry(
            status=e["status"],
            score=e.get("score"),
            progress=e["progress"],
            updatedAt=e["updatedAt"],
            media=WatchHistoryMedia(
                id=e["media"]["id"],
                siteUrl=e["media"]["siteUrl"],
                title=e["media"]["title"],
                coverImage=cover.get("large"),
                coverColor=cover.get("color"),
                episodes=e["media"].get("episodes"),
                format=e["media"].get("format"),
                averageScore=e["media"].get("averageScore"),
            ),
        ))
    return entries
