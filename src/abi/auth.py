import base64
import hashlib
import hmac
import json
import os
import secrets
from dataclasses import dataclass
from time import time
from typing import Callable, Final
from urllib.parse import urlencode

import httpx
from fastapi import Request


DISCORD_API: Final[str] = "https://discord.com/api"
AUTHORIZE_URL: Final[str] = "https://discord.com/oauth2/authorize"
TOKEN_URL: Final[str] = f"{DISCORD_API}/oauth2/token"
USER_URL: Final[str] = f"{DISCORD_API}/users/@me"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    pad = 4 - len(s) % 4
    if pad != 4:
        s += "=" * pad
    return base64.urlsafe_b64decode(s)


def _secret() -> str | None:
    return os.environ.get("SESSION_SECRET") or None


def _sign(payload: str, key: str) -> str:
    sig = hmac.new(key.encode(), payload.encode(), hashlib.sha256).digest()
    return _b64url(sig)


def site_admin_user_ids() -> list[str]:
    raw = os.environ.get("DISCORD_APPROVED_USER_IDS", "")
    return [v.strip() for v in raw.split(",") if v.strip()]


def is_site_admin(user_id: str) -> bool:
    return user_id in site_admin_user_ids()


def re_valid_user_id(user_id: str) -> bool:
    return bool(user_id) and user_id.isdigit() and 5 <= len(user_id) <= 24


def _discord_credentials_configured() -> bool:
    return bool(
        os.environ.get("DISCORD_CLIENT_ID")
        and os.environ.get("DISCORD_CLIENT_SECRET")
        and _secret()
    )


def random_state() -> str:
    return _b64url(secrets.token_bytes(24))


def authorize_url(state: str, redirect: str) -> str:
    params = urlencode({
        "client_id": os.environ.get("DISCORD_CLIENT_ID", ""),
        "response_type": "code",
        "scope": "identify",
        "state": state,
        "redirect_uri": redirect,
        "prompt": "consent",
    })
    return f"{AUTHORIZE_URL}?{params}"


async def exchange_code(code: str, redirect: str) -> dict | None:
    async with httpx.AsyncClient() as client:
        res = await client.post(
            TOKEN_URL,
            data={
                "client_id": os.environ.get("DISCORD_CLIENT_ID", ""),
                "client_secret": os.environ.get("DISCORD_CLIENT_SECRET", ""),
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect,
            },
        )
        if not res.is_success:
            return None
        return res.json()


async def fetch_discord_user(token: dict) -> dict | None:
    async with httpx.AsyncClient() as client:
        res = await client.get(
            USER_URL,
            headers={"authorization": f"{token['token_type']} {token['access_token']}"},
        )
        if not res.is_success:
            return None
        return res.json()


@dataclass(frozen=True)
class Authenticator:
    session_cookie: str
    state_cookie: str
    session_ttl: int
    callback_path: str
    redirect_env: str
    require_admin: bool
    validate: Callable[[dict], bool]

    def discord_configured(self) -> bool:
        if not _discord_credentials_configured():
            return False
        return not self.require_admin or bool(site_admin_user_ids())

    def create_session_token(self, claims: dict) -> str:
        key = _secret()
        if not key:
            raise RuntimeError("SESSION_SECRET is not configured")
        session = {**claims, "exp": int(time()) + self.session_ttl}
        payload = _b64url(json.dumps(session, separators=(",", ":")).encode())
        return f"{payload}.{_sign(payload, key)}"

    def verify_session_token(self, token: str | None) -> dict | None:
        key = _secret()
        if not key or not token:
            return None
        dot = token.rfind(".")
        if dot <= 0:
            return None
        payload = token[:dot]
        try:
            provided = _b64url_decode(token[dot + 1:])
            expected = hmac.new(key.encode(), payload.encode(), hashlib.sha256).digest()
            if not hmac.compare_digest(provided, expected):
                return None
            session = json.loads(_b64url_decode(payload))
            if not isinstance(session.get("exp"), int) or session["exp"] < int(time()):
                return None
            if not self.validate(session):
                return None
            if self.require_admin and not is_site_admin(session.get("userId", "")):
                return None
            return session
        except Exception:
            return None

    def get_session(self, request: Request) -> dict | None:
        return self.verify_session_token(request.cookies.get(self.session_cookie))

    def redirect_uri(self, request: Request) -> str:
        explicit = os.environ.get(self.redirect_env)
        if explicit:
            return explicit
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme
        host = (
            request.headers.get("x-forwarded-host")
            or request.headers.get("host")
            or request.url.netloc
        )
        return f"{proto}://{host}{self.callback_path}"


def _valid_admin_session(session: dict) -> bool:
    return isinstance(session.get("userId"), str) and isinstance(session.get("username"), str)


def _valid_guestbook_session(session: dict) -> bool:
    return (
        isinstance(session.get("userId"), str)
        and re_valid_user_id(session["userId"])
        and isinstance(session.get("username"), str)
        and bool(session["username"])
        and isinstance(session.get("displayName"), str)
        and bool(session["displayName"])
    )


admin: Final[Authenticator] = Authenticator(
    session_cookie="abigail_admin_session",
    state_cookie="abigail_oauth_state",
    session_ttl=60 * 60 * 24 * 7,
    callback_path="/api/blog/auth/callback",
    redirect_env="DISCORD_REDIRECT_URI",
    require_admin=True,
    validate=_valid_admin_session,
)


guestbook: Final[Authenticator] = Authenticator(
    session_cookie="abigail_guestbook_session",
    state_cookie="abigail_guestbook_oauth_state",
    session_ttl=60 * 60 * 24 * 30,
    callback_path="/api/guestbook/auth/callback",
    redirect_env="GUESTBOOK_DISCORD_REDIRECT_URI",
    require_admin=False,
    validate=_valid_guestbook_session,
)
