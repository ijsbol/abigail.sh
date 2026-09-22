import hashlib
from http import HTTPStatus
import os
from pathlib import Path
import random
import shutil
import subprocess
from typing import Final, Union

from fastapi import Request, Response
from fastapi.templating import Jinja2Templates
from PIL import Image, ImageSequence
from rcssmin import cssmin
from rjsmin import jsmin
from functools import partial

from abi.api.weather import WeatherIndicator


__all__: tuple[str, ...] = (
    "templates",
)

EIGHTY_EIGHT_THIRTY_ONE_SCRAPER_AGENT: Final[str] = "eightyeightthirtyone"
SPECIFICALLY_INCLUDED_FILES: Final[list[str]] = [
    # website link styling
    "images/external-link-svgrepo-com.svg",
    "images/download-button-svgrepo-com.svg",
]


def _get_most_recent_commit_hash() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip() or "unknown"
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def _get_file_hash(file_path: str | Path) -> str:
    digest = hashlib.md5()
    with open(file_path, "rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()[:6]


# Source - https://stackoverflow.com/a/79032686
# Posted by Angy, modified by community. See post 'Timeline' for change history
# Retrieved 2026-09-06, License - CC BY-SA 4.0
def is_animation(file_or_bytes: Union[str, bytes]) -> bool:
    """
    Check if the given image file or bytes is an animation.

    Args:
        file_or_bytes (Union[str, bytes]): Path to the image file or image bytes.

    Returns:
        bool: True if the image is an animation; False otherwise.
    """
    try:
        with Image.open(file_or_bytes) as img:
            # Check if the image has more than one frame
            return len(ImageSequence.all_frames(img)) > 1
    except (IOError, ValueError) as e:
        # Handle errors related to file opening and invalid image formats
        print(f"Error opening image: {e}")
        return False


class TemplateServer(Jinja2Templates):
    def __init__(self, directory: str) -> None:
        self.weather: WeatherIndicator | None = None
        self._served_files: dict[str, str] = {}
        self._most_recent_commit_hash = _get_most_recent_commit_hash()
        super().__init__(directory=directory)
        self.env.filters["intcomma"] = lambda x: f"{int(x):,}"

    def _serve_images(self, loc: str) -> None:
        image_dir = f"{loc}/images"
        for dirpath, _, filenames in os.walk(image_dir):
            rel_dir = os.path.relpath(dirpath, image_dir)
            if rel_dir == "writing":
                continue
            out_dir = os.path.normpath(os.path.join("_served/static/images", rel_dir))
            os.makedirs(out_dir, exist_ok=True)

            for file in filenames:
                file_name, file_ext = os.path.splitext(file)
                print(f"[{loc}] [templates:images] processing {file}...")
                if file_ext not in (".png", ".jpg", ".jpeg", ".gif"):
                    continue

                source_path = Path(dirpath) / file
                version = _get_file_hash(source_path)
                output_dir = Path("static/images")
                if rel_dir != ".":
                    output_dir /= rel_dir
                output_stem = f"{file_name}.{version}"
                avif_file_path = (output_dir / f"{output_stem}.avif").as_posix()
                png_file_path = (output_dir / f"{output_stem}.png").as_posix()
                anim_file_path = (output_dir / f"{output_stem}:anim.avif").as_posix()
                avif_path = Path("_served") / avif_file_path
                png_path = Path("_served") / png_file_path
                anim_path = Path("_served") / anim_file_path
                animated = is_animation(str(source_path))

                if (
                    not avif_path.exists()
                    or not png_path.exists()
                    or (animated and not anim_path.exists())
                ):
                    with Image.open(source_path) as image:
                        if animated:
                            image.save(anim_path, optimize=True, quality=50, format="AVIF", save_all=True)
                        image.save(avif_path, optimize=True, quality=50, format="AVIF", save_all=False)
                        image.save(png_path, optimize=True, quality=95, format="PNG", save_all=True)

                public_path = os.path.normpath(f"public/images/{rel_dir}/{file}")
                self._served_files[f"{public_path}:png"] = png_file_path
                self._served_files[f"{public_path}:avif"] = avif_file_path
                if animated:
                    self._served_files[f"{public_path}:anim"] = anim_file_path

        # specific legacy override for people hot-linking my button on their sites.
        if loc == "src/abi/public":
            shutil.copyfile(f"{loc}/images/button.png", "_served/static/images/button.png")

    def _version_css_asset_references(self, css_content: str) -> str:
        for asset in SPECIFICALLY_INCLUDED_FILES:
            versioned_path = self._served_files.get(asset)
            if versioned_path:
                css_content = css_content.replace(f"/static/{asset}", f"/{versioned_path}")
        return css_content

    def _serve_css(self, loc: str) -> None:
        css_dir = f"{loc}/css"
        os.makedirs("_served/static/css", exist_ok=True)
        for file in os.listdir(css_dir):
            if not file.endswith(".css"):
                continue
            file_name, _ = os.path.splitext(file)
            with open(f"{css_dir}/{file}", "r") as f:
                css_content = self._version_css_asset_references(f.read())
            minified_css = str(cssmin(css_content))
            md5hash = hashlib.md5(css_content.encode()).hexdigest()[:6]
            new_file_name = f"{file_name}.{md5hash}.css"
            with open(f"_served/static/css/{new_file_name}", "w") as f:
                f.write(str(minified_css))
            self._served_files["public/css/" + file] = f"static/css/{new_file_name}"

    def _serve_js(self, loc: str) -> None:
        js_dir = f"{loc}/js"
        os.makedirs("_served/static/js", exist_ok=True)
        for file in os.listdir(js_dir):
            if not file.endswith(".js"):
                continue
            file_name, _ = os.path.splitext(file)
            with open(f"{js_dir}/{file}", "r") as f:
                js_content = f.read()
            minified_js = str(jsmin(js_content))
            md5hash = hashlib.md5(js_content.encode()).hexdigest()[:6]
            new_file_name = f"{file_name}.{md5hash}.js"
            with open(f"_served/static/js/{new_file_name}", "w") as f:
                f.write(str(minified_js))
            self._served_files["public/js/" + file] = f"static/js/{new_file_name}"

    def _serve_misc(self) -> None:
        for file in SPECIFICALLY_INCLUDED_FILES:
            source_path = Path("src/abi/public") / file
            source_hash = _get_file_hash(source_path)
            source_stem = source_path.stem
            source_suffix = source_path.suffix
            versioned_file = source_path.with_name(f"{source_stem}.{source_hash}{source_suffix}")
            versioned_path = Path("static") / versioned_file.relative_to("src/abi/public")
            versioned_destination = Path("_served") / versioned_path
            versioned_destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source_path, versioned_destination)

            # keep the old URL working for existing links
            stable_destination = Path("_served/static") / file
            stable_destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source_path, stable_destination)

            served_path = versioned_path.as_posix()
            self._served_files[file] = served_path
            self._served_files[os.path.normpath(f"public/{file}")] = served_path

    def _serve_private(self) -> None:
        fonts_dir = "src/abi/private/public/fonts"
        os.makedirs("_served/static/fonts", exist_ok=True)
        for file in os.listdir(fonts_dir):
            if not file.endswith((".woff", ".woff2", ".ttf", ".otf")):
                continue
            shutil.copyfile(f"{fonts_dir}/{file}", f"_served/static/fonts/{file}")
            self._served_files["private/public/fonts/" + file] = f"static/fonts/{file}"
        data_dir = "src/abi/private/public/data"
        if os.path.isdir(data_dir):
            os.makedirs("_served/static/data", exist_ok=True)
            for file in os.listdir(data_dir):
                if not file.endswith(".json"):
                    continue
                shutil.copyfile(f"{data_dir}/{file}", f"_served/static/data/{file}")
                self._served_files["public/public/data/" + file] = f"static/data/{file}"

        # serve the raw public/writing directory
        writing_dir = "src/abi/private/public/writing"
        if os.path.isdir(writing_dir):
            os.makedirs("_served/static/writing", exist_ok=True)
            for file in os.listdir(writing_dir):
                shutil.copyfile(f"{writing_dir}/{file}", f"_served/static/writing/{file}")
                self._served_files["public/writing/" + file] = f"static/writing/{file}"

    def load(self) -> None:
        self._serve_misc()
        locations: list[str] = [
            "src/abi/public",
            "src/abi/private/public",
        ]
        for loc in locations:
            print(f"[{loc}] [templates:start] loading templates and serving static files...")
            self._serve_images(loc)
            print(f"[{loc}] [templates:images] served {len(self._served_files)} static files.")
            self._serve_css(loc)
            print(f"[{loc}] [templates:css] served {len(self._served_files)} static files.")
            self._serve_js(loc)
            print(f"[{loc}] [templates:js] served {len(self._served_files)} static files.")

        self._serve_private()
    def _get_file(self, request: Request, file_path: str) -> str:
        if (
            "/buttons/" in file_path
            and request.headers.get("User-Agent") == EIGHTY_EIGHT_THIRTY_ONE_SCRAPER_AGENT
            and not file_path.endswith(":png")
        ):
            return self._served_files.get(file_path.split(":")[0] + ":png", "")
        if file_path in self._served_files:
            path = self._served_files[file_path]
        elif "/images/" in file_path and not file_path.endswith((":png", ":avif", ":anim")):
            path = self._served_files.get(f"{file_path}:avif", "")
        else:
            path = self._served_files.get(file_path, "")
        return f"/{path}" if path else ""

    def _get_file_type(self, request: Request, file_path: str) -> str:
        import mimetypes

        mime_type, _ = mimetypes.guess_type(file_path)
        return mime_type or "application/octet-stream"

    def serve_template(self, template_name: str, status_code: HTTPStatus, context: dict) -> Response:
        from abi.api.proxy import media_proxy_url
        from abi.api.lanyard import (
            avatar_url, avatar_decoration_url, banner_url,
            guild_badge_url, activity_asset_url, int_to_hex,
        )
        template = self.get_template(template_name)
        template.globals.update({
            "get_file": partial(self._get_file, context['request']),
            "get_file_type": partial(self._get_file_type, context['request']),
            "most_recent_commit_hash": self._most_recent_commit_hash,
            "hotlink_domain": random.choice(["abigail", "phoebe", "abigail.phoebe"]),
            "media_proxy_url": media_proxy_url,
            "avatar_url": avatar_url,
            "avatar_decoration_url": avatar_decoration_url,
            "banner_url": banner_url,
            "guild_badge_url": guild_badge_url,
            "activity_asset_url": activity_asset_url,
            "int_to_hex": int_to_hex,
            "current_weather": self.weather,
        })
        template_content = template.render(context)
        return Response(
            content=template_content,
            media_type="text/html",
            status_code=status_code,
        )


os.makedirs("_served/templates", exist_ok=True)
for file in os.listdir("src/abi/templates"):
    shutil.copyfile(f"src/abi/templates/{file}", f"_served/templates/{file}")
for file in os.listdir("src/abi/private/templates"):
    shutil.copyfile(f"src/abi/private/templates/{file}", f"_served/templates/priv__{file}")


templates = TemplateServer(
    directory="_served/templates",
)
