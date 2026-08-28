import base64
import mimetypes
from pathlib import Path

from jinja2 import Environment, FileSystemLoader


__all__: tuple[str, ...] = (
    "render_resume_pdf",
)


OUT_PATH = Path("_served/static/resume.pdf")
TEMPLATES_DIR = "src/abi/templates"
PUBLIC_DIR = Path("src/abi/public")


def get_file(file_path: str) -> str:
    full_path = PUBLIC_DIR / file_path.removeprefix("public/")
    if not full_path.exists():
        return ""
    mime_type, _ = mimetypes.guess_type(str(full_path))
    mime_type = mime_type or "application/octet-stream"
    b64 = base64.b64encode(full_path.read_bytes()).decode()
    return f"data:{mime_type};base64,{b64}"


async def render_resume_pdf() -> None:
    from playwright.async_api import async_playwright

    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR))
    html = env.get_template("resume_printable.jinja2").render(get_file=get_file)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"[render-resume] rendering → {OUT_PATH}")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            page = await browser.new_page()
            await page.set_content(html, wait_until="networkidle")
            await page.pdf(
                path=str(OUT_PATH),
                format="A4",
                print_background=True,
                margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
            )
            print("[render-resume] done.")
        finally:
            await browser.close()
