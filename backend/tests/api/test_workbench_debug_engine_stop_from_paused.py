"""Unit tests for Stop from paused state (REQ-3.2.2.4, POST /workbench/{id}/stop).

Contract:
    - ``stop_workbench_run(session_id)`` terminates a paused session
      just as it terminates a running one.
    - After stop, session status is ``stopped`` and ``paused_node_id``
      is cleared.
    - The engine task exits cleanly (no hang on ``pause_event.wait()``).
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
        "test_name": "Stop-from-Paused Test",
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


class TestStopFromPausedState:
    """Stop works from paused just as it works from running."""

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
    async def test_stop_from_paused_terminates_session_with_stopped_status(self) -> None:
        """``stop_workbench_run`` from paused leaves status=stopped."""
        session_id = "dbg-stop-1"
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
        _wb_common._active_tasks[session_id] = task

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("status") == "paused":
                break

        result = workbench_service.stop_workbench_run(session_id=session_id)

        assert result["session_id"] == session_id
        assert result["status"] == "stopped"

        try:
            await asyncio.wait_for(task, timeout=5.0)
        except asyncio.CancelledError:
            pass

        assert session["status"] == "stopped"
        assert session["block_states"].get("node-c") != "passed"

    @pytest.mark.asyncio
    async def test_stop_from_paused_does_not_execute_paused_node(self) -> None:
        """Stop from paused aborts before the paused node runs."""
        session_id = "dbg-stop-2"
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
        _wb_common._active_tasks[session_id] = task

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("status") == "paused":
                break

        workbench_service.stop_workbench_run(session_id=session_id)

        try:
            await asyncio.wait_for(task, timeout=5.0)
        except asyncio.CancelledError:
            pass

        assert session["status"] == "stopped"
        assert (
            session["block_states"].get("node-b") != "passed"
        ), "paused (breakpointed) node must not execute when Stop is issued from paused"

    @pytest.mark.asyncio
    async def test_stop_from_paused_raises_lookup_error_for_missing_session(self) -> None:
        """Stop on an unknown session raises LookupError (same as from running)."""
        with pytest.raises(LookupError) as exc_info:
            workbench_service.stop_workbench_run(session_id="nope")
        assert "Workbench session 'nope' not found" in str(exc_info.value)
