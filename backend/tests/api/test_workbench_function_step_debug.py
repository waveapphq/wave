"""Engine step-debug semantics for Function instances (REQ-3.2.1.3 / REQ-3.2.1.4).

A Function Block on its canvas is a single-egress composite: one
entry, one sibling-after egress, the same shape the step debugger already
handles for loop / parallel / try-catch parents. The Function's body is
embedded in ``localDefinition`` (not connected to the outer canvas via body
handles), so the body runs through ``execute_function``'s engine walker on the
same session - which means it honors the shared pause flags
(``pause_at_next_node`` / ``step_over_from_node`` / ``breakpoints``) exactly the
way top-level nodes do.

Semantics under test:
    - Step Over a Function: run the whole body as one unit (inner breakpoints
      suppressed), re-pause at the sibling-after egress.
    - Step Into a Function: pause at the first inner body node.
    - Step Into an empty-body Function: degrade to Step Over (pause at the
      sibling-after egress).
    - Skip-at-pause a Function: route past the whole body to the sibling-after
      egress; no diverging-parent 409 (a Function has exactly one egress); the
      body never runs.
    - Repeat Step a Function: re-invoke the body and re-pause in place.
    - Nested Step Into: stepping into a Function whose first body node is itself
      a Function descends another level.

These drive ``_execute_workflow`` directly (the proven harness from
``test_workbench_step_over.py`` / ``test_workbench_step_into.py``) so they do
not depend on the Test save pipeline.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service


def _make_session(session_id: str, *, breakpoints: set[str] | None = None) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Function Step-Debug Test",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "scope_failed": False,
        "breakpoints": set(breakpoints or set()),
        "debug_options": None,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
        "skipped_node_ids": [],
        "websocket_topic": f"workbench:{session_id}",
        "log_topic": f"log:{session_id}",
    }


def _log_node(node_id: str, message: str = "'ok'") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"message": message, "level": "INFO"},
                "profileBindings": [],
                "outputBindings": {},
            },
            "disabled": False,
            "displayName": node_id,
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _local_def(*, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "name": "step_fn",
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": nodes, "edges": edges},
    }


def _function_node(
    node_id: str,
    *,
    local_definition: dict[str, Any],
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": local_definition,
            "config": {"values": {}, "profileBindings": [], "outputBindings": {}},
            "displayName": node_id,
        },
    }


async def _wait_for_pause(session: dict[str, Any], node_id: str, *, ticks: int = 400) -> None:
    for _ in range(ticks):
        await asyncio.sleep(0.01)
        if session.get("paused_node_id") == node_id:
            return


async def _drive_to_done(session: dict[str, Any], task: asyncio.Task[None]) -> None:
    """Release any remaining pauses and await terminal state without leaking the task."""
    for _ in range(400):
        if task.done():
            break
        session["pause_event"].set()
        await asyncio.sleep(0.02)
    await asyncio.wait_for(task, timeout=5.0)


@pytest.fixture(autouse=True)
def setup_teardown() -> Any:
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


class TestStepOverFunction:
    """Step Over a Function runs the whole body as one unit and re-pauses at the
    sibling-after egress; inner breakpoints are suppressed for the step."""

    @pytest.mark.asyncio
    async def test_step_over_runs_body_and_pauses_on_sibling_after(self) -> None:
        session_id = "fn-step-over"
        # Breakpoint on the Function node AND on an inner body node: the inner
        # breakpoint must be suppressed while stepping over the Function.
        session = _make_session(session_id, breakpoints={"fn-1", "inner-b"})
        _wb_common._workbench_sessions[session_id] = session

        local = _local_def(
            nodes=[_log_node("inner-a", "'a'"), _log_node("inner-b", "'b'")],
            edges=[
                {"source": "start-node", "target": "inner-a"},
                {"source": "inner-a", "target": "inner-b"},
            ],
        )
        nodes = [_function_node("fn-1", local_definition=local), _log_node("after", "'after'")]
        edges = [
            {"source": "start-node", "target": "fn-1"},
            {"source": "fn-1", "target": "after"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )
        await _wait_for_pause(session, "fn-1")
        assert session["paused_node_id"] == "fn-1"

        workbench_service.step_over(session_id=session_id)
        await _wait_for_pause(session, "after")

        # Re-paused at the sibling-after egress, NOT at the inner breakpoint.
        assert session["status"] == "paused"
        assert session["paused_node_id"] == "after"
        # The entire body ran as one unit (inner breakpoint suppressed).
        assert session["block_states"].get("inner-a") == "passed"
        assert session["block_states"].get("inner-b") == "passed"
        assert session["block_states"].get("fn-1") == "passed"
        # The sibling-after has not executed yet (paused before it).
        assert session["block_states"].get("after") != "passed"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)
        assert session["status"] == "passed"


class TestStepIntoFunction:
    """Step Into a Function pauses at the first inner body node."""

    @pytest.mark.asyncio
    async def test_step_into_pauses_on_first_inner_node(self) -> None:
        session_id = "fn-step-into"
        session = _make_session(session_id, breakpoints={"fn-1"})
        _wb_common._workbench_sessions[session_id] = session

        local = _local_def(
            nodes=[_log_node("inner-a", "'a'"), _log_node("inner-b", "'b'")],
            edges=[
                {"source": "start-node", "target": "inner-a"},
                {"source": "inner-a", "target": "inner-b"},
            ],
        )
        nodes = [_function_node("fn-1", local_definition=local), _log_node("after", "'after'")]
        edges = [
            {"source": "start-node", "target": "fn-1"},
            {"source": "fn-1", "target": "after"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )
        await _wait_for_pause(session, "fn-1")
        assert session["paused_node_id"] == "fn-1"

        workbench_service.step_into(session_id=session_id)
        await _wait_for_pause(session, "inner-a")

        # Paused at the first inner body node, which has NOT executed yet.
        assert session["status"] == "paused"
        assert session["paused_node_id"] == "inner-a"
        assert session["block_states"].get("inner-a") != "passed"

        await _drive_to_done(session, task)


class TestStepIntoEmptyBodyFunction:
    """Step Into a Function with an empty body degrades to Step Over: it pauses
    on the sibling-after egress (there is no inner node to land on)."""

    @pytest.mark.asyncio
    async def test_step_into_empty_body_pauses_on_sibling_after(self) -> None:
        session_id = "fn-step-into-empty"
        session = _make_session(session_id, breakpoints={"fn-1"})
        _wb_common._workbench_sessions[session_id] = session

        local = _local_def(nodes=[], edges=[])
        nodes = [_function_node("fn-1", local_definition=local), _log_node("after", "'after'")]
        edges = [
            {"source": "start-node", "target": "fn-1"},
            {"source": "fn-1", "target": "after"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )
        await _wait_for_pause(session, "fn-1")
        assert session["paused_node_id"] == "fn-1"

        workbench_service.step_into(session_id=session_id)
        await _wait_for_pause(session, "after")

        assert session["status"] == "paused"
        assert session["paused_node_id"] == "after"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)
        assert session["status"] == "passed"


class TestSkipAtPauseFunction:
    """Skip-at-pause on a Function routes past the whole body to the
    sibling-after egress; the body never runs and there is no diverging 409."""

    @pytest.mark.asyncio
    async def test_skip_routes_past_body_without_running_it(self) -> None:
        session_id = "fn-skip"
        session = _make_session(session_id, breakpoints={"fn-1"})
        _wb_common._workbench_sessions[session_id] = session

        local = _local_def(
            nodes=[_log_node("inner-a", "'a'")],
            edges=[{"source": "start-node", "target": "inner-a"}],
        )
        nodes = [_function_node("fn-1", local_definition=local), _log_node("after", "'after'")]
        edges = [
            {"source": "start-node", "target": "fn-1"},
            {"source": "fn-1", "target": "after"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )
        await _wait_for_pause(session, "fn-1")
        assert session["paused_node_id"] == "fn-1"

        # A Function is single-egress: skip must NOT raise the diverging 409.
        result = workbench_service.skip_current_block(session_id=session_id)
        assert result["skipped_node_id"] == "fn-1"

        await _wait_for_pause(session, "after")
        assert session["status"] == "paused"
        assert session["paused_node_id"] == "after"
        # The Function node is skipped and its body never ran.
        assert session["block_states"].get("fn-1") == "skipped"
        assert "inner-a" not in session["block_states"]

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)
        assert session["block_states"].get("after") == "passed"

    @pytest.mark.asyncio
    async def test_skip_does_not_raise_diverging_conflict(self) -> None:
        """Direct service check: skipping a paused Function never raises the
        diverging-parent ConflictException (a Function has one egress)."""
        from wavecore.api.exceptions import ConflictException

        session_id = "fn-skip-noconflict"
        session = _make_session(session_id)
        session["status"] = "paused"
        session["paused_node_id"] = "fn-1"
        session["_adj"] = {"fn-1": [("after", None)]}
        session["_node_map"] = {
            "fn-1": _function_node("fn-1", local_definition=_local_def(nodes=[], edges=[])),
            "after": _log_node("after"),
        }
        _wb_common._workbench_sessions[session_id] = session

        # Must not raise; if it raised a diverging conflict the test fails.
        try:
            result = workbench_service.skip_current_block(session_id=session_id)
        except ConflictException as exc:  # pragma: no cover - failure path
            pytest.fail(f"skip raised a conflict for a Function node: {exc}")
        assert result["skipped_node_id"] == "fn-1"


class TestRepeatStepFunction:
    """Repeat Step on a paused Function re-invokes the body and re-pauses in
    place on the same Function node."""

    @pytest.mark.asyncio
    async def test_repeat_reinvokes_body_and_stays_paused(self) -> None:
        from wavecore.api.services import log_streaming_service

        session_id = "fn-repeat"
        session = _make_session(session_id, breakpoints={"fn-1"})
        _wb_common._workbench_sessions[session_id] = session

        local = _local_def(
            nodes=[_log_node("inner-a", "'BODY-RAN'")],
            edges=[{"source": "start-node", "target": "inner-a"}],
        )
        nodes = [_function_node("fn-1", local_definition=local), _log_node("after", "'after'")]
        edges = [
            {"source": "start-node", "target": "fn-1"},
            {"source": "fn-1", "target": "after"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )
        await _wait_for_pause(session, "fn-1")
        assert session["paused_node_id"] == "fn-1"

        def _body_runs() -> int:
            return sum(
                1
                for entry in log_streaming_service.get_logs(session_id)
                if isinstance(entry, dict) and "BODY-RAN" in entry.get("message", "")
            )

        # The pause lands BEFORE the Function is invoked, so its body has not
        # run yet. Each Repeat Step then re-invokes the body once and re-pauses
        # in place on the same node.
        assert _body_runs() == 0

        workbench_service.repeat_step(session_id=session_id)
        for _ in range(200):
            await asyncio.sleep(0.01)
            if _body_runs() >= 1:
                break
        assert _body_runs() >= 1, "Repeat Step must re-invoke the Function body"
        assert session["paused_node_id"] == "fn-1"
        assert session["status"] == "paused"

        # A second Repeat re-invokes again, still pinned to the Function node.
        workbench_service.repeat_step(session_id=session_id)
        for _ in range(200):
            await asyncio.sleep(0.01)
            if _body_runs() >= 2:
                break
        assert _body_runs() >= 2, "each Repeat Step re-invokes the body again"
        assert session["paused_node_id"] == "fn-1"

        await _drive_to_done(session, task)


class TestNestedStepIntoFunction:
    """Stepping into a Function whose first body node is itself a Function
    descends another level and pauses at the inner Function's first body node."""

    @pytest.mark.asyncio
    async def test_nested_step_into_descends_another_level(self) -> None:
        session_id = "fn-nested-step-into"
        session = _make_session(session_id, breakpoints={"outer-fn"})
        _wb_common._workbench_sessions[session_id] = session

        inner_def = _local_def(
            nodes=[_log_node("deep-a", "'deep'")],
            edges=[{"source": "start-node", "target": "deep-a"}],
        )
        outer_def = _local_def(
            nodes=[_function_node("inner-fn", local_definition=inner_def)],
            edges=[{"source": "start-node", "target": "inner-fn"}],
        )
        nodes = [
            _function_node("outer-fn", local_definition=outer_def),
            _log_node("after", "'after'"),
        ]
        edges = [
            {"source": "start-node", "target": "outer-fn"},
            {"source": "outer-fn", "target": "after"},
        ]

        task = asyncio.create_task(
            workbench_service._execute_workflow(session_id, nodes, edges, {})
        )
        await _wait_for_pause(session, "outer-fn")
        assert session["paused_node_id"] == "outer-fn"

        # Step into the outer Function: pause at its first inner node, which is
        # the inner Function instance.
        workbench_service.step_into(session_id=session_id)
        await _wait_for_pause(session, "inner-fn")
        assert session["paused_node_id"] == "inner-fn"

        # Step into the inner Function: descend another level to its first body
        # node.
        workbench_service.step_into(session_id=session_id)
        await _wait_for_pause(session, "deep-a")
        assert session["paused_node_id"] == "deep-a"
        assert session["block_states"].get("deep-a") != "passed"

        await _drive_to_done(session, task)
