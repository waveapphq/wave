"""A container's lanes run only through the container, in a Function body as on the Test's flow.

A For, For Each, While or Wait Until that runs its lane zero times never runs that lane, wherever
it sits: on the Test's own flow, in a loop body or a try path, in a Function body, or in a Function
nested in a Function (REQ-3.1.1.4, REQ-3.5.1.15, REQ-3.5.1.16, REQ-3.5.1.17, REQ-3.1.3.25).
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from wavecore.api.services import log_streaming_service
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.core.table import Table

pytestmark = pytest.mark.usefixtures("temp_storage_path")

LANE_TEXT = "lane-ran"
AFTER_TEXT = "lane-after"
DONE_TEXT = "test-done"


@pytest.fixture(autouse=True)
def register_plugins_and_controls() -> Any:
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


def _make_session(session_id: str) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Function Body Containers",
        "block_states": {},
        "variables": {},
        "scope_failed": False,
        "breakpoints": set(),
        "debug_options": None,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
        "skipped_node_ids": [],
        "websocket_topic": f"workbench:{session_id}",
        "log_topic": f"log:{session_id}",
    }


def _node(
    node_id: str,
    element_type: str,
    node_type: str,
    values: dict[str, Any],
    expression_fields: list[str],
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": element_type,
            "nodeType": node_type,
            "version": "1.0.0",
            "config": {"values": values, "profileBindings": [], "outputBindings": {}},
            "displayName": node_id,
            "expressionFields": expression_fields,
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _log(node_id: str, text: str) -> dict[str, Any]:
    return _node(node_id, "log", "plugin", {"message": f"'{text}'", "level": "INFO"}, ["message"])


_FALSE = [{"id": "c0", "type": "expression", "expression": "False"}]
_TRUE = [{"id": "c0", "type": "expression", "expression": "True"}]

# Every container that can run its lane zero times: (element type, values, expression fields, lane).
ZERO_RUN_CONTAINERS: dict[str, tuple[str, dict[str, Any], list[str], str]] = {
    "for-count-0": ("for", {"mode": "count", "count": 0, "start": 0, "end": 0}, [], "body"),
    "for-count-null": (
        "for",
        {"mode": "count", "count": "None", "start": 0, "end": 0},
        ["count"],
        "body",
    ),
    "for-each-null": ("for-each", {"collection": "None"}, ["collection"], "body"),
    "for-each-empty-list": ("for-each", {"collection": []}, [], "body"),
    "for-each-empty-map": ("for-each", {"collection": {}}, [], "body"),
    "for-each-empty-table": ("for-each", {"collection": "rows"}, ["collection"], "body"),
    "while-false-at-start": ("while", {"mode": "while-do", "conditions": _FALSE}, [], "body"),
    "wait-until-met-at-once": (
        "wait-until",
        {"conditions": _TRUE, "timeout": 500, "check_interval": 1, "mode": "retry"},
        [],
        "retry",
    ),
    "switch-no-case-matches": (
        "switch-case",
        {"branches": [{"id": "branch_0", "type": "case", "label": "c", "conditions": _FALSE}]},
        [],
        "branch_0",
    ),
    "try-catch-nothing-to-catch": (
        "try-catch-finally",
        {"enable_catch": True, "enable_finally": False},
        [],
        "catch",
    ),
}

PLACEMENTS = [
    "test-flow",
    "test-for-body",
    "function-body",
    "nested-function",
    "for-body-in-function",
    "try-in-function",
]


def _zero_run_graph(
    kind: str, with_then: bool
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The container `zr`, its lane Log and (when asked) a Log on its then lane; no start edge."""
    element_type, values, expression_fields, lane = ZERO_RUN_CONTAINERS[kind]
    nodes = [
        _node("zr", element_type, "control", values, expression_fields),
        _log("zr-lane", LANE_TEXT),
    ]
    edges: list[dict[str, Any]] = [{"source": "zr", "target": "zr-lane", "sourceHandle": lane}]
    if with_then:
        nodes.append(_log("zr-after", AFTER_TEXT))
        edges.append({"source": "zr", "target": "zr-after", "sourceHandle": "then"})
    return nodes, edges


def _local_function(
    node_id: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]], entry: str
) -> dict[str, Any]:
    """A Local Function Block whose input `rows` is the expression `rows` of the enclosing flow."""
    definition = {
        "name": node_id,
        "description": "",
        "tags": [],
        "inputs": [{"name": "rows", "type": "table", "required": False}],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": nodes, "edges": [{"source": "start-node", "target": entry}, *edges]},
    }
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": definition,
            "config": {"values": {"rows": "rows"}, "profileBindings": [], "outputBindings": {}},
            "expressionFields": ["rows"],
            "templateFields": [],
            "displayName": node_id,
        },
    }


def _wrap(
    container_id: str,
    element_type: str,
    values: dict[str, Any],
    lane: str,
    inner: tuple[list[dict[str, Any]], list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """`inner` placed on `lane` of a container that runs that lane once."""
    nodes, edges = inner
    head = _node(container_id, element_type, "control", values, [])
    return [head, *nodes], [{"source": container_id, "target": "zr", "sourceHandle": lane}, *edges]


Exit = tuple[str, str | None]


def _placed(
    placement: str, kind: str, with_then: bool
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str, Exit]:
    """The Test's nodes and edges, the step it starts with and the exit the Test goes on from."""
    inner = _zero_run_graph(kind, with_then)
    once_for = ("for", {"mode": "count", "count": 1, "start": 0, "end": 0}, "body")
    try_path = ("try-catch-finally", {"enable_catch": True, "enable_finally": False}, "try")
    if placement == "test-flow":
        exit_: Exit = ("zr-after", None) if with_then else ("zr", "then")
        return inner[0], inner[1], "zr", exit_
    if placement == "test-for-body":
        nodes, edges = _wrap("outer", once_for[0], once_for[1], once_for[2], inner)
        return nodes, edges, "outer", ("outer", "then")
    if placement == "function-body":
        return [_local_function("fn", *inner, entry="zr")], [], "fn", ("fn", None)
    if placement == "nested-function":
        middle = _local_function("fn-inner", *inner, entry="zr")
        return [_local_function("fn", [middle], [], entry="fn-inner")], [], "fn", ("fn", None)
    wrapper = once_for if placement == "for-body-in-function" else try_path
    nodes, edges = _wrap("outer", wrapper[0], wrapper[1], wrapper[2], inner)
    return [_local_function("fn", nodes, edges, entry="outer")], [], "fn", ("fn", None)


def _log_messages(session_id: str) -> list[str]:
    return [
        str(entry.get("message", ""))
        for entry in log_streaming_service.get_logs(session_id)
        if isinstance(entry, dict)
    ]


class TestAZeroRunLaneNeverRuns:
    """A container that runs its lane zero times leaves the lane alone at every placement."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("with_then", [True, False], ids=["then-lane", "no-then-lane"])
    @pytest.mark.parametrize("placement", PLACEMENTS)
    @pytest.mark.parametrize("kind", list(ZERO_RUN_CONTAINERS))
    async def test_the_lane_never_runs_and_the_flow_goes_on(
        self, kind: str, placement: str, with_then: bool
    ) -> None:
        session_id = f"zr-{kind}-{placement}-{with_then}"
        _wb_common._workbench_sessions[session_id] = _make_session(session_id)
        nodes, edges, first, (exit_source, exit_handle) = _placed(placement, kind, with_then)
        exit_edge: dict[str, Any] = {"source": exit_source, "target": "done"}
        if exit_handle is not None:
            exit_edge["sourceHandle"] = exit_handle
        nodes = [*nodes, _log("done", DONE_TEXT)]
        edges = [{"source": "start-node", "target": first}, *edges, exit_edge]
        variables: dict[str, Any] = {"rows": Table(columns=[("host", "string")])}

        await asyncio.wait_for(
            workbench_service._execute_workflow(session_id, nodes, edges, variables), timeout=10.0
        )

        messages = _log_messages(session_id)
        session = _wb_common._workbench_sessions[session_id]
        assert (
            session["status"],
            messages.count(LANE_TEXT),
            messages.count(AFTER_TEXT),
            messages.count(DONE_TEXT),
        ) == ("passed", 0, 1 if with_then else 0, 1), messages
