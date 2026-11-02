"""Unit tests for engine Continue from paused state (REQ-3.2.2.3).

Contract:
    - ``continue_session(session_id)`` sets ``session["pause_event"]`` so
      the engine resumes, runs the previously-paused node, and proceeds
      until the next trigger (breakpoint, error, first-block pause) or
      a terminal status.
    - Returns ``{"session_id", "status": "running"}`` and clears
      ``session["paused_node_id"]``.
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
        "test_name": "Continue Test",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "scope_failed": False,
        "breakpoints": set(breakpoints or set()),
        "debug_options": None,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
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


class TestEngineContinue:
    """Continue unblocks the engine and runs the paused node."""

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
    async def test_continue_runs_paused_node_and_proceeds_to_terminal(self) -> None:
        """Continue executes the previously-paused node and finishes passed."""
        session_id = "dbg-cont-1"
        session = _make_session(session_id, breakpoints={"node-b"})
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
            if session.get("status") == "paused":
                break

        result = workbench_service.continue_session(session_id=session_id)
        assert result["session_id"] == session_id
        assert result["status"] == "running"

        await asyncio.wait_for(task, timeout=5.0)

        assert session["status"] == "passed"
        assert session["block_states"]["node-b"] == "passed"
        assert session["block_states"]["node-c"] == "passed"
        assert session.get("paused_node_id") is None

    @pytest.mark.asyncio
    async def test_continue_stops_at_next_breakpoint(self) -> None:
        """Continue runs until the next breakpoint, then pauses again."""
        session_id = "dbg-cont-2"
        session = _make_session(session_id, breakpoints={"node-b", "node-d"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _log_node("node-a", "A", "'a'"),
            _log_node("node-b", "B", "'b'"),
            _log_node("node-c", "C", "'c'"),
            _log_node("node-d", "D", "'d'"),
        ]
        edges = [
            {"source": "start-node", "target": "node-a"},
            {"source": "node-a", "target": "node-b"},
            {"source": "node-b", "target": "node-c"},
            {"source": "node-c", "target": "node-d"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "node-b":
                break

        workbench_service.continue_session(session_id=session_id)

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "node-d":
                break

        assert session["status"] == "paused"
        assert session["paused_node_id"] == "node-d"
        assert session["block_states"]["node-b"] == "passed"
        assert session["block_states"]["node-c"] == "passed"

        workbench_service.continue_session(session_id=session_id)
        await asyncio.wait_for(task, timeout=5.0)
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_continue_raises_lookup_error_when_session_missing(self) -> None:
        """``continue_session`` raises LookupError with exact message."""
        missing = "missing-session-id"
        with pytest.raises(LookupError) as exc_info:
            workbench_service.continue_session(session_id=missing)
        assert f"Workbench session '{missing}' not found" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_continue_raises_conflict_when_session_not_paused(self) -> None:
        """``continue_session`` rejects non-paused sessions with the exact 409 text."""
        from wavecore.api.exceptions import ConflictException

        session_id = "dbg-cont-3"
        session = _make_session(session_id)
        session["status"] = "running"
        _wb_common._workbench_sessions[session_id] = session

        with pytest.raises(ConflictException) as exc_info:
            workbench_service.continue_session(session_id=session_id)
        assert "Cannot continue: session is 'running', not paused" in str(exc_info.value)
