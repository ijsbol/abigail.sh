import hashlib
from http import HTTPStatus
import os
from pathlib import Path
import random
import shutil
from typing import Final

from fastapi import Response
from fastapi.templating import Jinja2Templates
from PIL import Image
from rcssmin import cssmin
from rjsmin import jsmin


__all__: tuple[str, ...] = (
    "templates",
)


SPECIFICALLY_INCLDUED_FILES: Final[list[str]] = [
    "images/external-link-svgrepo-com.svg",
    "images/download-button-svgrepo-com.svg",
]


class TemplateServer(Jinja2Templates):
    def __init__(self, directory: str) -> None:
        self._served_files: dict[str, str] = {}
        super().__init__(directory=directory)
        self.env.filters["intcomma"] = lambda x: f"{int(x):,}"

    def _serve_images(self) -> None:
        image_dir = "src/abi/public/images"
        for dirpath, _, filenames in os.walk(image_dir):
            rel_dir = os.path.relpath(dirpath, image_dir)
            if rel_dir == "writing":
                continue
            out_dir = os.path.normpath(os.path.join("_served/static/images", rel_dir))
            os.makedirs(out_dir, exist_ok=True)

            for file in filenames:
                file_name, file_ext = os.path.splitext(file)
                if file_ext not in (".png", ".jpg", ".jpeg", ".gif"):
                    continue

                avif_file_path = f"static/images/{rel_dir}/{file_name}.avif"
                if Path(f"_served/{avif_file_path}").exists():
                    self._served_files[os.path.normpath(f"public/images/{rel_dir}/{file}")] = avif_file_path
                    continue

                image = Image.open(os.path.join(dirpath, file))
                avif_path = os.path.join(out_dir, f"{file_name}.avif")
                image.save(avif_path, optimize=True, quality=50, format="AVIF", save_all=True)

                avif_image = Image.open(avif_path)
                pub_key = os.path.normpath(f"public/images/{rel_dir}/{file}")

                if avif_image.size > image.size:
                    # if the AVIF image is larger than the original, we will serve the original instead.
                    os.remove(avif_path)
                    image.save(os.path.join(out_dir, file), optimize=True, quality=50)
                    self._served_files[pub_key] = os.path.normpath(f"static/images/{rel_dir}/{file}")

                else:
                    self._served_files[pub_key] = os.path.normpath(avif_file_path)

        # specific legacy override for people hot-linking my button on their sites.
        shutil.copyfile("src/abi/public/images/button.png", "_served/static/images/button.png")

    def _serve_css(self) -> None:
        css_dir = "src/abi/public/css"
        os.makedirs("_served/static/css", exist_ok=True)
        for file in os.listdir(css_dir):
            if not file.endswith(".css"):
                continue
            file_name, _ = os.path.splitext(file)
            with open(f"{css_dir}/{file}", "r") as f:
                css_content = f.read()
            minified_css = str(cssmin(css_content))
            md5hash = hashlib.md5(css_content.encode()).hexdigest()[:6]
            new_file_name = f"{file_name}.{md5hash}.css"
            with open(f"_served/static/css/{new_file_name}", "w") as f:
                f.write(str(minified_css))
            self._served_files["public/css/" + file] = f"static/css/{new_file_name}"

    def _serve_js(self) -> None:
        js_dir = "src/abi/public/js"
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
        fonts_dir = "src/abi/public/fonts"
        os.makedirs("_served/static/fonts", exist_ok=True)
        for file in os.listdir(fonts_dir):
            if not file.endswith((".woff", ".woff2", ".ttf", ".otf")):
                continue
            shutil.copyfile(f"{fonts_dir}/{file}", f"_served/static/fonts/{file}")
            self._served_files["public/fonts/" + file] = f"static/fonts/{file}"
        for file in SPECIFICALLY_INCLDUED_FILES:
            shutil.copyfile(f"src/abi/public/{file}", f"_served/static/{file}")
            self._served_files[file] = f"static/{file}"
        data_dir = "src/abi/public/data"
        if os.path.isdir(data_dir):
            os.makedirs("_served/static/data", exist_ok=True)
            for file in os.listdir(data_dir):
                if not file.endswith(".json"):
                    continue
                shutil.copyfile(f"{data_dir}/{file}", f"_served/static/data/{file}")
                self._served_files["public/data/" + file] = f"static/data/{file}"

        # serve the raw public/writing directory
        writing_dir = "src/abi/public/writing"
        if os.path.isdir(writing_dir):
            os.makedirs("_served/static/writing", exist_ok=True)
            for file in os.listdir(writing_dir):
                shutil.copyfile(f"{writing_dir}/{file}", f"_served/static/writing/{file}")
                self._served_files["public/writing/" + file] = f"static/writing/{file}"


    def load(self) -> None:
        print("[templates:start] loading templates and serving static files...")
        self._serve_images()
        print(f"[templates:images] served {len(self._served_files)} static files.")
        self._serve_css()
        print(f"[templates:css] served {len(self._served_files)} static files.")
        self._serve_js()
        print(f"[templates:js] served {len(self._served_files)} static files.")
        self._serve_misc()
        print(f"[templates:misc] served {len(self._served_files)} static files.")

    def _get_file(self, file_path: str) -> str:
        path = self._served_files.get(file_path, "")
        return f"/{path}" if path else ""

    def _get_file_type(self, file_path: str) -> str:
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
            "get_file": self._get_file,
            "get_file_type": self._get_file_type,
            "hotlink_domain": random.choice(["abigail", "phoebe", "abigail.phoebe", "murph", "abigail.phoebe.murph"]),
            "media_proxy_url": media_proxy_url,
            "avatar_url": avatar_url,
            "avatar_decoration_url": avatar_decoration_url,
            "banner_url": banner_url,
            "guild_badge_url": guild_badge_url,
            "activity_asset_url": activity_asset_url,
            "int_to_hex": int_to_hex,
        })
        template_content = template.render(context)
        return Response(
            content=template_content,
            media_type="text/html",
            status_code=status_code,
        )


templates = TemplateServer(
    directory="src/abi/templates",
)
