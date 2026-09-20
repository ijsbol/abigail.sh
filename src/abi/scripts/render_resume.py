import base64
import hashlib
import mimetypes
from pathlib import Path

from jinja2 import Environment, FileSystemLoader


__all__: tuple[str, ...] = (
    "render_resume_pdf",
)


OUT_PATH = Path("_served/static/resume.pdf")
INPUTS_PATH = OUT_PATH.with_suffix(".inputs")
TEMPLATES_DIR = "src/abi/templates"
PUBLIC_DIR = Path("src/abi/public")
PRIVATE_PUBLIC_DIR = Path("src/abi/private/public")
RENDERER_VERSION = "4"


FILE_ROOTS = {
    "private/public/": PRIVATE_PUBLIC_DIR,
    "public/": PUBLIC_DIR,
}


def get_file(file_path: str) -> str:
    full_path = next(
        (
            root / file_path.removeprefix(prefix)
            for prefix, root in FILE_ROOTS.items()
            if file_path.startswith(prefix)
        ),
        None,
    )
    if full_path is None or not full_path.is_file():
        return ""
    mime_type, _ = mimetypes.guess_type(str(full_path))
    mime_type = mime_type or "application/octet-stream"
    b64 = base64.b64encode(full_path.read_bytes()).decode()
    return f"data:{mime_type};base64,{b64}"


def _resume_inputs() -> tuple[Path, ...]:
    return (
        Path(TEMPLATES_DIR) / "resume_printable.jinja2",
        PRIVATE_PUBLIC_DIR / "fonts/JMH-Typewriter-mono.woff2",
    )


def _input_digest() -> str:
    digest = hashlib.sha256(RENDERER_VERSION.encode())
    for input_path in _resume_inputs():
        digest.update(str(input_path).encode())
        if input_path.is_file():
            digest.update(input_path.read_bytes())
        else:
            digest.update(b"<missing>")
    return digest.hexdigest()


def _needs_render() -> bool:
    if not OUT_PATH.is_file() or not INPUTS_PATH.is_file():
        return True
    return INPUTS_PATH.read_text().strip() != _input_digest()


async def render_resume_pdf() -> None:
    if not _needs_render():
        print(f"[render-resume] skipping render, file already exists → {OUT_PATH}")
        return
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
            await page.evaluate("document.fonts.ready")
            page_size = await page.evaluate(
                """() => ({
                    width: Math.ceil(document.querySelector('.resume').getBoundingClientRect().width),
                    height: Math.ceil(document.documentElement.scrollHeight),
                })"""
            )
            await page.pdf(
                path=str(OUT_PATH),
                width=f"{page_size['width']}px",
                height=f"{page_size['height']}px",
                print_background=True,
                margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
            )
            INPUTS_PATH.write_text(_input_digest() + "\n")
            print("[render-resume] done.")
        finally:
            await browser.close()
