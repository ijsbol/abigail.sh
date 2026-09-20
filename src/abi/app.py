from contextlib import asynccontextmanager
from typing import Any, Coroutine

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from abi.scripts.render_resume import render_resume_pdf
from abi.templates import TemplateServer, templates


__all__: tuple[str, ...] = (
    "app",
)


def add_routes(app: FastAPI) -> None:
    from abi.router import router as root_router
    from abi.api.lanyard import router as lanyard_router
    from abi.api.lastfm import router as lastfm_router
    from abi.api.proxy import router as proxy_router
    from abi.api.cursors import router as cursors_router
    from abi.api.weather import router as weather_router
    from abi.blog.router import router as blog_router
    from abi.guestbook.router import router as guestbook_router
    from abi.watch_list.router import router as watch_list_router
    from abi.private.router import load_private_routers

    app.include_router(root_router)
    app.include_router(lanyard_router)
    app.include_router(lastfm_router)
    app.include_router(proxy_router)
    app.include_router(cursors_router)
    app.include_router(blog_router)
    app.include_router(guestbook_router)
    app.include_router(watch_list_router)
    app.include_router(weather_router)
    load_private_routers(app, templates)


@asynccontextmanager
async def lifespan(app: FastAPI):
    templates.load()
    await create_refetch(refresh_weather(templates), interval=30 * 60)
    await render_resume_pdf()
    app.mount(
        "/static",
        StaticFiles(directory="_served/static"),
        name="static",
    )
    add_routes(app)
    yield


async def refresh_weather(templates: TemplateServer) -> None:
    try:
        from abi.api.weather import get_weather_indicator

        templates.weather = await get_weather_indicator()
    except Exception:
        templates.weather = None


async def create_refetch(func: Coroutine[Any, Any, Any], interval: int = 60) -> None:
    import asyncio

    async def _refetch():
        while True:
            try:
                await func
            except Exception:
                pass
            await asyncio.sleep(interval)

    asyncio.create_task(_refetch())


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
