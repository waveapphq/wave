"""Unit tests for ``start_node_id`` engine entry-point override.

REQ-3.2.1.5 (Run/Debug from Here) overrides the engine's entry-point
set: instead of starting at every node connected to the workflow's
implicit ``start-node``, the engine starts at the chosen
``start_node_id`` and continues through every reachable downstream node
until the graph drains.

Behavior under test:

    - Pre-start nodes (everything upstream of ``start_node_id``) NEVER
      execute.
    - Post-start nodes (everything reachable downstream of
      ``start_node_id``) DO execute, in normal traversal order.
    - When ``pause_on_first_block`` is set on a Debug-from-Here request,
      the engine pauses AT ``start_node_id``, NOT at the
      workflow's actual start.
    - Skipped nodes encountered during traversal stay skipped (existing
      behavior preserved).
    - Disabled nodes encountered during traversal are bypassed
      (existing behavior preserved).
"""

import asyncio
from typing import Any

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service


def _make_session(
    session_id: str,
    *,
    breakpoints: set[str] | None = None,
    debug_options: dict[str, bool] | None = None,
) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Partial Graph Test",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "scope_failed": False,
        "breakpoints": set(breakpoints or set()),
        "debug_options": debug_options,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
        "skipped_node_ids": [],
    }


def _log_node(
    node_id: str,
    label: str,
    message: str = "'ok'",
    *,
    disabled: bool = False,
) -> dict[str, Any]:
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
            "disabled": disabled,
            "displayName": label,
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


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


class TestStartNodeIdTraversal:
    """``start_node_id`` overrides the engine's initial entry-point set."""

    @pytest.mark.asyncio
    async def test_pre_start_nodes_do_not_execute(self) -> None:
        """Nodes upstream of ``start_node_id`` are skipped over by the engine."""
        session_id = "partial-pre"
        session = _make_session(session_id)
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

        await workbench_service._execute_workflow(
            session_id,
            nodes,
            edges,
            {},
            start_node_id="node-b",
        )

        assert (
            "node-a" not in session["block_states"]
        ), "node-a is upstream of node-b and must not execute"
        assert session["block_states"].get("node-b") == "passed"
        assert session["block_states"].get("node-c") == "passed"

    @pytest.mark.asyncio
    async def test_post_start_nodes_execute_in_order(self) -> None:
        """All nodes reachable from ``start_node_id`` execute in BFS order."""
        session_id = "partial-post"
        session = _make_session(session_id)
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

        await workbench_service._execute_workflow(
            session_id,
            nodes,
            edges,
            {},
            start_node_id="node-b",
        )

        assert session["block_states"].get("node-b") == "passed"
        assert session["block_states"].get("node-c") == "passed"
        assert session["block_states"].get("node-d") == "passed"
        assert "node-a" not in session["block_states"]
        assert session["status"] == "passed"

    @pytest.mark.asyncio
    async def test_start_at_first_node_equals_full_run(self) -> None:
        """``start_node_id`` set to the natural first node behaves like a full run."""
        session_id = "partial-first"
        session = _make_session(session_id)
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _log_node("node-a", "A", "'a'"),
            _log_node("node-b", "B", "'b'"),
        ]
        edges = [
            {"source": "start-node", "target": "node-a"},
            {"source": "node-a", "target": "node-b"},
        ]

        await workbench_service._execute_workflow(
            session_id,
            nodes,
            edges,
            {},
            start_node_id="node-a",
        )

        assert session["block_states"].get("node-a") == "passed"
        assert session["block_states"].get("node-b") == "passed"

    @pytest.mark.asyncio
    async def test_start_at_last_node_executes_only_that_node(self) -> None:
        """``start_node_id`` set to the workflow's terminal leaf executes just it."""
        session_id = "partial-last"
        session = _make_session(session_id)
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

        await workbench_service._execute_workflow(
            session_id,
            nodes,
            edges,
            {},
            start_node_id="node-c",
        )

        assert session["block_states"].get("node-c") == "passed"
        assert "node-a" not in session["block_states"]
        assert "node-b" not in session["block_states"]


class TestStartNodeIdWithSkippedAndDisabled:
    """Existing skip/disabled behavior is preserved during ``start_node_id`` traversal."""

    @pytest.mark.asyncio
    async def test_skipped_node_in_post_start_path_stays_skipped(self) -> None:
        session_id = "partial-skip"
        session = _make_session(session_id)
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

        await workbench_service._execute_workflow(
            session_id,
            nodes,
            edges,
            {},
            skipped_node_ids=["node-c"],
            start_node_id="node-a",
        )

        assert session["block_states"].get("node-a") == "passed"
        assert session["block_states"].get("node-b") == "passed"
        assert session["block_states"].get("node-c") == "skipped"

    @pytest.mark.asyncio
    async def test_disabled_node_in_post_start_path_is_bypassed(self) -> None:
        session_id = "partial-disabled"
        session = _make_session(session_id)
        _wb_common._workbench_sessions[session_id] = session

        nodes = [
            _log_node("node-a", "A", "'a'"),
            _log_node("node-b", "B", "'b'", disabled=True),
            _log_node("node-c", "C", "'c'"),
        ]
        edges = [
            {"source": "start-node", "target": "node-a"},
            {"source": "node-a", "target": "node-b"},
            {"source": "node-b", "target": "node-c"},
        ]

        await workbench_service._execute_workflow(
            session_id,
            nodes,
            edges,
            {},
            start_node_id="node-a",
        )

        assert session["block_states"].get("node-a") == "passed"
        assert (
            session["block_states"].get("node-b") == "skipped"
        ), "disabled node is reported as skipped (engine maps disabled -> skipped)"
        assert session["block_states"].get("node-c") == "passed"


class TestPauseOnFirstBlockAtStartNode:
    """``pause_on_first_block`` fires AT ``start_node_id``, not the natural start."""

    @pytest.mark.asyncio
    async def test_pause_on_first_block_pauses_at_start_node_id_not_workflow_start(
        self,
    ) -> None:
        """Setting both ``start_node_id`` and ``pause_on_first_block`` pauses at
        the chosen entry, not at the workflow's natural start."""
        session_id = "partial-pause-first"
        session = _make_session(
            session_id,
            debug_options={"pause_on_first_block": True, "pause_on_errors": False},
        )
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
            workbench_service._execute_workflow(
                session_id,
                nodes,
                edges,
                {},
                start_node_id="node-b",
            )
        )

        for _ in range(200):
            await asyncio.sleep(0.01)
            if session.get("status") == "paused":
                break

        assert (
            session["status"] == "paused"
        ), "engine must pause at start_node_id when pause_on_first_block is set"
        assert (
            session["paused_node_id"] == "node-b"
        ), "pause must fire at start_node_id (node-b), not at the natural workflow start"
        assert (
            "node-a" not in session["block_states"]
        ), "node-a is upstream of start_node_id and must not execute"
        assert (
            session["block_states"].get("node-b") != "passed"
        ), "the chosen start node must not have executed yet"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)

        assert session["status"] == "passed"
        assert session["block_states"]["node-b"] == "passed"
        assert session["block_states"]["node-c"] == "passed"

    @pytest.mark.asyncio
    async def test_pause_on_first_block_without_start_node_id_pauses_at_natural_start(
        self,
    ) -> None:
        """pause_on_first_block without start_node_id pauses at the natural first block."""
        session_id = "partial-pause-natural"
        session = _make_session(
            session_id,
            debug_options={"pause_on_first_block": True, "pause_on_errors": False},
        )
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

        assert session["status"] == "paused"
        assert session["paused_node_id"] == "node-a"

        session["pause_event"].set()
        await asyncio.wait_for(task, timeout=5.0)

        assert session["status"] == "passed"
