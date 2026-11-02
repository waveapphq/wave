"""A branch inside a loop body rejoins the shared continuation.

When an If/Else inside a loop body takes one branch, the block both branches
lead to - the rejoin target - must still run. The nested dispatcher marked the
untaken branch's whole chain skipped, and the rejoin target sits on that chain,
so it was skipped and its ``executed`` marker then suppressed it on the taken
path too. The identical graph at test top level has always executed it.
"""

from typing import Any

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service

MATCH_HIT: list[dict[str, Any]] = [
    {
        "type": "literal",
        "variable": "flag",
        "value_type": "string",
        "operator": "equals",
        "reference_value": "hit",
        "reference_is_expression": False,
    }
]


def _make_session(session_id: str) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "test_name": "Rejoin Test",
        "scope_failed": False,
    }


def _make_node(
    node_id: str,
    label: str,
    element_type: str,
    node_type: str,
    config_values: dict[str, Any],
    output_bindings: dict[str, str] | None = None,
) -> dict[str, Any]:
    config: dict[str, Any] = {"values": config_values, "profileBindings": []}
    if output_bindings:
        config["outputBindings"] = output_bindings
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": element_type,
            "nodeType": node_type,
            "version": "1.0.0",
            "config": config,
            "disabled": False,
            "displayName": label,
            "expressionFields": ["message"] if element_type == "log" else [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _log(node_id: str, message: str) -> dict[str, Any]:
    return _make_node(node_id, "Log", "log", "plugin", {"message": message, "level": "INFO"})


def _if_node(node_id: str) -> dict[str, Any]:
    return _make_node(
        node_id,
        "If/Else",
        "if-else",
        "control",
        {
            "branches": [
                {"type": "if", "id": "b_hit", "label": "Hit", "conditions": MATCH_HIT},
                {"type": "else", "id": "b_else", "label": "Else"},
            ]
        },
    )


def _for_each(node_id: str, collection: list[Any]) -> dict[str, Any]:
    return _make_node(
        node_id,
        "For Each",
        "for-each",
        "control",
        {"collection": collection},
        output_bindings={"item": "current_item", "index": "i"},
    )


def _setter(node_id: str, variables: dict[str, str]) -> dict[str, Any]:
    node = _make_node(node_id, "Var Setter", "variable-setter", "control", {"variables": variables})
    node["data"]["variableExpressionKeys"] = list(variables)
    return node


@pytest.fixture(autouse=True)
def _engine_registries() -> Any:
    """Register core controls + the Log plugin like app startup does."""
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.log import LogPlugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    yield
    clear_registry()
    _registry.clear()


async def _run(
    session_id: str, nodes: list[Any], edges: list[Any], variables: Any
) -> dict[str, Any]:
    _wb_common._workbench_sessions[session_id] = _make_session(session_id)
    await workbench_service._execute_workflow(session_id, nodes, edges, variables)
    return _wb_common._workbench_sessions[session_id]


def _rejoin_graph(collection: list[Any]) -> tuple[list[Any], list[Any]]:
    """Loop body: setter -> if/else; the then-tail and the else lane both
    lead to the same continuation block, which then leads to a tail block."""
    nodes = [
        _for_each("loop", collection),
        _setter("pin", {"flag": "current_item['value']"}),
        _if_node("fork"),
        _log("then-body", "'then-body'"),
        _log("rejoin", "'rejoin-ran'"),
        _log("body-tail", "'body-tail'"),
        _log("spine", "'spine'"),
    ]
    edges = [
        {"source": "start-node", "target": "loop"},
        {"source": "loop", "target": "pin", "sourceHandle": "body"},
        {"source": "pin", "target": "fork"},
        {"source": "fork", "target": "then-body", "sourceHandle": "b_hit"},
        {"source": "fork", "target": "rejoin", "sourceHandle": "b_else"},
        {"source": "then-body", "target": "rejoin", "targetHandle": "ingress_1"},
        {"source": "rejoin", "target": "body-tail"},
        {"source": "loop", "target": "spine", "sourceHandle": "then"},
    ]
    return nodes, edges


class TestBranchRejoinInsideLoopBody:
    """The continuation after a branch runs whichever branch was taken."""

    async def _run_rejoin(self, session_id: str, collection: list[Any]) -> dict[str, Any]:
        nodes, edges = _rejoin_graph(collection)
        return await _run(session_id, nodes, edges, {"current_item": None, "i": None, "flag": ""})

    async def test_rejoin_runs_when_the_then_branch_is_taken(self) -> None:
        session = await self._run_rejoin("rejoin-1", ["hit"])

        assert session["block_states"]["then-body"] == "passed"
        assert session["block_states"]["rejoin"] == "passed"

    async def test_the_block_after_the_rejoin_runs_too(self) -> None:
        session = await self._run_rejoin("rejoin-2", ["hit"])

        assert session["block_states"]["body-tail"] == "passed"

    async def test_rejoin_runs_when_the_else_lane_is_taken(self) -> None:
        session = await self._run_rejoin("rejoin-3", ["other"])

        assert session["block_states"]["rejoin"] == "passed"
        assert session["block_states"]["then-body"] == "skipped"

    async def test_the_untaken_branch_still_paints_skipped(self) -> None:
        session = await self._run_rejoin("rejoin-4", ["hit"])

        assert session["block_states"]["rejoin"] == "passed"
        assert session["status"] == "passed"

    async def test_a_later_iteration_taking_the_other_branch_still_rejoins(self) -> None:
        """Mixed passes: the else lane first, the then branch second."""
        session = await self._run_rejoin("rejoin-5", ["other", "hit"])

        assert session["block_states"]["rejoin"] == "passed"
        assert session["block_states"]["body-tail"] == "passed"
        assert session["block_states"]["spine"] == "passed"


class TestBranchRejoinAtTopLevel:
    """The same shape outside a loop keeps working."""

    async def test_top_level_rejoin_runs_on_the_taken_branch(self) -> None:
        nodes = [
            _if_node("fork"),
            _log("then-body", "'then-body'"),
            _log("rejoin", "'rejoin-ran'"),
        ]
        edges = [
            {"source": "start-node", "target": "fork"},
            {"source": "fork", "target": "then-body", "sourceHandle": "b_hit"},
            {"source": "fork", "target": "rejoin", "sourceHandle": "b_else"},
            {"source": "then-body", "target": "rejoin", "targetHandle": "ingress_1"},
        ]
        session = await _run("rejoin-top", nodes, edges, {"flag": "hit"})

        assert session["block_states"]["then-body"] == "passed"
        assert session["block_states"]["rejoin"] == "passed"
