"""A client frame holding text UTF-8 cannot write is refused whole (REQ-4.6.9).

The sender gets the error frame a frame that is not valid JSON gets, with the
place of the character, and nothing in the frame is acted on.
"""

import json
from collections.abc import Generator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import WebSocket

from wavecore.api.services.workbench import ownership
from wavecore.api.websocket import WebSocketManager, session_registry


def _refused(where: str) -> str:
    return (
        f"The message has a character at {where} that cannot be encoded as UTF-8, "
        "so it was refused: remove or replace it"
    )


def _ws() -> AsyncMock:
    ws = AsyncMock(spec=WebSocket)
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    ws.__len__ = MagicMock(return_value=1)
    ws.client = MagicMock(host="192.0.2.7")
    ws.headers = {"user-agent": "pytest"}
    return ws


def _draft(label: str) -> str:
    """A draft_update frame from holder h1 as the text a browser sends."""
    snapshot = {"nodes": [{"id": "n1", "data": {"label": label}}], "edges": [], "variables": []}
    return json.dumps({"type": "draft_update", "holderId": "h1", "snapshot": snapshot})


def _sent(ws: AsyncMock) -> list[dict[str, Any]]:
    return [call.args[0] for call in ws.send_json.call_args_list]


@pytest.fixture(autouse=True)
def fresh_state() -> Generator[None, None, None]:
    ownership.clear()
    session_registry.clear_sessions()
    yield
    ownership.clear()
    session_registry.clear_sessions()


@pytest.fixture
async def holder() -> tuple[WebSocketManager, str, AsyncMock]:
    """A manager with one connection whose browser holds the Workbench as h1."""
    manager = WebSocketManager()
    ws = _ws()
    conn_id = await manager.connect(ws)
    with patch.object(ownership, "_emit"):
        ownership.claim("h1", "H1", "person")
    ws.send_json.reset_mock()
    return manager, conn_id, ws


class TestUnencodableFrame:
    async def test_a_draft_holding_a_lone_surrogate_is_refused_and_the_draft_stays(
        self, holder: tuple[WebSocketManager, str, AsyncMock]
    ) -> None:
        manager, conn_id, ws = holder
        await manager.handle_message(conn_id, _draft("Kept"))
        kept = ownership.get_shared_draft()
        ws.send_json.reset_mock()
        frame = _draft("cafe\udce9")
        assert r"cafe\udce9" in frame

        await manager.handle_message(conn_id, frame)

        assert ownership.get_shared_draft() is kept
        [error] = _sent(ws)
        assert (error["type"], error["error_code"], error["message"]) == (
            "error",
            "INVALID_MESSAGE",
            _refused("snapshot.nodes[0].data.label"),
        )
        assert conn_id in manager.active_connections

    async def test_the_error_frame_has_the_shape_of_the_invalid_json_one(
        self, holder: tuple[WebSocketManager, str, AsyncMock]
    ) -> None:
        manager, conn_id, ws = holder

        await manager.handle_message(conn_id, "not valid json{{{")
        await manager.handle_message(conn_id, _draft("cafe\udce9"))

        invalid_json, unencodable = _sent(ws)
        assert invalid_json["message"] == "Invalid JSON format"
        assert set(unencodable) == set(invalid_json)
        assert unencodable["error_code"] == invalid_json["error_code"]

    @pytest.mark.parametrize(
        ("frame", "where"),
        [
            pytest.param(
                {"type": "identify", "holderId": "h\udce9", "clientType": "workbench"},
                "holderId",
                id="identify",
            ),
            pytest.param({"type": "subscribe", "topic": "logs\ud83d"}, "topic", id="subscribe"),
            pytest.param({"type": "pong", "note\udce9": 1}, "note?", id="key"),
            pytest.param("cafe\udce9", "the message", id="the-whole-message"),
        ],
    )
    async def test_no_frame_of_any_kind_is_acted_on(
        self, holder: tuple[WebSocketManager, str, AsyncMock], frame: Any, where: str
    ) -> None:
        manager, conn_id, ws = holder

        await manager.handle_message(conn_id, json.dumps(frame))

        assert [error["message"] for error in _sent(ws)] == [_refused(where)]
        assert session_registry.list_sessions() == []
        assert manager._metadata[conn_id].subscriptions == set()

    async def test_a_character_written_as_two_escapes_is_that_character(
        self, holder: tuple[WebSocketManager, str, AsyncMock]
    ) -> None:
        manager, conn_id, ws = holder
        frame = _draft("ok 😀")
        assert r"\ud83d\ude00" in frame

        await manager.handle_message(conn_id, frame)

        draft = ownership.get_shared_draft()
        assert draft is not None
        assert draft["nodes"][0]["data"]["label"] == "ok 😀"
        assert [sent for sent in _sent(ws) if sent.get("type") == "error"] == []
