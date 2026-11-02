"""Unit tests for engine pause-on-error (REQ-3.2.2.1).

Contract:
    - When ``debug_options["pause_on_errors"] == True`` and a node raises,
      the engine pauses AT the failing node BEFORE the surrounding
      try-catch handler (if any) runs.
    - A ``debug_breakpoint_hit`` event fires with ``reason: "error"``,
      plus ``exception_class`` and ``exception_message`` populated from
      the raised exception.
    - On Continue, normal failure handling resumes (try-catch handler
      runs, or the run fails if there is no handler).
"""

import asyncio
from typing import Any
from unittest.mock import patch

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import node_helpers as _wb_node_helpers
from wavecore.api.services.workbench import service as workbench_service


def _make_session(
    session_id: str, *, debug_options: dict[str, bool] | None = None
) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Pause-on-Error Test",
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


class _PluginBoom(RuntimeError):
    """Plugin-level failure used to simulate a raising node."""


class TestEnginePauseOnError:
    """Engine pauses AT a failing node when ``pause_on_errors=True``."""

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
    async def test_engine_pauses_when_node_raises_and_option_enabled(self) -> None:
        """Engine transitions to paused at the failing node."""
        session_id = "dbg-err-1"
        session = _make_session(
            session_id,
            debug_options={"pause_on_first_block": False, "pause_on_errors": True},
        )
        _wb_common._workbench_sessions[session_id] = session

        nodes = [_log_node("node-err", "Boom")]
        edges = [{"source": "start-node", "target": "node-err"}]

        original_execute = _wb_node_helpers._execute_node

        async def raising_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            if node_id == "node-err":
                raise _PluginBoom("plugin blew up")
            return await original_execute(nf, variables, sid, node_id)

        with patch.object(_wb_node_helpers, "_execute_node", side_effect=raising_execute):
            task = asyncio.create_task(
                workbench_service._execute_workflow(session_id, nodes, edges, {})
            )

            for _ in range(200):
                await asyncio.sleep(0.01)
                if session.get("status") == "paused":
                    break

            assert session["status"] == "paused"
            assert session["paused_node_id"] == "node-err"
            assert (
                session["block_states"].get("node-err") != "failed"
            ), "failure must not be recorded until the user Continues"

            session["pause_event"].set()
            await asyncio.wait_for(task, timeout=5.0)

    @pytest.mark.asyncio
    async def test_engine_emits_debug_breakpoint_hit_with_exception_metadata(self) -> None:
        """WS event carries ``reason: "error"``, ``exception_class``, ``exception_message``."""
        session_id = "dbg-err-2"
        session = _make_session(
            session_id,
            debug_options={"pause_on_first_block": False, "pause_on_errors": True},
        )
        _wb_common._workbench_sessions[session_id] = session

        nodes = [_log_node("node-err", "Boom")]
        edges = [{"source": "start-node", "target": "node-err"}]

        original_execute = _wb_node_helpers._execute_node

        async def raising_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            if node_id == "node-err":
                raise _PluginBoom("plugin blew up")
            return await original_execute(nf, variables, sid, node_id)

        captured: list[dict[str, Any]] = []
        original_broadcast = _wb_common._broadcast_event

        async def capture(_sid: str, event: dict[str, Any]) -> None:
            captured.append(event)
            await original_broadcast(_sid, event)

        with (
            patch.object(_wb_node_helpers, "_execute_node", side_effect=raising_execute),
            patch.object(_wb_common, "_broadcast_event", side_effect=capture),
        ):
            task = asyncio.create_task(
                workbench_service._execute_workflow(session_id, nodes, edges, {})
            )

            for _ in range(200):
                await asyncio.sleep(0.01)
                if session.get("status") == "paused":
                    break

            hits = [e for e in captured if e.get("type") == "debug_breakpoint_hit"]
            assert len(hits) == 1
            hit = hits[0]
            assert hit["reason"] == "error"
            assert hit["node_id"] == "node-err"
            assert hit["node_name"] == "Boom"
            assert hit["exception_class"] == "_PluginBoom"
            assert hit["exception_message"] == "plugin blew up"

            session["pause_event"].set()
            await asyncio.wait_for(task, timeout=5.0)

    @pytest.mark.asyncio
    async def test_engine_does_not_pause_when_option_disabled(self) -> None:
        """With ``pause_on_errors=False`` the engine fails normally."""
        session_id = "dbg-err-3"
        session = _make_session(
            session_id,
            debug_options={"pause_on_first_block": False, "pause_on_errors": False},
        )
        _wb_common._workbench_sessions[session_id] = session

        nodes = [_log_node("node-err", "Boom")]
        edges = [{"source": "start-node", "target": "node-err"}]

        original_execute = _wb_node_helpers._execute_node

        async def raising_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            if node_id == "node-err":
                raise _PluginBoom("plugin blew up")
            return await original_execute(nf, variables, sid, node_id)

        with patch.object(_wb_node_helpers, "_execute_node", side_effect=raising_execute):
            await asyncio.wait_for(
                workbench_service._execute_workflow(session_id, nodes, edges, {}),
                timeout=5.0,
            )

        assert session["status"] == "failed"
        assert session["block_states"]["node-err"] == "failed"
        assert session.get("paused_node_id") is None

    @pytest.mark.asyncio
    async def test_continue_after_error_pause_lets_failure_propagate(self) -> None:
        """After Continue, the engine records the failure and finishes failed."""
        session_id = "dbg-err-4"
        session = _make_session(
            session_id,
            debug_options={"pause_on_first_block": False, "pause_on_errors": True},
        )
        _wb_common._workbench_sessions[session_id] = session

        nodes = [_log_node("node-err", "Boom")]
        edges = [{"source": "start-node", "target": "node-err"}]

        original_execute = _wb_node_helpers._execute_node

        async def raising_execute(nf: Any, variables: Any, sid: str, node_id: str) -> Any:
            if node_id == "node-err":
                raise _PluginBoom("plugin blew up")
            return await original_execute(nf, variables, sid, node_id)

        with patch.object(_wb_node_helpers, "_execute_node", side_effect=raising_execute):
            task = asyncio.create_task(
                workbench_service._execute_workflow(session_id, nodes, edges, {})
            )

            for _ in range(200):
                await asyncio.sleep(0.01)
                if session.get("status") == "paused":
                    break

            session["pause_event"].set()
            await asyncio.wait_for(task, timeout=5.0)

        assert session["status"] == "failed"
        assert session["block_states"]["node-err"] == "failed"
