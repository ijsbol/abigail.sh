import asyncio
from hashlib import sha1
from http import HTTPStatus
import json
import mimetypes
from pathlib import Path
import random
from typing import Awaitable, Callable, Final

from fastapi import Request, Response, APIRouter

from abi.api.anilist import fetch_profile, fetch_watch_history
from abi.api.cache import cache_json_get_or_fetch
from abi.api.lanyard import fetch_lanyard, LANYARD_REVALIDATE
from abi.api.lastfm import fetch_recent_tracks, LASTFM_REVALIDATE, LASTFM_FETCH_LIMIT
from abi.templates import templates
from abi.data import load_projects, load_travel_data
from abi.private.photography import PHOTOGRAPHY_SHOTS
from abi.api.weather import get_weather_indicator


router = APIRouter()


TILDE_HANDLERS: dict[str, Callable[[Request], Awaitable[Response]]] = {}


def register_tilde_handler(name: str, handler: Callable[[Request], Awaitable[Response]]) -> None:
    TILDE_HANDLERS[name] = handler

TILDE_DIRECTORIES: Final[tuple[Path, ...]] = (
    Path(__file__).parent / "~",
    Path(__file__).parent / "private" / "~",
)


with open("src/abi/private/friend-buttons.json", "r") as f:
    friend_buttons = json.load(f)


@router.get("/")
async def home_page(request: Request) -> Response:
    shuffled_friend_buttons = list(friend_buttons.items())
    random.shuffle(shuffled_friend_buttons)
    shuffled_friend_buttons = dict(shuffled_friend_buttons)
    travel = load_travel_data()
    missing_weather = object()
    weather = getattr(getattr(request, "state", None), "weather", missing_weather)
    if weather is missing_weather:
        try:
            weather = await get_weather_indicator()
        except Exception:
            weather = None
    return templates.serve_template(
        template_name="home_page.jinja2",
        status_code=HTTPStatus.OK,
        context={
            "request": request,
            "friend_buttons": shuffled_friend_buttons,
            "visited_count": travel["visited_count"],
            "weather": weather,
            "vanity_buttons": {
                None: "public/images/buttons/vanity/blink.png",
                None: "public/images/buttons/vanity/firefox.png",
                None: "public/images/buttons/vanity/nft.gif:anim",
                None: "public/images/buttons/vanity/miku.png",
                None: "public/images/buttons/vanity/owntwopaws.png",
                None: "public/images/buttons/vanity/macos.png",
                "https://exploreabyss.org/": "public/images/buttons/vanity/abyss.png",
                "https://the.inner-circle.fyi/": "public/images/buttons/vanity/the-inner-circle.png",
                "https://uwu.gal": "public/images/buttons/vanity/uwugal.png",
                "https://250kb.club/abigail-short": "public/images/buttons/vanity/250kb.png",
            },
        },
    )


@router.get("/projects")
async def projects_page(request: Request) -> Response:
    data = load_projects()
    projects = data["projects"]
    tags = data["tags"]
    tag_counts = {tag: sum(1 for p in projects if tag in p.get("tags", [])) for tag in tags}
    return templates.serve_template(
        template_name="projects.jinja2",
        status_code=HTTPStatus.OK,
        context={
            "request": request,
            "projects": projects,
            "tags": tags,
            "tag_counts": tag_counts,
        },
    )


@router.get("/photography")
async def photography_page(request: Request) -> Response:
    return templates.serve_template(
        template_name="photography.jinja2",
        status_code=HTTPStatus.OK,
        context={
            "request": request,
            "shots": PHOTOGRAPHY_SHOTS,
        },
    )


@router.get("/travel")
async def travel_page(request: Request) -> Response:
    data = load_travel_data()
    return templates.serve_template(
        template_name="travel.jinja2",
        status_code=HTTPStatus.OK,
        context={
            "request": request,
            "countries": data["sorted_countries"],
            "status_by_num": data["status_by_num"],
            "next_trip": data["next_trip"],
            "visited_count": data["visited_count"],
            "city_count": data["city_count"],
            "passed_count": data["passed_count"],
            "status_labels": data["status_labels"],
            "status_order": data["status_order"],
            "status_counts": data["status_counts"],
            "status_by_num_json": json.dumps(data["status_by_num"]),
            "next_trip_json": json.dumps(data["next_trip"]),
        },
    )


@router.get("/buttons")
async def buttons_page(request: Request) -> Response:
    return templates.serve_template(
        template_name="buttons.jinja2",
        status_code=HTTPStatus.OK,
        context={"request": request},
    )


@router.get("/resume")
async def resume_page(request: Request) -> Response:
    resume_path = Path("_served/static/resume.pdf")
    resume_url = None
    if resume_path.exists():
        hash_val = sha1(resume_path.read_bytes()).hexdigest()[:10]
        resume_url = f"/static/resume.pdf?v={hash_val}"
    return templates.serve_template(
        template_name="resume.jinja2",
        status_code=HTTPStatus.OK,
        context={"request": request, "resume_url": resume_url},
    )


@router.get("/resume-print")
async def resume_print_page(request: Request) -> Response:
    return templates.serve_template(
        template_name="resume_printable.jinja2",
        status_code=HTTPStatus.OK,
        context={"request": request},
    )


@router.get("/profile")
async def profile_page(request: Request) -> Response:
    ANILIST_REVALIDATE = 3600
    WATCH_HISTORY_LIMIT = 36

    async def safe(coro):
        try:
            return await coro
        except Exception:
            return None

    results = await asyncio.gather(
        safe(cache_json_get_or_fetch("lanyard:profile", LANYARD_REVALIDATE, fetch_lanyard)),
        safe(cache_json_get_or_fetch("anilist:profile", ANILIST_REVALIDATE, fetch_profile)),
        safe(cache_json_get_or_fetch(
            f"anilist:watch:{WATCH_HISTORY_LIMIT}",
            ANILIST_REVALIDATE,
            lambda: fetch_watch_history(WATCH_HISTORY_LIMIT),
        )),
        safe(cache_json_get_or_fetch(
            f"lastfm:recent:{LASTFM_FETCH_LIMIT}",
            LASTFM_REVALIDATE,
            lambda: fetch_recent_tracks(LASTFM_FETCH_LIMIT),
        )),
    )

    lanyard = results[0][0] if results[0] else None
    anilist = results[1][0] if results[1] else None
    watch_history = results[2][0] if results[2] else None
    tracks = results[3][0] if results[3] else None

    return templates.serve_template(
        template_name="profile.jinja2",
        status_code=HTTPStatus.OK,
        context={
            "request": request,
            "lanyard": lanyard,
            "tracks": tracks,
            "anilist": anilist,
            "watch_history": watch_history,
            "profile_data": json.dumps({
                "lanyard": lanyard,
                "tracks": tracks,
                "watchHistoryInitialVisible": 6,
                "recentTracksInitialVisible": 6,
                "recentTracksMax": 50,
            }),
        },
    )


@router.get("/~/{tilde}")
async def tilde_redirect(request: Request, tilde: str | None) -> Response:
    if not tilde:
        return Response(status_code=HTTPStatus.NOT_FOUND)

    handler = TILDE_HANDLERS.get(tilde)
    if handler is not None:
        return await handler(request)

    tilde_files = [
        path
        for directory in TILDE_DIRECTORIES
        for path in sorted(directory.iterdir())
        if path.is_file() and path.stem == tilde
    ]
    if len(tilde_files) > 1:
        raise ValueError(f"multiple tilde files found for {tilde!r}: {tilde_files}")
    if not tilde_files:
        return Response(status_code=HTTPStatus.NOT_FOUND)

    tilde_file = tilde_files[0]
    media_type, _ = mimetypes.guess_type(tilde_file.name)
    return Response(
        content=tilde_file.read_bytes(),
        media_type=media_type or "application/octet-stream",
    )
