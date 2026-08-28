import json
import os
from http import HTTPStatus
from typing import Final

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

from abi import auth
from abi.auth import admin as admin_auth
from abi.auth import guestbook as guestbook_auth
from abi.guestbook import store as guestbook_store
from abi.templates import templates


router = APIRouter()


AUTH_ERRORS: Final[dict[str, str]] = {
    "unconfigured": "discord login isn't configured on this server yet.",
    "state": "login session expired or was tampered with - try again.",
    "exchange": "couldn't complete the discord handshake - try again.",
    "user": "couldn't read your discord account - try again.",
}


def _is_same_origin(request: Request) -> bool:
    origin = request.headers.get("origin") or ""
    host = request.headers.get("host") or ""
    if not origin:
        return True
    from urllib.parse import urlparse
    parsed = urlparse(origin)
    return parsed.netloc == host


@router.get("/guestbook")
async def guestbook_page(request: Request, auth: str = "") -> Response:
    session = guestbook_auth.get_session(request)
    site_admin = admin_auth.get_session(request)
    entries = guestbook_store.list_entries()
    current_entry = guestbook_store.get_entry_for_user(session["userId"]) if session else None
    bans = guestbook_store.list_bans() if site_admin else []
    user_banned = guestbook_store.is_user_banned(session["userId"]) if session else False

    return templates.serve_template(
        "guestbook.jinja2",
        HTTPStatus.OK,
        {
            "request": request,
            "current_page": "guestbook",
            "entries": [e.to_dict() for e in entries],
            "current_entry": current_entry.to_dict() if current_entry else None,
            "bans": [b.to_dict() for b in bans],
            "site_admin": {"username": site_admin["username"]} if site_admin else None,
            "user": {"username": session["username"], "displayName": session["displayName"]} if session else None,
            "user_banned": user_banned,
            "auth_error": auth if auth else None,
            "discord_configured": guestbook_auth.discord_configured(),
            "guestbook_data": json.dumps({
                "entries": [e.to_dict() for e in entries],
                "currentEntry": current_entry.to_dict() if current_entry else None,
                "user": {"username": session["username"], "displayName": session["displayName"]} if session else None,
                "siteAdmin": {"username": site_admin["username"]} if site_admin else None,
                "userBanned": user_banned,
                "authError": auth if auth else None,
                "discordConfigured": guestbook_auth.discord_configured(),
                "bans": [b.to_dict() for b in bans],
            }),
        },
    )


@router.get("/api/guestbook/auth/login")
async def guestbook_auth_login(request: Request) -> Response:
    if not guestbook_auth.discord_configured():
        return RedirectResponse("/guestbook?auth=unconfigured", status_code=302)
    state = auth.random_state()
    redirect = guestbook_auth.redirect_uri(request)
    url = auth.authorize_url(state, redirect)
    response = RedirectResponse(url, status_code=302)
    response.set_cookie(
        guestbook_auth.state_cookie, state,
        httponly=True, samesite="lax", path="/", max_age=600,
    )
    return response


@router.get("/api/guestbook/auth/callback")
async def guestbook_auth_callback(request: Request, code: str = "", state: str = "") -> Response:
    def fail(reason: str) -> Response:
        r = RedirectResponse(f"/guestbook?auth={reason}", status_code=302)
        r.delete_cookie(guestbook_auth.state_cookie)
        return r

    if not guestbook_auth.discord_configured():
        return fail("unconfigured")

    state_cookie = request.cookies.get(guestbook_auth.state_cookie)
    if not code or not state or not state_cookie or state != state_cookie:
        return fail("state")

    redirect = guestbook_auth.redirect_uri(request)
    token = await auth.exchange_code(code, redirect)
    if not token:
        return fail("exchange")

    user = await auth.fetch_discord_user(token)
    if not user:
        return fail("user")

    user_id = str(user.get("id", ""))
    username = user.get("username", "")
    display_name = user.get("global_name") or username
    session_token = guestbook_auth.create_session_token(
        {"userId": user_id, "username": username, "displayName": display_name}
    )

    response = RedirectResponse("/guestbook", status_code=HTTPStatus.FOUND)
    response.delete_cookie(guestbook_auth.state_cookie)
    response.set_cookie(
        guestbook_auth.session_cookie, session_token,
        httponly=True, samesite="lax", path="/",
        max_age=guestbook_auth.session_ttl,
    )
    return response


@router.post("/api/guestbook/auth/logout")
@router.get("/api/guestbook/auth/logout")
async def guestbook_auth_logout(request: Request) -> Response:
    response = RedirectResponse("/guestbook", status_code=HTTPStatus.FOUND)
    response.delete_cookie(guestbook_auth.session_cookie)
    return response


@router.get("/api/guestbook")
async def api_get_entries(request: Request) -> Response:
    entries = guestbook_store.list_entries()
    return JSONResponse(
        {"entries": [e.to_dict() for e in entries]},
        headers={"cache-control": "no-store"},
    )


@router.post("/api/guestbook")
async def api_create_entry(request: Request) -> Response:
    if not _is_same_origin(request):
        return JSONResponse(
            content={"error": "invalid_origin"},
            status_code=HTTPStatus.FORBIDDEN,
        )
    session = guestbook_auth.get_session(request)
    if not session:
        return JSONResponse(
            content={"error": "unauthorized"},
            status_code=HTTPStatus.UNAUTHORIZED,
        )
    if guestbook_store.is_user_banned(session["userId"]):
        return JSONResponse(
            content={"error": "banned"},
            status_code=HTTPStatus.FORBIDDEN,
        )
    if guestbook_store.get_entry_for_user(session["userId"]):
        return JSONResponse(
            content={"error": "already_signed"},
            status_code=HTTPStatus.CONFLICT,
        )

    try:
        raw = await request.json()
    except Exception:
        return JSONResponse(
            content={"error": "invalid_json"},
            status_code=HTTPStatus.BAD_REQUEST,
        )

    encoded = guestbook_store.validate_pixels(raw.get("pixels"))
    if encoded is None:
        return JSONResponse(
            content={"error": "invalid_pixels"},
            status_code=HTTPStatus.BAD_REQUEST,
        )

    entry = guestbook_store.create_entry(
        session["userId"], session["username"], session["displayName"], encoded
    )
    if not entry:
        if guestbook_store.is_user_banned(session["userId"]):
            return JSONResponse(
                content={"error": "banned"},
                status_code=HTTPStatus.FORBIDDEN,
            )
        return JSONResponse(
            content={"error": "already_signed"},
            status_code=HTTPStatus.CONFLICT,
        )
    return JSONResponse(
        content={"entry": entry.to_dict()},
        status_code=HTTPStatus.CREATED,
        headers={"cache-control": "no-store"},
    )


@router.put("/api/guestbook")
async def api_update_entry(request: Request) -> Response:
    if not _is_same_origin(request):
        return JSONResponse(
            content={"error": "invalid_origin"},
            status_code=HTTPStatus.FORBIDDEN,
        )
    session = guestbook_auth.get_session(request)
    if not session:
        return JSONResponse(
            content={"error": "unauthorized"},
            status_code=HTTPStatus.UNAUTHORIZED,
        )
    if guestbook_store.is_user_banned(session["userId"]):
        return JSONResponse(
            content={"error": "banned"},
            status_code=HTTPStatus.FORBIDDEN,
        )

    try:
        raw = await request.json()
    except Exception:
        return JSONResponse(
            content={"error": "invalid_json"},
            status_code=HTTPStatus.BAD_REQUEST,
        )

    encoded = guestbook_store.validate_pixels(raw.get("pixels"))
    if encoded is None:
        return JSONResponse(
            content={"error": "invalid_pixels"},
            status_code=HTTPStatus.BAD_REQUEST,
        )

    entry = guestbook_store.update_entry(
        session["userId"], session["username"], session["displayName"], encoded
    )
    if not entry:
        if guestbook_store.is_user_banned(session["userId"]):
            return JSONResponse(
                content={"error": "banned"},
                status_code=HTTPStatus.FORBIDDEN,
            )
        return JSONResponse(
            content={"error": "not_found"},
            status_code=HTTPStatus.NOT_FOUND,
        )
    return JSONResponse(
        content={"entry": entry.to_dict()},
    )


@router.delete("/api/guestbook")
async def api_delete_entry(request: Request) -> Response:
    if not _is_same_origin(request):
        return JSONResponse(
            content={"error": "invalid_origin"},
            status_code=HTTPStatus.FORBIDDEN,
        )
    session = guestbook_auth.get_session(request)
    if not session:
        return JSONResponse(
            content={"error": "unauthorized"},
            status_code=HTTPStatus.UNAUTHORIZED,
        )
    if not guestbook_store.delete_entry(session["userId"]):
        return JSONResponse(
            content={"error": "not_found"},
            status_code=HTTPStatus.NOT_FOUND,
        )
    return JSONResponse(
        content={"ok": True},
    )


@router.put("/api/guestbook/admin/entries/{entry_id}")
async def api_admin_update_entry(request: Request, entry_id: int) -> Response:
    if not _is_same_origin(request):
        return JSONResponse(
            content={"error": "invalid_origin"},
            status_code=HTTPStatus.FORBIDDEN,
        )
    site_admin = admin_auth.get_session(request)
    if not site_admin:
        return JSONResponse(
            content={"error": "unauthorized"},
            status_code=HTTPStatus.UNAUTHORIZED,
        )

    try:
        raw = await request.json()
    except Exception:
        return JSONResponse(
            content={"error": "invalid_json"},
            status_code=HTTPStatus.BAD_REQUEST,
        )

    encoded = guestbook_store.validate_pixels(raw.get("pixels"))
    if encoded is None:
        return JSONResponse(
            content={"error": "invalid_pixels"},
            status_code=HTTPStatus.BAD_REQUEST,
        )

    entry = guestbook_store.update_entry_by_id(entry_id, encoded)
    if not entry:
        return JSONResponse(
            content={"error": "not_found"},
            status_code=HTTPStatus.NOT_FOUND,
        )
    return JSONResponse(
        content={"entry": entry.to_dict()},
    )


@router.delete("/api/guestbook/admin/entries/{entry_id}")
async def api_admin_delete_entry(request: Request, entry_id: int) -> Response:
    if not _is_same_origin(request):
        return JSONResponse(
            content={"error": "invalid_origin"},
            status_code=HTTPStatus.FORBIDDEN,
        )
    site_admin = admin_auth.get_session(request)
    if not site_admin:
        return JSONResponse(
            content={"error": "unauthorized"},
            status_code=HTTPStatus.UNAUTHORIZED,
        )
    if not guestbook_store.delete_entry_by_id(entry_id):
        return JSONResponse(
            content={"error": "not_found"},
            status_code=HTTPStatus.NOT_FOUND,
        )
    return JSONResponse(
        content={"ok": True},
    )


@router.post("/api/guestbook/admin/bans")
async def api_admin_ban(request: Request) -> Response:
    if not _is_same_origin(request):
        return JSONResponse(
            content={"error": "invalid_origin"},
            status_code=HTTPStatus.FORBIDDEN,
        )
    site_admin = admin_auth.get_session(request)
    if not site_admin:
        return JSONResponse(
            content={"error": "unauthorized"},
            status_code=HTTPStatus.UNAUTHORIZED,
        )

    try:
        raw = await request.json()
    except Exception:
        return JSONResponse(
            content={"error": "invalid_json"},
            status_code=HTTPStatus.BAD_REQUEST,
        )

    entry_id = raw.get("entryId")
    if not isinstance(entry_id, int):
        return JSONResponse(
            content={"error": "missing_entry_id"},
            status_code=HTTPStatus.BAD_REQUEST,
        )

    ban = guestbook_store.ban_by_entry(entry_id, site_admin["userId"])
    if not ban:
        return JSONResponse(
            content={"error": "not_found"},
            status_code=HTTPStatus.NOT_FOUND,
        )
    return JSONResponse(
        content={"ban": ban.to_dict()},
        status_code=HTTPStatus.CREATED,
    )


@router.delete("/api/guestbook/admin/bans/{ban_id}")
async def api_admin_unban(request: Request, ban_id: int) -> Response:
    if not _is_same_origin(request):
        return JSONResponse(
            content={"error": "invalid_origin"},
            status_code=HTTPStatus.FORBIDDEN,
        )
    site_admin = admin_auth.get_session(request)
    if not site_admin:
        return JSONResponse(
            content={"error": "unauthorized"},
            status_code=HTTPStatus.UNAUTHORIZED,
        )
    if not guestbook_store.unban(ban_id):
        return JSONResponse(
            content={"error": "not_found"},
            status_code=HTTPStatus.NOT_FOUND,
        )
    return JSONResponse(
        content={"ok": True},
    )
