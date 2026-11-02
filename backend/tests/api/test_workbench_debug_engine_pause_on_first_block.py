"""Unit tests for engine pause-on-first-block (REQ-3.2.2.1).

Contract:
    - When ``debug_options["pause_on_first_block"] == True`` and no
      breakpoints are set, the engine pauses BEFORE executing the first
      executable node.
    - A ``debug_breakpoint_hit`` event fires with ``reason: "first_block"``,
      the first node's id/name, and null exception fields.
    - After Continue the engine proceeds normally through the remaining
      nodes without further first-block pauses.
"""

import asyncio
from typing import Any
from unittest.mock import patch

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service


def _make_session(
    session_id: str, *, debug_options: dict[str, bool] | None = None
) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Pause-on-First Test",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "scope_failed": False,
        "breakpoints": set(),
        "debug_options": debug_options,
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


class TestEnginePauseOnFirstBlock:
    """Engine pauses before the very first executable node when configured."""

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
    async def test_engine_pauses_before_first_executable_node(self) -> None:
        """Engine halts at the first node even when no breakpoints are set."""
        session_id = "dbg-first-1"
        session = _make_session(
            session_id,
            debug_options={"pause_on_first_block": True, "pause_on_errors": False},
        )
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _log_node("node-a", "First", "'a'"),
            _log_node("node-b", "Second", "'b'"),
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

        assert session["status"] == "paused"
        assert session["paused_node_id"] == "node-a"
        assert (
            session["block_states"].get("node-a") != "passed"
        ), "first node must not have executed yet"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)
        assert session["status"] == "passed"
        assert session["block_states"]["node-a"] == "passed"
        assert session["block_states"]["node-b"] == "passed"

    @pytest.mark.asyncio
    async def test_engine_emits_debug_breakpoint_hit_with_reason_first_block(self) -> None:
        """WebSocket event fires with ``reason: "first_block"`` on the first node."""
        session_id = "dbg-first-2"
        session = _make_session(
            session_id,
            debug_options={"pause_on_first_block": True, "pause_on_errors": False},
        )
        _wb_common._workbench_sessions[session_id] = session

        nodes = [_log_node("node-a", "First", "'a'")]
        edges = [{"source": "start-node", "target": "node-a"}]

        captured: list[dict[str, Any]] = []
        original_broadcast = _wb_common._broadcast_event

        async def capture(_sid: str, event: dict[str, Any]) -> None:
            captured.append(event)
            await original_broadcast(_sid, event)

        with patch.object(_wb_common, "_broadcast_event", side_effect=capture):
            task = asyncio.create_task(
                workbench_service._execute_workflow(session_id, nodes, edges, {})
            )

            for _ in range(200):
                await asyncio.sleep(0.01)
                if session.get("status") == "paused":
                    break

            hits = [e for e in captured if e.get("type") == "debug_breakpoint_hit"]
            assert len(hits) == 1
            assert hits[0]["reason"] == "first_block"
            assert hits[0]["node_id"] == "node-a"
            assert hits[0]["node_name"] == "First"
            assert hits[0].get("exception_class") is None
            assert hits[0].get("exception_message") is None

            session["pause_event"].set()
            await asyncio.wait_for(task, timeout=5.0)

    @pytest.mark.asyncio
    async def test_engine_only_pauses_once_for_first_block(self) -> None:
        """After Continue the engine does not emit another first_block pause."""
        session_id = "dbg-first-3"
        session = _make_session(
            session_id,
            debug_options={"pause_on_first_block": True, "pause_on_errors": False},
        )
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _log_node("node-a", "First", "'a'"),
            _log_node("node-b", "Second", "'b'"),
            _log_node("node-c", "Third", "'c'"),
        ]
        edges = [
            {"source": "start-node", "target": "node-a"},
            {"source": "node-a", "target": "node-b"},
            {"source": "node-b", "target": "node-c"},
        ]

        captured: list[dict[str, Any]] = []
        original_broadcast = _wb_common._broadcast_event

        async def capture(_sid: str, event: dict[str, Any]) -> None:
            captured.append(event)
            await original_broadcast(_sid, event)

        with patch.object(_wb_common, "_broadcast_event", side_effect=capture):
            task = asyncio.create_task(
                workbench_service._execute_workflow(session_id, nodes, edges, {})
            )

            for _ in range(200):
                await asyncio.sleep(0.01)
                if session.get("status") == "paused":
                    break

            session["pause_event"].set()
            await asyncio.wait_for(task, timeout=5.0)

            first_block_hits = [
                e
                for e in captured
                if e.get("type") == "debug_breakpoint_hit" and e.get("reason") == "first_block"
            ]
            assert len(first_block_hits) == 1, "first_block pause should fire exactly once per run"

    @pytest.mark.asyncio
    async def test_engine_does_not_pause_when_option_false(self) -> None:
        """With ``pause_on_first_block=False`` the engine runs straight through."""
        session_id = "dbg-first-4"
        session = _make_session(
            session_id,
            debug_options={"pause_on_first_block": False, "pause_on_errors": False},
        )
        _wb_common._workbench_sessions[session_id] = session

        nodes = [_log_node("node-a", "First", "'a'")]
        edges = [{"source": "start-node", "target": "node-a"}]

        await asyncio.wait_for(
            workbench_service._execute_workflow(session_id, nodes, edges, {}),
            timeout=5.0,
        )

        assert session["status"] == "passed"
        assert session["block_states"]["node-a"] == "passed"
        assert session.get("paused_node_id") is None
