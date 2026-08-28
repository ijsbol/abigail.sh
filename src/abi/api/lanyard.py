from http import HTTPStatus
import json
from typing import Final, TypedDict

import httpx
from fastapi import APIRouter, Response

from abi.api.cache import cache_json_get_or_fetch


router = APIRouter()


LANYARD_REVALIDATE: Final[int] = 30
LANYARD_USER_ID: Final[str] = "676867934504747008"
LANYARD_API: Final[str] = f"https://api.lanyard.rest/v1/users/{LANYARD_USER_ID}"
ACTIVITY_TYPE: Final[dict[str, int]] = {
    "GAME": 0,
    "STREAMING": 1,
    "LISTENING": 2,
    "WATCHING": 3,
    "CUSTOM": 4,
    "COMPETING": 5,
}


class Nameplate(TypedDict):
    asset: str
    label: str | None
    palette: str | None
    sku_id: str | None


class DiscordUser(TypedDict):
    id: str
    username: str
    global_name: str | None
    display_name: str | None
    avatar: str | None
    banner: str | None
    accent_color: int | None
    display_name_styles: dict | None
    avatar_decoration_data: dict | None
    primary_guild: dict | None
    nameplate: Nameplate | None


class LanyardData(TypedDict):
    user: DiscordUser
    status: str
    activities: list[dict]
    customStatus: dict | None
    spotify: dict | None
    listeningToSpotify: bool


def avatar_url(user: dict, size: int = 256) -> str | None:
    if not user.get("avatar"):
        return None
    ext = "gif" if user["avatar"].startswith("a_") else "png"
    return f"https://cdn.discordapp.com/avatars/{user['id']}/{user['avatar']}.{ext}?size={size}"


def avatar_decoration_url(user: dict) -> str | None:
    asset = (user.get("avatar_decoration_data") or {}).get("asset")
    if not asset:
        return None
    return f"https://cdn.discordapp.com/avatar-decoration-presets/{asset}.png?size=256&passthrough=true"


def banner_url(user: dict, size: int = 600) -> str | None:
    if not user.get("banner"):
        return None
    ext = "gif" if user["banner"].startswith("a_") else "png"
    return f"https://cdn.discordapp.com/banners/{user['id']}/{user['banner']}.{ext}?size={size}"


def guild_badge_url(user: dict) -> str | None:
    guild = user.get("primary_guild")
    if not guild:
        return None
    return f"https://cdn.discordapp.com/clan-badges/{guild['identity_guild_id']}/{guild['badge']}.png"


def activity_asset_url(activity: dict, key: str) -> str | None:
    raw = (activity.get("assets") or {}).get(key)
    if not raw:
        return None
    if raw.startswith("spotify:"):
        return f"https://i.scdn.co/image/{raw[len('spotify:'):]}"
    if raw.startswith("mp:external/"):
        return f"https://media.discordapp.net/external/{raw[len('mp:external/'):]}"
    app_id = activity.get("application_id")
    if app_id:
        return f"https://cdn.discordapp.com/app-assets/{app_id}/{raw}.png"
    return None


def int_to_hex(color: int) -> str:
    return f"#{color:06x}"


async def fetch_lanyard() -> LanyardData:
    async with httpx.AsyncClient() as client:
        resp = await client.get(LANYARD_API, timeout=10)
        resp.raise_for_status()
    data = resp.json()
    if not data.get("success") or not data.get("data"):
        raise ValueError((data.get("error") or {}).get("message", "Lanyard returned no data"))
    d = data["data"]
    du = d["discord_user"]
    raw_nameplate = (du.get("collectibles") or {}).get("nameplate")
    user = DiscordUser(
        id=du["id"],
        username=du["username"],
        global_name=du.get("global_name"),
        display_name=du.get("display_name"),
        avatar=du.get("avatar"),
        banner=du.get("banner"),
        accent_color=du.get("accent_color"),
        display_name_styles=du.get("display_name_styles"),
        avatar_decoration_data=du.get("avatar_decoration_data"),
        primary_guild=du.get("primary_guild"),
        nameplate=Nameplate(
            asset=raw_nameplate["asset"],
            label=raw_nameplate.get("label"),
            palette=raw_nameplate.get("palette"),
            sku_id=raw_nameplate.get("sku_id"),
        ) if raw_nameplate else None,
    )
    activities = d.get("activities", [])
    custom_status = next((a for a in activities if a.get("type") == ACTIVITY_TYPE["CUSTOM"]), None)
    return LanyardData(
        user=user,
        status=d["discord_status"],
        activities=activities,
        customStatus=custom_status,
        spotify=d.get("spotify"),
        listeningToSpotify=d.get("listening_to_spotify", False),
    )


@router.get("/api/lanyard")
async def api_lanyard() -> Response:
    try:
        profile, fetched_at = await cache_json_get_or_fetch(
            key="lanyard:profile",
            ttl=LANYARD_REVALIDATE,
            fetcher=fetch_lanyard,
        )
        return Response(
            content=json.dumps({"profile": profile, "cachedAt": fetched_at}),
            media_type="application/json",
        )
    except Exception as e:
        return Response(
            content=json.dumps({"error": "lanyard_failed", "message": str(e)}),
            media_type="application/json",
            status_code=HTTPStatus.BAD_GATEWAY,
        )
