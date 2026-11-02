"""Workbench session-ownership heartbeat, staleness, and disconnect release.

Covers ownership.sweep_stale / ownership.on_connection_lost and the WebSocketManager
disconnect path that releases a bound holder.
"""

import asyncio
import contextlib
import json
from unittest.mock import AsyncMock, MagicMock, call, patch

from fastapi import WebSocket

from wavecore.api.services.workbench import ownership
from wavecore.api.websocket import WebSocketManager


class TestSweepStale:
    async def test_stale_watched_holder_is_released_and_emits(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership._watchers = 1
            ownership._holder["last_heartbeat"] = 100.0
            mock_emit.reset_mock()

            ownership.sweep_stale(100.0 + ownership.HOLDER_TIMEOUT_SECONDS + 1.0)

            assert ownership.get_holder() is None
            mock_emit.assert_called_once_with({"event": "holder_changed", "holder": None})

    async def test_stale_but_unwatched_holder_is_retained(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership._watchers = 0
            ownership._holder["last_heartbeat"] = 100.0
            mock_emit.reset_mock()

            ownership.sweep_stale(100.0 + ownership.HOLDER_TIMEOUT_SECONDS + 1.0)

            assert ownership.get_holder() is not None
            assert ownership.get_holder()["id"] == "h1"
            mock_emit.assert_not_called()

    async def test_watched_holder_within_timeout_is_retained(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership._watchers = 1
            ownership._holder["last_heartbeat"] = 100.0
            mock_emit.reset_mock()

            ownership.sweep_stale(100.0 + ownership.HOLDER_TIMEOUT_SECONDS - 1.0)

            assert ownership.get_holder() is not None
            assert ownership.get_holder()["id"] == "h1"
            mock_emit.assert_not_called()

    async def test_stale_holder_frees_the_slot_rather_than_granting_a_pending_request(
        self,
    ) -> None:
        """A pending requester may itself be gone, so a sweep frees rather than hands over."""
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership.request_takeover("r1", "Requester One")
            ownership._watchers = 1
            ownership._holder["last_heartbeat"] = 100.0
            mock_emit.reset_mock()

            ownership.sweep_stale(100.0 + ownership.HOLDER_TIMEOUT_SECONDS + 1.0)

            assert ownership.get_holder() is None
            assert mock_emit.call_args_list == [call({"event": "holder_changed", "holder": None})]

    async def test_sweep_when_free_is_a_no_op(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.sweep_stale(1000.0)

            assert ownership.get_holder() is None
            mock_emit.assert_not_called()


class TestConnectionLost:
    async def test_holder_connection_lost_releases_and_emits(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            mock_emit.reset_mock()

            ownership.on_connection_lost("h1")

            assert ownership.get_holder() is None
            mock_emit.assert_called_once_with({"event": "holder_changed", "holder": None})

    async def test_other_connection_lost_retains_holder(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            mock_emit.reset_mock()

            ownership.on_connection_lost("other")

            assert ownership.get_holder() is not None
            assert ownership.get_holder()["id"] == "h1"
            mock_emit.assert_not_called()

    async def test_lost_connection_frees_the_slot_rather_than_granting_a_pending_request(
        self,
    ) -> None:
        """A pending requester may itself be gone, so a lost socket frees the slot."""
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "H1", "person")
            ownership.request_takeover("r1", "Requester One")
            mock_emit.reset_mock()

            ownership.on_connection_lost("h1")

            assert ownership.get_holder() is None
            assert mock_emit.call_args_list == [call({"event": "holder_changed", "holder": None})]

    async def test_connection_lost_when_free_is_a_no_op(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.on_connection_lost("ghost")

            assert ownership.get_holder() is None
            mock_emit.assert_not_called()


class TestDisconnectReleases:
    async def test_disconnect_releases_bound_holder(self) -> None:
        with patch.object(ownership, "_emit"):
            manager = WebSocketManager()
            ws = AsyncMock(spec=WebSocket)
            ws.accept = AsyncMock()
            ws.send_json = AsyncMock()
            ws.__len__ = MagicMock(return_value=1)

            conn_id = await manager.connect(ws)
            await manager.handle_message(
                conn_id,
                json.dumps({"type": "identify", "holderId": "h1", "clientType": "workbench"}),
            )
            assert manager._connection_holders[conn_id] == "h1"

            ownership.claim("h1", "H1", "person")
            assert ownership.get_holder() is not None

            manager.handle_disconnect(conn_id)

            assert ownership.get_holder() is None
            assert conn_id not in manager._connection_holders


class TestSweepLoop:
    """The startup background loop releases dead holders on its interval."""

    async def test_loop_releases_stale_holder(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "H1", "person")
            ownership._watchers = 1
            ownership._holder["last_heartbeat"] = -10_000.0

            task = asyncio.create_task(ownership.run_stale_sweep_loop(interval=60.0))
            await asyncio.sleep(0)
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

        assert ownership.get_holder() is None
