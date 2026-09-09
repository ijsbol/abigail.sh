from datetime import datetime, timezone
from http import HTTPStatus
import json
from math import isfinite
from typing import Final, TypedDict

import aiohttp
from fastapi import APIRouter, Request, Response

from abi.api.cache import cache_json_get_or_fetch


router = APIRouter()

WEATHER_CACHE_KEY: Final[str] = "weather"
WEATHER_REVALIDATE: Final[int] = 600
WEATHER_LOCATION: Final[str] = "Utrecht"

# WMO weather interpretation codes returned by Open-Meteo.
WEATHER_CONDITIONS: Final[dict[int, tuple[str, str, str]]] = {
    0: ("clear sky", "clear", "☀"),
    1: ("mainly clear", "clear", "☀"),
    2: ("partly cloudy", "partly-cloudy", "◐"),
    3: ("overcast", "cloudy", "☁"),
    45: ("foggy", "fog", "≋"),
    48: ("rime fog", "fog", "≋"),
    51: ("light drizzle", "drizzle", "╱"),
    53: ("drizzle", "drizzle", "╱"),
    55: ("heavy drizzle", "drizzle", "╱"),
    56: ("freezing drizzle", "freezing-drizzle", "╱"),
    57: ("heavy freezing drizzle", "freezing-drizzle", "╱"),
    61: ("light rain", "rain", "▾"),
    63: ("rain", "rain", "▾"),
    65: ("heavy rain", "rain", "▾"),
    66: ("freezing rain", "freezing-rain", "▾"),
    67: ("heavy freezing rain", "freezing-rain", "▾"),
    71: ("light snow", "snow", "❄"),
    73: ("snow", "snow", "❄"),
    75: ("heavy snow", "snow", "❄"),
    77: ("snow grains", "snow", "❄"),
    80: ("light showers", "showers", "▾"),
    81: ("showers", "showers", "▾"),
    82: ("heavy showers", "showers", "▾"),
    85: ("light snow showers", "snow-showers", "❄"),
    86: ("snow showers", "snow-showers", "❄"),
    95: ("thunderstorm", "thunderstorm", "ϟ"),
    96: ("thunderstorm with hail", "thunderstorm", "ϟ"),
    99: ("thunderstorm with heavy hail", "thunderstorm", "ϟ"),
}


class WeatherIndicator(TypedDict):
    location: str
    temperature: int
    description: str
    icon: str
    symbol: str


async def fetch_weather_data() -> dict:
    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=10),
    ) as session:
        async with session.get(
            url="https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": 52.08917,
                "longitude": 5.10972,
                "timezone": "Europe/Amsterdam",
                "forecast_days": 1,
                "current": ",".join([
                    "temperature_2m",
                    "apparent_temperature",
                    "weather_code",
                    "wind_speed_10m",
                ]),
                "hourly": ",".join([
                    "temperature_2m",
                    "rain",
                    "showers",
                    "snowfall",
                    "snow_depth",
                    "precipitation",
                    "dew_point_2m",
                    "relative_humidity_2m",
                    "apparent_temperature",
                    "precipitation_probability",
                    "wind_speed_10m",
                    "weather_code",
                    "wind_direction_10m",
                    "wind_gusts_10m",
                    "temperature_80m",
                ]),
            },
        ) as resp:
            resp.raise_for_status()
            return await resp.json()


async def get_weather_data() -> tuple[dict, int]:
    return await cache_json_get_or_fetch(
        WEATHER_CACHE_KEY,
        WEATHER_REVALIDATE,
        fetch_weather_data,
    )


def _parse_weather_time(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _current_weather_values(data: dict) -> dict:
    current = data.get("current")
    if isinstance(current, dict):
        return current

    hourly = data.get("hourly")
    if not isinstance(hourly, dict):
        return {}
    times = hourly.get("time")
    if not isinstance(times, list) or not times:
        return {}

    now = datetime.now(timezone.utc)
    valid_times = [_parse_weather_time(value) for value in times]
    indexes = [
        (index, value)
        for index, value in enumerate(valid_times)
        if value is not None
    ]
    if not indexes:
        return {}
    index = min(indexes, key=lambda item: abs(item[1] - now))[0]
    return {
        key: values[index]
        for key, values in hourly.items()
        if key != "time" and isinstance(values, list) and index < len(values)
    }


def build_weather_indicator(data: dict) -> WeatherIndicator | None:
    values = _current_weather_values(data)
    temperature = values.get("temperature_2m")
    weather_code = values.get("weather_code")
    if not isinstance(temperature, (int, float)) or not isfinite(temperature):
        return None
    if not isinstance(weather_code, (int, float)) or not isfinite(weather_code):
        return None

    description, icon, symbol = WEATHER_CONDITIONS.get(
        int(weather_code),
        ("unknown conditions", "unknown", "•"),
    )
    return WeatherIndicator(
        location=WEATHER_LOCATION,
        temperature=round(temperature),
        description=description,
        icon=icon,
        symbol=symbol,
    )


async def get_weather_indicator() -> WeatherIndicator | None:
    data, _ = await get_weather_data()
    return build_weather_indicator(data)


@router.get("/api/weather")
async def api_weather() -> Response:
    try:
        data, _ = await get_weather_data()
    except Exception as error:
        return Response(
            content=json.dumps({"error": "weather_failed", "message": str(error)}),
            media_type="application/json",
            status_code=HTTPStatus.BAD_GATEWAY,
        )
    return Response(
        content=json.dumps(data),
        media_type="application/json",
    )
