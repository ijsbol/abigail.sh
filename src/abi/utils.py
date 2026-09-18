def safe_local_path(value: str | None) -> str | None:
    if (
        not value
        or not value.startswith("/")
        or value.startswith("//")
        or "\\" in value
        or any(ord(char) < 0x20 for char in value)
    ):
        return None
    return value
