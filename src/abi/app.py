from contextlib import asynccontextmanager
import os
import shutil

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from abi.scripts.render_resume import render_resume_pdf
from abi.templates import templates

__all__: tuple[str, ...] = (
    "app",
)


def add_routes(app: FastAPI) -> None:
    from abi.router import router as root_router
    from abi.api.lanyard import router as lanyard_router
    from abi.api.lastfm import router as lastfm_router
    from abi.api.proxy import router as proxy_router
    from abi.api.cursors import router as cursors_router
    from abi.blog.router import router as blog_router
    from abi.guestbook.router import router as guestbook_router
    from abi.watch_list.router import router as watch_list_router

    app.include_router(root_router)
    app.include_router(lanyard_router)
    app.include_router(lastfm_router)
    app.include_router(proxy_router)
    app.include_router(cursors_router)
    app.include_router(blog_router)
    app.include_router(guestbook_router)
    app.include_router(watch_list_router)


@asynccontextmanager
async def lifespan(app: FastAPI):
    templates.load()
    await render_resume_pdf()
    app.mount(
        "/static",
        StaticFiles(directory="_served/static"),
        name="static",
    )
    add_routes(app)
    yield


app = FastAPI(
    debug=False,
    openapi_url=None,
    docs_url=None,
    redoc_url=None,
    swagger_ui_oauth2_redirect_url=None,
    summary="",
    lifespan=lifespan,
    title="abigail.sh",
)
