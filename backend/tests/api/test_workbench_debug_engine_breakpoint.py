"""Unit tests for engine-level breakpoint pause behavior (REQ-3.2.2.1).

Contract:
    - Before executing a node whose id is in ``session["breakpoints"]``,
      the engine pauses: sets ``session["status"] = "paused"``,
      records ``session["paused_node_id"]``, emits a
      ``debug_breakpoint_hit`` WebSocket event with
      ``reason: "breakpoint"``, and awaits ``session["pause_event"]``.
    - Until the event is set, the breakpointed node must NOT execute.
    - On Continue (``pause_event`` set), the engine resumes by running
      the previously-paused node and proceeding to its successors.
"""

import asyncio
from typing import Any
from unittest.mock import patch

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service


def _make_session(
    session_id: str,
    *,
    breakpoints: set[str] | None = None,
    debug_options: dict[str, bool] | None = None,
) -> dict[str, Any]:
    """Create a debug-aware workbench session for engine tests."""
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Breakpoint Test",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "scope_failed": False,
        "breakpoints": set(breakpoints or set()),
        "debug_options": debug_options,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
    }


def _log_node(node_id: str, label: str, message: str = "'ok'") -> dict[str, Any]:
    """Create a simple Log-plugin node."""
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


class TestEngineBreakpointPause:
    """Engine pauses at a breakpointed node and waits for Continue."""

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
    async def test_engine_pauses_before_executing_breakpointed_node(self) -> None:
        """Engine halts at the breakpointed node until ``pause_event`` is set."""
        session_id = "dbg-bp-1"
        session = _make_session(session_id, breakpoints={"node-b"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _log_node("node-a", "Before BP", "'a'"),
            _log_node("node-b", "At BP", "'b'"),
            _log_node("node-c", "After BP", "'c'"),
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

        assert session["status"] == "paused", "engine must pause on reaching a breakpointed node"
        assert session["paused_node_id"] == "node-b"
        assert session["block_states"].get("node-a") == "passed"
        assert (
            session["block_states"].get("node-b") != "passed"
        ), "breakpointed node must not have executed yet"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)

        assert session["status"] == "passed"
        assert session["block_states"]["node-b"] == "passed"
        assert session["block_states"]["node-c"] == "passed"

    @pytest.mark.asyncio
    async def test_engine_emits_debug_breakpoint_hit_with_reason_breakpoint(self) -> None:
        """WebSocket event fires with ``reason: "breakpoint"`` and the node metadata."""
        session_id = "dbg-bp-2"
        session = _make_session(session_id, breakpoints={"node-b"})
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _log_node("node-a", "Before BP", "'a'"),
            _log_node("node-b", "At BP", "'b'"),
        ]
        edges = [
            {"source": "start-node", "target": "node-a"},
            {"source": "node-a", "target": "node-b"},
        ]

        captured_events: list[dict[str, Any]] = []
        original_broadcast = _wb_common._broadcast_event

        async def capture(_sid: str, event: dict[str, Any]) -> None:
            captured_events.append(event)
            await original_broadcast(_sid, event)

        with patch.object(_wb_common, "_broadcast_event", side_effect=capture):
            task = asyncio.create_task(
                workbench_service._execute_workflow(session_id, nodes, edges, {})
            )

            for _ in range(200):
                await asyncio.sleep(0.01)
                if session.get("status") == "paused":
                    break

            hits = [e for e in captured_events if e.get("type") == "debug_breakpoint_hit"]
            assert (
                len(hits) == 1
            ), f"expected exactly one debug_breakpoint_hit event; got {len(hits)}"
            hit = hits[0]
            assert hit["reason"] == "breakpoint"
            assert hit["node_id"] == "node-b"
            assert hit["node_name"] == "At BP"
            assert hit.get("exception_class") is None
            assert hit.get("exception_message") is None

            session["pause_event"].set()
            await asyncio.wait_for(task, timeout=5.0)

    @pytest.mark.asyncio
    async def test_engine_does_not_pause_on_non_breakpointed_nodes(self) -> None:
        """Nodes not in the breakpoint set execute without pausing."""
        session_id = "dbg-bp-3"
        session = _make_session(session_id, breakpoints=set())
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _log_node("node-a", "A", "'a'"),
            _log_node("node-b", "B", "'b'"),
        ]
        edges = [
            {"source": "start-node", "target": "node-a"},
            {"source": "node-a", "target": "node-b"},
        ]

        await asyncio.wait_for(
            workbench_service._execute_workflow(session_id, nodes, edges, {}),
            timeout=5.0,
        )

        assert session["status"] == "passed"
        assert session["block_states"]["node-a"] == "passed"
        assert session["block_states"]["node-b"] == "passed"
        assert session.get("paused_node_id") is None

    @pytest.mark.asyncio
    async def test_engine_pauses_at_every_breakpoint_in_sequence(self) -> None:
        """Two breakpoints -> engine pauses twice, once per breakpoint."""
        session_id = "dbg-bp-4"
        session = _make_session(session_id, breakpoints={"node-a", "node-b"})
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

        # First pause at node-a
        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("status") == "paused":
                break
        assert session["paused_node_id"] == "node-a"

        session["pause_event"].set()

        # Second pause at node-b
        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("paused_node_id") == "node-b" and session["status"] == "paused":
                break
        assert session["paused_node_id"] == "node-b"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)
        assert session["status"] == "passed"
