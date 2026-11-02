"""Auto-yield of a clean idle holder to an assistant claim.

Covers the ownership slot's new holder-dirtiness flag, the ``kind="mcp"``
auto-yield branch of ``claim``, the ``reason`` field on ``holder_changed``, and
the manager's ``draft_state`` inbound frame that feeds the dirtiness gate.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import WebSocket

from wavecore.api.exceptions import ConflictException
from wavecore.api.services.workbench import ownership
from wavecore.api.websocket import WebSocketManager

ALREADY_HELD_MESSAGE = r"^The workbench session is already held$"

PERSON_HOLDER = {"id": "h1", "label": "Holder One", "kind": "person"}
MCP_HOLDER = {"id": "s1", "label": "claude-code (MCP)", "kind": "mcp"}

RUN_STATE = {
    "session_id": "exec-1",
    "test_id": "test-1",
    "test_name": "Nightly Smoke",
    "environment_id": "env-1",
    "environment_name": "Staging",
    "status": "running",
}


def _fresh_ws() -> AsyncMock:
    """WebSocket-shaped mock that also evaluates truthy (``__len__`` != 0)."""
    ws = AsyncMock(spec=WebSocket)
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    ws.__len__ = MagicMock(return_value=1)
    return ws


class TestHolderDirtyFlag:
    """The holder reports its own draft dirtiness; the slot records it."""

    async def test_fresh_person_claim_defaults_to_clean(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")

        assert ownership._holder["dirty"] is False

    async def test_fresh_mcp_claim_defaults_to_clean(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("s1", "claude-code (MCP)", "mcp")

        assert ownership._holder["dirty"] is False

    async def test_holder_can_mark_itself_dirty(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")

        assert ownership.set_holder_dirty("h1", True) is None
        assert ownership._holder["dirty"] is True

    async def test_holder_can_mark_itself_clean_again(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")
        ownership.set_holder_dirty("h1", True)

        ownership.set_holder_dirty("h1", False)

        assert ownership._holder["dirty"] is False

    async def test_non_holder_report_is_ignored(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")

        ownership.set_holder_dirty("intruder", True)

        assert ownership._holder["dirty"] is False

    async def test_report_with_no_holder_is_ignored(self) -> None:
        ownership.set_holder_dirty("ghost", True)

        assert ownership.get_holder() is None

    async def test_a_new_holder_starts_clean_after_a_dirty_predecessor(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")
            ownership.set_holder_dirty("h1", True)
            ownership.release("h1")
            ownership.claim("h2", "Holder Two")

        assert ownership._holder["dirty"] is False


class TestMcpClaimAutoYield:
    """An assistant claim over a clean, idle person holder hands off at once."""

    async def test_mcp_claim_over_clean_idle_person_takes_the_slot(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")

            result = ownership.claim("s1", "claude-code (MCP)", "mcp")

        assert ownership.get_holder() == MCP_HOLDER
        assert result["holder"] == MCP_HOLDER

    async def test_auto_yield_emits_holder_changed_with_reason(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "Holder One")
            mock_emit.reset_mock()

            ownership.claim("s1", "claude-code (MCP)", "mcp")

        mock_emit.assert_called_once_with(
            {"event": "holder_changed", "holder": MCP_HOLDER, "reason": "auto_yield"}
        )

    async def test_auto_yield_recounts_watchers(self) -> None:
        from wavecore.api.app import app

        manager = MagicMock()
        manager.broadcast_to_topic = AsyncMock()
        app.state.ws_manager = manager
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")
            manager.refresh_draft_watchers.reset_mock()

            ownership.claim("s1", "claude-code (MCP)", "mcp")

        manager.refresh_draft_watchers.assert_called_once_with()

    async def test_auto_yield_keeps_the_shared_draft_for_the_new_holder(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")
            snapshot = ownership.apply_draft(
                "h1", {"nodes": [{"id": "n1"}], "edges": [], "variables": []}
            )

            ownership.claim("s1", "claude-code (MCP)", "mcp")

        assert ownership.get_shared_draft() == snapshot

    async def test_auto_yield_resets_dirtiness_for_the_new_holder(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")

            ownership.claim("s1", "claude-code (MCP)", "mcp")

        assert ownership._holder["dirty"] is False

    async def test_mcp_claim_over_a_dirty_person_holder_conflicts(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")
            ownership.set_holder_dirty("h1", True)

            with pytest.raises(ConflictException, match=ALREADY_HELD_MESSAGE):
                ownership.claim("s1", "claude-code (MCP)", "mcp")

        assert ownership.get_holder() == PERSON_HOLDER

    async def test_mcp_claim_over_a_person_holder_with_a_live_run_conflicts(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")
            ownership.set_run_state(RUN_STATE)

            with pytest.raises(ConflictException, match=ALREADY_HELD_MESSAGE):
                ownership.claim("s1", "claude-code (MCP)", "mcp")

        assert ownership.get_holder() == PERSON_HOLDER

    async def test_mcp_claim_yields_again_once_the_run_state_clears(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")
            ownership.set_run_state(RUN_STATE)
            ownership.set_run_state(None)

            ownership.claim("s1", "claude-code (MCP)", "mcp")

        assert ownership.get_holder() == MCP_HOLDER

    async def test_mcp_claim_over_another_mcp_holder_conflicts(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("s1", "claude-code (MCP)", "mcp")

            with pytest.raises(ConflictException, match=ALREADY_HELD_MESSAGE):
                ownership.claim("s2", "other-client (MCP)", "mcp")

        assert ownership.get_holder() == MCP_HOLDER

    async def test_mcp_reclaim_of_its_own_slot_stays_idempotent(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("s1", "claude-code (MCP)", "mcp")
            mock_emit.reset_mock()

            ownership.claim("s1", "claude-code (MCP)", "mcp")

        assert mock_emit.call_count == 0
        assert ownership.get_holder() == MCP_HOLDER

    async def test_mcp_claim_of_a_free_slot_carries_no_reason(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("s1", "claude-code (MCP)", "mcp")

        mock_emit.assert_called_once_with({"event": "holder_changed", "holder": MCP_HOLDER})


class TestPersonClaimNeverAutoYields:
    """Person-to-person flows are unchanged: a held slot still conflicts."""

    async def test_person_claim_over_a_clean_person_holder_conflicts(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")

            with pytest.raises(ConflictException, match=ALREADY_HELD_MESSAGE):
                ownership.claim("h2", "Holder Two")

        assert ownership.get_holder() == PERSON_HOLDER

    async def test_person_claim_over_a_clean_mcp_holder_conflicts(self) -> None:
        with patch.object(ownership, "_emit"):
            ownership.claim("s1", "claude-code (MCP)", "mcp")

            with pytest.raises(ConflictException, match=ALREADY_HELD_MESSAGE):
                ownership.claim("h1", "Holder One")

        assert ownership.get_holder() == MCP_HOLDER

    def test_rest_claim_route_over_a_clean_holder_still_conflicts(self) -> None:
        from fastapi.testclient import TestClient

        from wavecore.api.app import app

        client = TestClient(app)
        client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "h1", "holder_label": "Holder One"},
        )

        response = client.post(
            "/workbench/ownership/claim",
            json={"holder_id": "h2", "holder_label": "Holder Two"},
        )

        assert response.status_code == 409
        assert response.json()["error"]["message"] == "The workbench session is already held"


class TestReleaseReason:
    """A graceful assistant release announces itself so the FE inherits silently."""

    async def test_handoff_release_carries_the_reason(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("s1", "claude-code (MCP)", "mcp")
            mock_emit.reset_mock()

            ownership.release("s1", "handoff")

        mock_emit.assert_called_once_with(
            {"event": "holder_changed", "holder": None, "reason": "handoff"}
        )

    async def test_default_release_carries_no_reason(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "Holder One")
            mock_emit.reset_mock()

            ownership.release("h1")

        mock_emit.assert_called_once_with({"event": "holder_changed", "holder": None})

    async def test_connection_loss_carries_no_reason(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "Holder One")
            mock_emit.reset_mock()

            ownership.on_connection_lost("h1")

        mock_emit.assert_called_once_with({"event": "holder_changed", "holder": None})

    async def test_stale_sweep_carries_no_reason(self) -> None:
        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("h1", "Holder One")
            ownership.set_watchers(1)
            ownership._holder["last_heartbeat"] = 0.0
            mock_emit.reset_mock()

            ownership.sweep_stale(ownership.HOLDER_TIMEOUT_SECONDS + 1.0)

        mock_emit.assert_called_once_with({"event": "holder_changed", "holder": None})

    async def test_handoff_release_with_a_pending_takeover_grants_without_a_reason(self) -> None:
        from unittest.mock import call

        with patch.object(ownership, "_emit") as mock_emit:
            ownership.claim("s1", "claude-code (MCP)", "mcp")
            ownership.request_takeover("r1", "Requester One")
            mock_emit.reset_mock()

            ownership.release("s1", "handoff")

        requester = {"id": "r1", "label": "Requester One", "kind": "person"}
        assert mock_emit.call_args_list == [
            call({"event": "takeover_resolved", "outcome": "granted", "new_holder": requester}),
            call({"event": "holder_changed", "holder": requester}),
        ]


class TestDraftStateFrame:
    """The holder tab reports isDirty transitions over the WebSocket."""

    async def test_holder_frame_records_dirtiness(self) -> None:
        manager = WebSocketManager()
        holder_conn = await manager.connect(_fresh_ws())
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")

        await manager.handle_message(
            holder_conn,
            json.dumps({"type": "draft_state", "holderId": "h1", "dirty": True}),
        )

        assert ownership._holder["dirty"] is True

    async def test_holder_frame_can_clear_dirtiness(self) -> None:
        manager = WebSocketManager()
        holder_conn = await manager.connect(_fresh_ws())
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")
        ownership.set_holder_dirty("h1", True)

        await manager.handle_message(
            holder_conn,
            json.dumps({"type": "draft_state", "holderId": "h1", "dirty": False}),
        )

        assert ownership._holder["dirty"] is False

    async def test_non_holder_frame_is_dropped(self) -> None:
        manager = WebSocketManager()
        other_conn = await manager.connect(_fresh_ws())
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")

        await manager.handle_message(
            other_conn,
            json.dumps({"type": "draft_state", "holderId": "intruder", "dirty": True}),
        )

        assert ownership._holder["dirty"] is False

    async def test_frame_without_dirty_field_is_dropped(self) -> None:
        manager = WebSocketManager()
        holder_conn = await manager.connect(_fresh_ws())
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")
        ownership.set_holder_dirty("h1", True)

        await manager.handle_message(
            holder_conn,
            json.dumps({"type": "draft_state", "holderId": "h1"}),
        )

        assert ownership._holder["dirty"] is True

    async def test_dirty_frame_blocks_the_next_assistant_claim(self) -> None:
        manager = WebSocketManager()
        holder_conn = await manager.connect(_fresh_ws())
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")

            await manager.handle_message(
                holder_conn,
                json.dumps({"type": "draft_state", "holderId": "h1", "dirty": True}),
            )

            with pytest.raises(ConflictException, match=ALREADY_HELD_MESSAGE):
                ownership.claim("s1", "claude-code (MCP)", "mcp")

    async def test_clean_frame_lets_the_next_assistant_claim_through(self) -> None:
        manager = WebSocketManager()
        holder_conn = await manager.connect(_fresh_ws())
        with patch.object(ownership, "_emit"):
            ownership.claim("h1", "Holder One")
            ownership.set_holder_dirty("h1", True)

            await manager.handle_message(
                holder_conn,
                json.dumps({"type": "draft_state", "holderId": "h1", "dirty": False}),
            )

            ownership.claim("s1", "claude-code (MCP)", "mcp")

        assert ownership.get_holder() == MCP_HOLDER
