from abi.app import app


__all__: tuple[str, ...] = ()


def main() -> None:
    import uvicorn

    uvicorn.run("abi.app:app", reload=True)
