import os
from http import HTTPStatus
from typing import Final

from dotenv import load_dotenv
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from abi.templates import templates
from abi.watch_list import store as watch_list_store


router = APIRouter()


load_dotenv()


WATCH_LIST_TOKEN: Final[str] = os.environ.get("WATCH_LIST_IMPORT_TOKEN", "")


@router.get("/watch-list")
async def watch_list_page(request: Request) -> Response:
    data = watch_list_store.load_watch_list()
    return templates.serve_template(
        template_name="watch_list.jinja2",
        status_code=HTTPStatus.OK,
        context={
            "request": request,
            "data": data,
        },
    )


@router.get("/api/watch-list")
async def api_get_watch_list(request: Request) -> Response:
    data = watch_list_store.load_watch_list()
    if not data:
        return JSONResponse(
            content={"error": "no_data"},
            status_code=HTTPStatus.NOT_FOUND,
        )
    return JSONResponse(
        content=data,
        status_code=HTTPStatus.OK,
    )


@router.post("/api/watch-list/import")
async def api_import_watch_list(request: Request) -> Response:
    auth = request.headers.get("authorization", "")
    if not WATCH_LIST_TOKEN or auth != f"Bearer {WATCH_LIST_TOKEN}":
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

    reminders = raw if isinstance(raw, list) else raw.get("reminders", [])
    if not isinstance(reminders, list):
        return JSONResponse(
            content={"error": "invalid_body"},
            status_code=HTTPStatus.BAD_REQUEST,
        )

    data = watch_list_store.parse_reminders(reminders)
    watch_list_store.store_watch_list(data)
    return JSONResponse(
        content={
            "ok": True,
            "updatedAt": data["updatedAt"],
        },
        status_code=HTTPStatus.OK,
    )
