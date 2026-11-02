"""Unit tests for engine skip-at-pause (REQ-3.2.2.2).

Contract:
    - ``skip_current_block(session_id)`` marks the paused node as
      ``skipped`` in the session, advances the engine to the next node,
      and re-enters the paused state BEFORE executing the next node.
    - The skipped node DOES NOT execute.
    - The engine emits a fresh ``debug_breakpoint_hit`` event for the
      next node's pause (with the appropriate reason).
"""

import asyncio
from typing import Any

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service


def _make_session(session_id: str, *, breakpoints: set[str] | None = None) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Skip-at-Pause Test",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "scope_failed": False,
        "breakpoints": set(breakpoints or set()),
        "debug_options": None,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
        "skipped_node_ids": [],
    }


def _log_node(node_id: str, label: str, message: str = "'ok'") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"message": message, "level": "INFO"},
                "profileBindings": [],
            },
            "disabled": False,
            "displayName": label,
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


class TestEngineSkipAtPause:
    """Skip from paused state advances the engine and re-pauses."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self) -> Any:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        _wb_common._clear_sessions_sync()
        yield
        _wb_common._clear_sessions_sync()

    @pytest.mark.asyncio
    async def test_skip_marks_paused_node_skipped_and_re_pauses(self) -> None:
        """Skip-at-pause marks paused node skipped, advances, re-pauses at next."""
        session_id = "dbg-skip-1"
        session = _make_session(session_id, breakpoints={"node-b", "node-c"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _log_node("node-a", "A", "'a'"),
            _log_node("node-b", "B", "'b'"),
            _log_node("node-c", "C", "'c'"),
        ]
        edges = [
            {"source": "start-node", "target": "node-a"},
            {"source": "node-a", "target": "node-b"},
            {"source": "node-b", "target": "node-c"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "node-b":
                break
        assert session["status"] == "paused"
        assert session["paused_node_id"] == "node-b"

        workbench_service.skip_current_block(session_id=session_id)

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "node-c":
                break

        assert session["status"] == "paused", "engine must re-pause at next node"
        assert session["paused_node_id"] == "node-c"
        assert session["block_states"].get("node-b") == "skipped"
        assert (
            session["block_states"].get("node-c") != "passed"
        ), "next node must not have executed yet"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)

        assert session["status"] == "passed"
        assert session["block_states"]["node-b"] == "skipped"
        assert session["block_states"]["node-c"] == "passed"

    @pytest.mark.asyncio
    async def test_skip_returns_paused_status_and_skipped_node_id(self) -> None:
        """Service returns 200 payload with skipped_node_id matching paused node."""
        session_id = "dbg-skip-2"
        session = _make_session(session_id, breakpoints={"node-b"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _log_node("node-a", "A", "'a'"),
            _log_node("node-b", "B", "'b'"),
        ]
        edges = [
            {"source": "start-node", "target": "node-a"},
            {"source": "node-a", "target": "node-b"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("status") == "paused":
                break

        result = workbench_service.skip_current_block(session_id=session_id)

        assert result["session_id"] == session_id
        assert result["status"] == "paused"
        assert result["skipped_node_id"] == "node-b"

        # Allow engine to wind down (last node was skipped, nothing else to run)
        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("status") in {"passed", "failed", "stopped"}:
                break
            if session.get("status") == "paused" and session.get("paused_node_id") not in (
                None,
                "node-b",
            ):
                session["pause_event"].set()

        if not task.done():
            session["pause_event"].set()
            await asyncio.wait_for(task, timeout=5.0)

    @pytest.mark.asyncio
    async def test_skip_raises_lookup_error_when_session_missing(self) -> None:
        """``skip_current_block`` raises LookupError for an unknown session."""
        missing = "missing-session-id"
        with pytest.raises(LookupError) as exc_info:
            workbench_service.skip_current_block(session_id=missing)
        assert f"Workbench session '{missing}' not found" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_skip_raises_conflict_when_session_not_paused(self) -> None:
        """``skip_current_block`` rejects non-paused sessions with the exact 409 text."""
        from wavecore.api.exceptions import ConflictException

        session_id = "dbg-skip-3"
        session = _make_session(session_id)
        session["status"] = "running"
        _wb_common._workbench_sessions[session_id] = session

        with pytest.raises(ConflictException) as exc_info:
            workbench_service.skip_current_block(session_id=session_id)
        assert "Cannot skip: session is 'running', not paused" in str(exc_info.value)
