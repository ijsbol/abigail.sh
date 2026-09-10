from abi.app import app


__all__: tuple[str, ...] = ()


def main() -> None:
    import uvicorn

    uvicorn.run(
        app="abi:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_includes=["*.jinja2", "*.css", "*.js"],
        reload_dirs=["src/abi"],
    )
