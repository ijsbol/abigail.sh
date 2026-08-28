import json
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path("src/abi/data")


@lru_cache(maxsize=1)
def load_projects() -> dict:
    with open(DATA_DIR / "projects.json") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def _raw_travel() -> dict:
    with open(DATA_DIR / "travel.json") as f:
        return json.load(f)


def load_travel_data() -> dict:
    raw = _raw_travel()
    countries = list(raw["countries"])
    next_up = raw.get("next_up_trips", [])
    default_current_num = raw.get("default_current_country_num", 528)

    current_trip = next((t for t in next_up if t["status"] == "current"), None)
    next_trip = current_trip or next((t for t in next_up if t["status"] == "next"), None)

    current_country_num = current_trip["num"] if current_trip else default_current_num
    next_nums = {t["num"] for t in next_up if t["status"] == "next"}

    existing_nums = {c["num"] for c in countries}
    for trip in next_up:
        if trip["num"] not in existing_nums:
            countries.append({
                "num": trip["num"],
                "iso3": trip["iso3"],
                "name": trip["name"],
                "endonym": trip.get("endonym"),
                "status": trip["status"],
            })

    resolved = []
    for c in countries:
        status = c["status"]
        if c["num"] == current_country_num:
            status = "current"
        elif c["num"] in next_nums:
            status = "next"
        elif status in ("current", "next"):
            status = "visited"
        resolved.append({**c, "status": status})

    status_by_num: dict[int, str] = {}
    for c in resolved:
        status_by_num[c["num"]] = c["status"]
        for mid in c.get("mapIds", []):
            status_by_num[mid] = c["status"]

    visited_count = sum(1 for c in resolved if c["status"] in ("current", "visited"))
    city_count = sum(len(c.get("cities", [])) for c in resolved)
    passed_count = sum(1 for c in resolved if c["status"] == "passed")

    def sort_key(c: dict) -> tuple:
        primary = c.get("endonym") or c["name"]
        first_letter = next((ch for ch in primary if _is_unicode_letter(ch)), None)
        is_non_latin = first_letter is not None and not _is_latin(first_letter)
        current_pin = 0 if c["status"] == "current" else 1
        non_latin_pin = 0 if is_non_latin else 1
        return (current_pin, non_latin_pin, primary.lower())

    sorted_countries = sorted(resolved, key=sort_key)

    return {
        "countries": resolved,
        "sorted_countries": sorted_countries,
        "status_by_num": status_by_num,
        "next_trip": next_trip,
        "current_trip": current_trip,
        "visited_count": visited_count,
        "city_count": city_count,
        "passed_count": passed_count,
        "status_labels": {
            "next": "up next",
            "current": "currently in",
            "visited": "visited",
            "passed": "passed through",
        },
        "status_order": ["next", "current", "visited", "passed"],
        "status_counts": {
            "next": sum(1 for c in resolved if c["status"] == "next"),
            "current": sum(1 for c in resolved if c["status"] == "current"),
            "visited": sum(1 for c in resolved if c["status"] == "visited"),
            "passed": sum(1 for c in resolved if c["status"] == "passed"),
        },
    }


def _is_unicode_letter(ch: str) -> bool:
    import unicodedata
    try:
        return unicodedata.category(ch).startswith("L")
    except Exception:
        return False


def _is_latin(ch: str) -> bool:
    import unicodedata
    try:
        name = unicodedata.name(ch, "")
        return "LATIN" in name
    except Exception:
        return False
