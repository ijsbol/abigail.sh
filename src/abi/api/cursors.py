import json
import random
from dataclasses import dataclass
from typing_extensions import Final
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect


router = APIRouter()


CURSOR_COLORS: Final[list[str]] = [
    "#ff69b4", "#4ecdc4", "#ffd700", "#ff6b6b",
    "#6bcb77", "#4d96ff", "#ff922b", "#cc5de8",
    "#f06595", "#74c0fc", "#a9e34b", "#ffa94d",
]


@dataclass
class Client:
    ws: WebSocket
    color: str
    page: str = "/"
    x: float = 0.0
    y: float = 0.0
    doc_x: float | None = None
    doc_y: float | None = None
    anchor: dict | None = None


_clients: dict[str, Client] = {}


def _pick_color() -> str:
    used = {c.color for c in _clients.values()}
    available = [c for c in CURSOR_COLORS if c not in used]
    return random.choice(available if available else CURSOR_COLORS)


async def _send(ws: WebSocket, msg: dict) -> None:
    try:
        await ws.send_text(json.dumps(msg))
    except Exception:
        pass


async def _broadcast(msg: dict, exclude_id: str | None = None) -> None:
    data = json.dumps(msg)
    for cid, client in list(_clients.items()):
        if cid != exclude_id:
            try:
                await client.ws.send_text(data)
            except Exception:
                pass


async def _broadcast_counts() -> None:
    pages: dict[str, int] = {}
    for client in _clients.values():
        pages[client.page] = pages.get(client.page, 0) + 1
    msg = {"type": "counts", "global": len(_clients), "pages": pages}
    data = json.dumps(msg)
    for client in _clients.values():
        try:
            await client.ws.send_text(data)
        except Exception:
            pass


@router.websocket("/ws/cursors")
async def cursors_ws(ws: WebSocket) -> None:
    await ws.accept()

    client_id = str(uuid4())
    color = _pick_color()
    client = Client(ws=ws, color=color)
    _clients[client_id] = client

    others = [
        {
            "id": cid,
            "color": c.color,
            "page": c.page,
            "x": c.x,
            "y": c.y,
            "docX": c.doc_x,
            "docY": c.doc_y,
            "anchor": c.anchor,
        }
        for cid, c in _clients.items() if cid != client_id
    ]

    await _send(ws, {"type": "init", "id": client_id, "color": color, "clients": others})
    await _broadcast({"type": "join", "id": client_id, "color": color, "page": "/"}, client_id)
    await _broadcast_counts()

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                continue

            if msg.get("type") == "move":
                x, y = msg.get("x"), msg.get("y")
                if isinstance(x, (int, float)):
                    client.x = max(0.0, min(1.0, float(x)))
                if isinstance(y, (int, float)):
                    client.y = max(0.0, min(1.0, float(y)))

                doc_x, doc_y = msg.get("docX"), msg.get("docY")
                client.doc_x = max(0.0, min(1.0, float(doc_x))) if isinstance(doc_x, (int, float)) else None
                client.doc_y = max(0.0, min(1.0, float(doc_y))) if isinstance(doc_y, (int, float)) else None

                anchor = msg.get("anchor")
                if (
                    anchor
                    and isinstance(anchor.get("selector"), str)
                    and len(anchor["selector"]) <= 2048
                    and isinstance(anchor.get("x"), (int, float))
                    and isinstance(anchor.get("y"), (int, float))
                ):
                    client.anchor = {
                        "selector": anchor["selector"],
                        "x": max(0.0, min(1.0, float(anchor["x"]))),
                        "y": max(0.0, min(1.0, float(anchor["y"]))),
                    }
                else:
                    client.anchor = None

                page = msg.get("page")
                if isinstance(page, str):
                    client.page = page

                await _broadcast({
                    "type": "move",
                    "id": client_id,
                    "x": client.x,
                    "y": client.y,
                    "docX": client.doc_x,
                    "docY": client.doc_y,
                    "anchor": client.anchor,
                    "page": client.page,
                }, client_id)

            elif msg.get("type") == "page":
                page = msg.get("page")
                if isinstance(page, str):
                    client.page = page
                    await _broadcast({"type": "page", "id": client_id, "page": client.page}, client_id)
                    await _broadcast_counts()

    except WebSocketDisconnect:
        pass
    finally:
        _clients.pop(client_id, None)
        await _broadcast({"type": "leave", "id": client_id})
        await _broadcast_counts()
