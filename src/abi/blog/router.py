import re
from dataclasses import asdict
from http import HTTPStatus
from typing_extensions import Final

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

from abi import auth
from abi.auth import admin as admin_auth
from abi.blog import store as blog_store
from abi.templates import templates


router = APIRouter()

MONTHS: Final[list[str]] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

ERRORS: dict[str, str] = {
    "unconfigured": "discord login isn't configured on this server yet.",
    "state": "login session expired or was tampered with - try again.",
    "exchange": "couldn't complete the discord handshake - try again.",
    "user": "couldn't read your discord account - try again.",
    "denied": "that discord account isn't approved as a site administrator.",
}


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"['\"]", "", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return text[:80]


def _default_display_date(iso: str) -> str:
    try:
        y, m, d = iso.split("-")
        month = MONTHS[int(m) - 1]
        return f"{month} {int(d)} {int(y)}"
    except Exception:
        return iso


def _normalise_input(raw: dict) -> tuple[blog_store.BlogInput | None, str | None]:
    def s(key: str) -> str:
        v = raw.get(key, "")
        return v.strip() if isinstance(v, str) else ""

    def b(key: str) -> bool:
        v = raw.get(key)
        return v is True or v == "true" or v == 1 or v == "1"

    title = s("title")
    if not title:
        return None, "missing_title"

    content = s("content")
    if not content:
        return None, "missing_content"

    sort_date_raw = s("sortDate")
    sort_date = sort_date_raw if re.match(r"^\d{4}-\d{2}-\d{2}$", sort_date_raw) else \
        __import__("datetime").date.today().isoformat()

    date = s("date") or _default_display_date(sort_date)

    tags_raw = raw.get("tags", [])
    if isinstance(tags_raw, list):
        tags = [t.strip() for t in tags_raw if isinstance(t, str) and t.strip()]
    elif isinstance(tags_raw, str):
        tags = [t.strip() for t in tags_raw.split(",") if t.strip()]
    else:
        tags = []

    kind = "writing" if raw.get("kind") == "writing" else "note"
    slug = _slugify(s("slug"))
    og_image = s("ogImage") or None
    published = True if raw.get("published") is None else b("published")

    return blog_store.BlogInput(
        slug=slug,
        title=title,
        description=s("description") or title,
        content=content,
        kind=kind,
        tags=tags,
        date=date,
        sort_date=sort_date,
        duration=s("duration") or "read",
        og_image=og_image,
        unlisted=b("unlisted"),
        published=published,
    ), None


def _post_to_dict(post: blog_store.BlogPost) -> dict:
    return asdict(post)


@router.get("/writing/{slug}")
async def redirect_writing(slug: str) -> Response:
    return RedirectResponse(f"/blog/{slug}", status_code=301)


@router.get("/notes/{slug}")
async def redirect_notes(slug: str) -> Response:
    return RedirectResponse(f"/blog/{slug}", status_code=301)


@router.get("/blog")
async def blog_index(request: Request) -> Response:
    posts = blog_store.list_posts()
    return templates.serve_template(
        "blog_index.jinja2",
        HTTPStatus.OK,
        {"request": request, "posts": posts, "current_page": "blog"},
    )


@router.get("/blog/admin/login")
async def blog_admin_login(request: Request, error: str = "") -> Response:
    session = admin_auth.get_session(request)
    if session:
        return RedirectResponse("/admin", status_code=302)
    configured = admin_auth.discord_configured()
    return templates.serve_template(
        "blog_admin_login.jinja2",
        HTTPStatus.OK,
        {
            "request": request,
            "current_page": "blog",
            "configured": configured,
            "error_msg": ERRORS.get(error, ""),
        },
    )


@router.get("/blog/admin/new")
async def blog_admin_new(request: Request) -> Response:
    session = admin_auth.get_session(request)
    if not session:
        return RedirectResponse("/blog/admin/login", status_code=302)
    return templates.serve_template(
        "blog_admin_editor.jinja2",
        HTTPStatus.OK,
        {"request": request, "current_page": "blog", "post": None, "username": session["username"]},
    )


@router.get("/blog/admin/edit/{slug}")
async def blog_admin_edit(request: Request, slug: str) -> Response:
    session = admin_auth.get_session(request)
    if not session:
        return RedirectResponse("/blog/admin/login", status_code=302)
    post = blog_store.get_post(slug)
    if not post:
        return Response(status_code=404)
    return templates.serve_template(
        "blog_admin_editor.jinja2",
        HTTPStatus.OK,
        {
            "request": request,
            "current_page": "blog",
            "post": _post_to_dict(post),
            "username": session["username"],
        },
    )


@router.get("/blog/admin")
async def blog_admin(request: Request) -> Response:
    session = admin_auth.get_session(request)
    if not session:
        return RedirectResponse("/blog/admin/login", status_code=302)
    posts = blog_store.list_posts(include_unlisted=True, include_drafts=True)
    return templates.serve_template(
        "blog_admin.jinja2",
        HTTPStatus.OK,
        {
            "request": request,
            "current_page": "blog",
            "posts": [_post_to_dict(p) for p in posts],
            "username": session["username"],
        },
    )


@router.get("/admin")
async def site_admin(request: Request) -> Response:
    session = admin_auth.get_session(request)
    if not session:
        return RedirectResponse("/blog/admin/login", status_code=302)
    posts = blog_store.list_posts(include_unlisted=True, include_drafts=True)
    return templates.serve_template(
        "admin_home.jinja2",
        HTTPStatus.OK,
        {
            "request": request,
            "current_page": "blog",
            "post_count": len(posts),
            "username": session["username"],
        },
    )


@router.get("/blog/{slug}")
async def blog_post(request: Request, slug: str) -> Response:
    post = blog_store.get_post(slug)
    if not post:
        return Response(status_code=404)
    session = admin_auth.get_session(request)
    if not post.published and not session:
        return Response(status_code=404)
    return templates.serve_template(
        "blog_post.jinja2",
        HTTPStatus.OK,
        {
            "request": request,
            "current_page": "blog",
            "post": _post_to_dict(post),
        },
    )


@router.get("/api/blog/auth/login")
async def auth_login(request: Request) -> Response:
    if not admin_auth.discord_configured():
        return RedirectResponse("/blog/admin/login?error=unconfigured", status_code=302)
    state = auth.random_state()
    redirect = admin_auth.redirect_uri(request)
    url = auth.authorize_url(state, redirect)
    response = RedirectResponse(url, status_code=302)
    response.set_cookie(
        admin_auth.state_cookie, state,
        httponly=True, samesite="lax", path="/", max_age=600,
    )
    return response


@router.get("/api/blog/auth/callback")
async def auth_callback(request: Request, code: str = "", state: str = "") -> Response:
    def fail(reason: str) -> Response:
        r = RedirectResponse(f"/blog/admin/login?error={reason}", status_code=302)
        r.delete_cookie(admin_auth.state_cookie)
        return r

    if not admin_auth.discord_configured():
        return fail("unconfigured")

    state_cookie = request.cookies.get(admin_auth.state_cookie)
    if not code or not state or not state_cookie or state != state_cookie:
        return fail("state")

    redirect = admin_auth.redirect_uri(request)
    token = await auth.exchange_code(code, redirect)
    if not token:
        return fail("exchange")

    user = await auth.fetch_discord_user(token)
    if not user:
        return fail("user")

    if not auth.is_site_admin(user["id"]):
        return fail("denied")

    username = user.get("global_name") or user.get("username", "")
    session_token = admin_auth.create_session_token({"userId": user["id"], "username": username})

    response = RedirectResponse("/admin", status_code=302)
    response.delete_cookie(admin_auth.state_cookie)
    response.set_cookie(
        admin_auth.session_cookie, session_token,
        httponly=True, samesite="lax", path="/",
        max_age=admin_auth.session_ttl,
    )
    return response


@router.get("/api/blog/auth/logout")
@router.post("/api/blog/auth/logout")
async def auth_logout(request: Request) -> Response:
    response = RedirectResponse("/blog", status_code=302)
    response.delete_cookie(admin_auth.session_cookie)
    return response


@router.get("/api/blog/posts")
async def api_list_posts(request: Request) -> Response:
    if not admin_auth.get_session(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    posts = blog_store.list_posts(include_unlisted=True, include_drafts=True)
    return JSONResponse({"posts": [_post_to_dict(p) for p in posts]})


@router.post("/api/blog/posts")
async def api_create_post(request: Request) -> Response:
    if not admin_auth.get_session(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    try:
        raw = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid_json"}, status_code=400)

    inp, err = _normalise_input(raw)
    if err or inp is None:
        return JSONResponse({"error": err}, status_code=400)

    if not inp.slug:
        inp.slug = _slugify(inp.title)
    if not inp.slug:
        return JSONResponse({"error": "missing_slug"}, status_code=400)
    if blog_store.slug_exists(inp.slug):
        return JSONResponse({"error": "slug_taken"}, status_code=409)

    post = blog_store.create_post(inp)
    return JSONResponse({"post": _post_to_dict(post)}, status_code=201)


@router.get("/api/blog/posts/{slug}")
async def api_get_post(request: Request, slug: str) -> Response:
    if not admin_auth.get_session(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    post = blog_store.get_post(slug)
    if not post:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return JSONResponse({"post": _post_to_dict(post)})


@router.put("/api/blog/posts/{slug}")
async def api_update_post(request: Request, slug: str) -> Response:
    if not admin_auth.get_session(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    try:
        raw = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid_json"}, status_code=400)

    inp, err = _normalise_input(raw)
    if err or inp is None:
        return JSONResponse({"error": err}, status_code=400)

    inp.slug = slug
    post = blog_store.update_post(slug, inp)
    if not post:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return JSONResponse({"post": _post_to_dict(post)})


@router.delete("/api/blog/posts/{slug}")
async def api_delete_post(request: Request, slug: str) -> Response:
    if not admin_auth.get_session(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    ok = blog_store.delete_post(slug)
    if not ok:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return JSONResponse({"ok": True})
