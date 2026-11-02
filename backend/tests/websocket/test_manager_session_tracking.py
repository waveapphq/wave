"""WS-manager browser-session tracking (REQ-5.2.7.15).

The manager captures client host + user-agent on connect, registers a browser
row on ``identify``, touches it on meaningful frames (not keepalive), removes it
without a tombstone on disconnect, rejects tombstoned reconnects, and sends a
``session_terminated`` frame on admin terminate. Imports are lazy so the suite
still collects.
"""

import asyncio
import contextlib
import json
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import WebSocket

_UA_CHROME_MACOS = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _local_reset() -> None:
    with contextlib.suppress(ImportError):
        from wavecore.api.websocket import session_registry

        session_registry.clear_sessions()
    with contextlib.suppress(ImportError):
        from wavecore.api.services.workbench import ownership
        from wavecore.api.websocket import events

        ownership.clear()
        events._emit_tasks.clear()


@pytest.fixture(autouse=True)
def _local_reset_session_registry() -> Generator[None, None, None]:
    """Clear the registry even when this file runs without the dir conftest."""
    _local_reset()
    yield
    _local_reset()


def _ws(host: str | None = "192.0.2.7", ua: str | None = _UA_CHROME_MACOS) -> AsyncMock:
    """WebSocket-shaped mock carrying a client host and user-agent header."""
    ws = AsyncMock(spec=WebSocket)
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    ws.close = AsyncMock()
    ws.__len__ = MagicMock(return_value=1)
    ws.client = MagicMock(host=host) if host is not None else None
    ws.headers = {"user-agent": ua}
    return ws


def _identify(holder_id: str) -> str:
    return json.dumps({"type": "identify", "holderId": holder_id, "clientType": "workbench"})


class TestManagerSessionTracking:
    """Manager mirrors WS identity into the browser-session registry."""

    async def test_identify_registers_row_with_client_label_and_ip(self) -> None:
        """An identify frame registers a row labeled from the UA and client host."""
        from wavecore.api.websocket import WebSocketManager, session_registry

        manager = WebSocketManager()
        ws = _ws()
        conn = await manager.connect(ws)

        await manager.handle_message(conn, _identify("sess-a"))

        rows = session_registry.list_sessions()
        assert len(rows) == 1
        row = rows[0]
        assert row["session_id"] == "sess-a"
        assert row["client"] == "Chrome (macOS)"
        assert row["ip"] == "192.0.2.7"
        assert isinstance(row["connected_at"], str)
        assert isinstance(row["last_activity"], str)

    async def test_meaningful_frame_touches_session(self) -> None:
        """A subscribe frame from an identified connection touches its row."""
        from wavecore.api.websocket import WebSocketManager, session_registry

        manager = WebSocketManager()
        ws = _ws()
        conn = await manager.connect(ws)
        await manager.handle_message(conn, _identify("sess-a"))

        with patch.object(session_registry, "touch_session") as touch:
            await manager.handle_message(conn, json.dumps({"type": "subscribe", "topic": "logs"}))

        touch.assert_called_with("sess-a")

    async def test_keepalive_pong_does_not_touch(self) -> None:
        """A keepalive pong frame does not touch the session row."""
        from wavecore.api.websocket import WebSocketManager, session_registry

        manager = WebSocketManager()
        ws = _ws()
        conn = await manager.connect(ws)
        await manager.handle_message(conn, _identify("sess-a"))

        with patch.object(session_registry, "touch_session") as touch:
            await manager.handle_message(conn, json.dumps({"type": "pong"}))

        touch.assert_not_called()

    async def test_disconnect_removes_row_without_tombstone(self) -> None:
        """Disconnect removes the row and leaves no tombstone (auto-reconnect ok)."""
        from wavecore.api.websocket import WebSocketManager, session_registry

        manager = WebSocketManager()
        ws = _ws()
        conn = await manager.connect(ws)
        await manager.handle_message(conn, _identify("sess-a"))

        manager.handle_disconnect(conn)

        assert all(row["session_id"] != "sess-a" for row in session_registry.list_sessions())
        assert session_registry.is_session_closed("sess-a") is False

    async def test_tombstoned_reconnect_is_rejected(self) -> None:
        """A reconnect for a tombstoned id is closed and never re-registered."""
        from wavecore.api.websocket import WebSocketManager, session_registry

        manager = WebSocketManager()
        ws1 = _ws()
        conn1 = await manager.connect(ws1)
        await manager.handle_message(conn1, _identify("sess-a"))

        session_registry.close_session("sess-a")

        ws2 = _ws()
        conn2 = await manager.connect(ws2)
        await manager.handle_message(conn2, _identify("sess-a"))

        ws2.close.assert_awaited()
        assert all(row["session_id"] != "sess-a" for row in session_registry.list_sessions())

    async def test_terminate_session_sends_terminated_frame(self) -> None:
        """Admin terminate sends a session_terminated frame to the target socket."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        ws = _ws()
        conn = await manager.connect(ws)
        await manager.handle_message(conn, _identify("sess-a"))

        ws.send_json.reset_mock()
        await manager.terminate_session("sess-a")

        sent = [call.args[0] for call in ws.send_json.call_args_list if call.args]
        assert any(frame.get("type") == "session_terminated" for frame in sent)

    async def test_missing_client_and_ua_default_to_unknown_browser(self) -> None:
        """A connection with no client and no UA registers ip 'unknown', client 'Browser'."""
        from wavecore.api.websocket import WebSocketManager, session_registry

        manager = WebSocketManager()
        ws = _ws(host=None, ua=None)
        conn = await manager.connect(ws)

        await manager.handle_message(conn, _identify("sess-a"))

        row = session_registry.list_sessions()[0]
        assert row["ip"] == "unknown"
        assert row["client"] == "Browser"

    async def test_terminate_notifies_all_and_survives_a_dead_socket(self) -> None:
        """A stale (dead) + a live connection share a session id; the live one is
        still notified after the dead one's send error is swallowed."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        ws1 = _ws()
        conn1 = await manager.connect(ws1)
        await manager.handle_message(conn1, _identify("sess-a"))
        ws2 = _ws()
        conn2 = await manager.connect(ws2)
        await manager.handle_message(conn2, _identify("sess-a"))

        ws1.send_json = AsyncMock(side_effect=RuntimeError("half-open"))
        ws2.send_json.reset_mock()
        await manager.terminate_session("sess-a")

        sent = [call.args[0] for call in ws2.send_json.call_args_list if call.args]
        assert any(frame.get("type") == "session_terminated" for frame in sent)

    async def test_terminate_skips_other_sessions(self) -> None:
        """Only connections bearing the target id are notified; others are skipped."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        ws_a = _ws()
        conn_a = await manager.connect(ws_a)
        await manager.handle_message(conn_a, _identify("sess-a"))
        ws_b = _ws()
        conn_b = await manager.connect(ws_b)
        await manager.handle_message(conn_b, _identify("sess-b"))

        ws_a.send_json.reset_mock()
        ws_b.send_json.reset_mock()
        await manager.terminate_session("sess-a")

        sent_a = [c.args[0] for c in ws_a.send_json.call_args_list if c.args]
        assert any(f.get("type") == "session_terminated" for f in sent_a)
        sent_b = [c.args[0] for c in ws_b.send_json.call_args_list if c.args]
        assert not any(f.get("type") == "session_terminated" for f in sent_b)

    async def test_cleanup_stale_connections_removes_the_session_row(self) -> None:
        """A dead connection past the heartbeat window is reaped with its session row."""
        from wavecore.api.websocket import WebSocketManager, session_registry

        manager = WebSocketManager()
        ws = _ws()
        conn = await manager.connect(ws)
        await manager.handle_message(conn, _identify("sess-a"))
        manager._metadata[conn].last_activity = datetime.now(UTC) - timedelta(
            seconds=manager.heartbeat_timeout + 60
        )

        await manager.cleanup_stale_connections()

        assert session_registry.list_sessions() == []
        assert conn not in manager._connection_holders

    async def test_stale_cleanup_loop_reaps_dead_sessions(self) -> None:
        """The background cleanup loop drops a dead connection's roster row."""
        from wavecore.api.websocket import WebSocketManager, session_registry

        manager = WebSocketManager()
        ws = _ws()
        conn = await manager.connect(ws)
        await manager.handle_message(conn, _identify("sess-a"))
        manager._metadata[conn].last_activity = datetime.now(UTC) - timedelta(
            seconds=manager.heartbeat_timeout + 60
        )

        task = asyncio.create_task(manager.run_stale_cleanup_loop())
        for _ in range(10):
            await asyncio.sleep(0)
            if not session_registry.list_sessions():
                break
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

        assert session_registry.list_sessions() == []

    async def test_draft_watcher_ids_lists_subscribed_identified_sessions(self) -> None:
        """Only draft-topic subscribers that have identified count as watchers."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        # subscribed + identified -> included
        ws_a = _ws()
        conn_a = await manager.connect(ws_a)
        await manager.handle_message(conn_a, _identify("sess-a"))
        manager.subscribe(conn_a, "workbench:draft")
        # subscribed but never identified -> no session id -> excluded
        ws_b = _ws()
        conn_b = await manager.connect(ws_b)
        manager.subscribe(conn_b, "workbench:draft")
        # identified but not subscribed to the draft topic -> excluded
        ws_c = _ws()
        conn_c = await manager.connect(ws_c)
        await manager.handle_message(conn_c, _identify("sess-c"))

        assert manager.draft_watcher_ids() == {"sess-a"}

    async def test_a_superseded_connection_is_cleaned_without_evicting_the_tab(self) -> None:
        """The socket the tab refreshed away from is
        reaped long after the tab is back, and must take nothing with it."""
        from wavecore.api.services.workbench import ownership
        from wavecore.api.websocket import WebSocketManager, session_registry

        manager = WebSocketManager()
        old_ws = _ws()
        old_conn = await manager.connect(old_ws)
        await manager.handle_message(old_conn, _identify("tab-1"))
        with patch.object(ownership, "_emit"):
            ownership.claim("tab-1", "Chrome (macOS)", "person")
        new_ws = _ws()
        new_conn = await manager.connect(new_ws)
        await manager.handle_message(new_conn, _identify("tab-1"))

        with patch.object(ownership, "_emit"):
            manager.handle_disconnect(old_conn)

        assert ownership.get_holder() == {
            "id": "tab-1",
            "label": "Chrome (macOS)",
            "kind": "person",
        }
        assert [row["session_id"] for row in session_registry.list_sessions()] == ["tab-1"]
        assert manager._connection_holders[new_conn] == "tab-1"

    async def test_cleaning_the_last_connection_releases_the_holder_and_the_row(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.api.websocket import WebSocketManager, session_registry

        manager = WebSocketManager()
        ws = _ws()
        conn = await manager.connect(ws)
        await manager.handle_message(conn, _identify("tab-1"))
        with patch.object(ownership, "_emit"):
            ownership.claim("tab-1", "Chrome (macOS)", "person")

            manager.handle_disconnect(conn)

        assert ownership.get_holder() is None
        assert session_registry.list_sessions() == []

    async def test_tombstoned_reconnect_tolerates_close_error(self) -> None:
        """A tombstoned reconnect whose close() raises is still rejected cleanly."""
        from wavecore.api.websocket import WebSocketManager, session_registry

        manager = WebSocketManager()
        ws1 = _ws()
        conn1 = await manager.connect(ws1)
        await manager.handle_message(conn1, _identify("sess-a"))
        session_registry.close_session("sess-a")

        ws2 = _ws()
        ws2.close = AsyncMock(side_effect=RuntimeError("already closed"))
        conn2 = await manager.connect(ws2)
        await manager.handle_message(conn2, _identify("sess-a"))

        ws2.close.assert_awaited()
        assert all(row["session_id"] != "sess-a" for row in session_registry.list_sessions())


class TestLeavingFrame:
    """Departure announced on the socket itself, in-order before its close.

    An HTTP beacon races the socket close (and can land after a reload),
    so a departing page also announces on the WebSocket: TCP ordering
    guarantees the reservation is in place before the close is processed.
    """

    async def test_leaving_frame_reserves_instead_of_freeing(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        ws = _ws()
        conn = await manager.connect(ws)
        await manager.handle_message(conn, _identify("tab-1"))
        with patch.object(ownership, "_emit"):
            ownership.claim("tab-1", "Chrome (macOS)", "person")

            await manager.handle_message(conn, json.dumps({"type": "leaving", "holderId": "tab-1"}))

        assert ownership.get_holder() == {
            "id": "tab-1",
            "label": "Chrome (macOS)",
            "kind": "person",
        }

    async def test_the_close_after_a_leaving_frame_keeps_the_reserved_holder(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        ws = _ws()
        conn = await manager.connect(ws)
        await manager.handle_message(conn, _identify("tab-1"))
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("tab-1", "Chrome (macOS)", "person")
            mock_emit.reset_mock()

            await manager.handle_message(conn, json.dumps({"type": "leaving", "holderId": "tab-1"}))
            manager.handle_disconnect(conn)

            assert ownership.get_holder() is not None
            assert ownership.get_holder()["id"] == "tab-1"
            mock_emit.assert_not_called()

    async def test_leaving_frame_removes_the_roster_row(self) -> None:
        from wavecore.api.websocket import WebSocketManager, session_registry

        manager = WebSocketManager()
        ws = _ws()
        conn = await manager.connect(ws)
        await manager.handle_message(conn, _identify("tab-1"))

        await manager.handle_message(conn, json.dumps({"type": "leaving", "holderId": "tab-1"}))

        assert session_registry.list_sessions() == []

    async def test_a_late_leaving_frame_spares_the_reloaded_page(self) -> None:
        """The old page's frame is processed after the reloaded page identified."""
        from wavecore.api.services.workbench import ownership
        from wavecore.api.websocket import WebSocketManager, session_registry

        manager = WebSocketManager()
        old_conn = await manager.connect(_ws())
        new_conn = await manager.connect(_ws())
        with patch.object(ownership, "_emit"):
            for conn, page in ((old_conn, "page-1"), (new_conn, "page-2")):
                await manager.handle_message(
                    conn,
                    json.dumps({"type": "identify", "holderId": "tab-1", "pageId": page}),
                )
                manager.subscribe(conn, "workbench:draft")
            ownership.claim("tab-1", "Chrome (macOS)", "person")

            await manager.handle_message(
                old_conn, json.dumps({"type": "leaving", "holderId": "tab-1"})
            )
            manager.handle_disconnect(old_conn)
            later = ownership._now() + ownership.AWAY_GRACE_SECONDS + 1.0
            with patch.object(ownership, "_now", return_value=later):
                assert ownership.get_holder() is not None

        assert [row["session_id"] for row in session_registry.list_sessions()] == ["tab-1"]
        assert "workbench:draft" in manager._metadata[new_conn].subscriptions

    async def test_leaving_frame_without_holder_id_is_dropped_silently(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        ws = _ws()
        conn = await manager.connect(ws)
        await manager.handle_message(conn, _identify("tab-1"))
        with patch.object(ownership, "_emit"):
            ownership.claim("tab-1", "Chrome (macOS)", "person")

            await manager.handle_message(conn, json.dumps({"type": "leaving"}))

        assert ownership.get_holder() is not None


class TestHasLiveConnection:
    """Reachability lookup behind the connection-loss guard."""

    async def test_an_unknown_id_is_not_reachable(self) -> None:
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()

        assert manager.has_live_connection("nobody") is False

    async def test_an_identified_connection_makes_its_id_reachable(self) -> None:
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        conn = await manager.connect(_ws())
        await manager.handle_message(conn, _identify("sess-a"))

        assert manager.has_live_connection("sess-a") is True

    async def test_another_ids_connection_does_not_make_this_one_reachable(self) -> None:
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        conn = await manager.connect(_ws())
        await manager.handle_message(conn, _identify("sess-a"))

        assert manager.has_live_connection("sess-b") is False

    async def test_the_id_is_unreachable_once_its_only_connection_is_cleaned(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        conn = await manager.connect(_ws())
        await manager.handle_message(conn, _identify("sess-a"))

        with patch.object(ownership, "_emit"):
            manager.handle_disconnect(conn)

        assert manager.has_live_connection("sess-a") is False

    async def test_a_second_connection_keeps_the_id_reachable(self) -> None:
        from wavecore.api.services.workbench import ownership
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        first = await manager.connect(_ws())
        await manager.handle_message(first, _identify("sess-a"))
        second = await manager.connect(_ws())
        await manager.handle_message(second, _identify("sess-a"))

        with patch.object(ownership, "_emit"):
            manager.handle_disconnect(first)

        assert manager.has_live_connection("sess-a") is True

    async def test_a_mapping_whose_socket_is_gone_is_not_reachable(self) -> None:
        """Reachable means a socket is still registered, not that a stale row
        still names the id."""
        from wavecore.api.websocket import WebSocketManager

        manager = WebSocketManager()
        conn = await manager.connect(_ws())
        await manager.handle_message(conn, _identify("sess-a"))
        manager.active_connections.pop(conn)

        assert manager.has_live_connection("sess-a") is False
