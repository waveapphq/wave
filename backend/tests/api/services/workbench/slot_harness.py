"""Builders that place one sub-flow inside each slot kind, shared by the nested walker tests.

A sub-flow is a list of nodes and edges entered at ``entry`` and left at ``exit_id``. Each
wrapper puts it in a container slot so a test runs the same sub-flow through every walker.
"""

from dataclasses import dataclass, field
from typing import Any

from tests.api.services.workbench.parallel_harness import (
    edge,
    for_each_node,
    function_node,
    local_definition,
    log_node,
    make_node,
    setter_node,
    try_catch_node,
)

Nodes = list[dict[str, Any]]
Edges = list[dict[str, Any]]
TRUE = [{"type": "expression", "expression": "True"}]
FALSE = [{"type": "expression", "expression": "False"}]


def for_node(node_id: str, count: int, index_var: str = "i") -> dict[str, Any]:
    """A count-mode For Loop."""
    return make_node(
        node_id,
        label="For Loop",
        element_type="for",
        config_values={"mode": "count", "count": count},
        output_bindings={"index": index_var},
        name=node_id,
    )


def while_node(node_id: str, expression: str, index_var: str = "idx") -> dict[str, Any]:
    """A while-do loop gated on one expression."""
    return make_node(
        node_id,
        label="While Loop",
        element_type="while",
        config_values={
            "mode": "while-do",
            "conditions": [{"type": "expression", "expression": expression}],
        },
        output_bindings={"index": index_var},
        name=node_id,
    )


def retry_wait_node(node_id: str, expression: str, timeout: int = 60000) -> dict[str, Any]:
    """A retry-mode Wait Until gated on one expression."""
    return make_node(
        node_id,
        label="Wait Until",
        element_type="wait-until",
        config_values={
            "conditions": [{"type": "expression", "expression": expression}],
            "timeout": timeout,
            "check_interval": 10,
            "mode": "retry",
        },
        output_bindings={"passed": "wait_ok", "elapsed": "wait_ms"},
        name=node_id,
    )


def if_else_node(node_id: str, conditions: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """An If/Else whose if branch (``branch_0``) is taken when ``conditions`` pass."""
    branches = [
        {"type": "if", "id": "branch_0", "conditions": conditions or TRUE},
        {"type": "else", "id": "branch_1"},
    ]
    return make_node(
        node_id, label="If/Else", element_type="if-else", config_values={"branches": branches}
    )


def assert_split_node(node_id: str, expression: str = "True") -> dict[str, Any]:
    """A split-mode Assert leaving by ``pass`` or ``fail``."""
    return make_node(
        node_id,
        label="Assert",
        element_type="assert",
        config_values={
            "assertions": [{"type": "expression", "expression": expression}],
            "mode": "split",
            "fail_current_scope": False,
        },
    )


def switch_node(node_id: str, branches: list[dict[str, Any]]) -> dict[str, Any]:
    """A Switch/Case carrying its branch records."""
    return make_node(
        node_id,
        label="Switch/Case",
        element_type="switch-case",
        config_values={"branches": branches},
    )


def case(branch_id: str, conditions: list[dict[str, Any]], break_on: bool = True) -> Any:
    """A Switch case record."""
    return {
        "id": branch_id,
        "type": "case",
        "label": "",
        "conditions": conditions,
        "break": break_on,
    }


@dataclass
class Graph:
    """A runnable graph plus the variables it starts from."""

    nodes: Nodes
    edges: Edges
    variables: dict[str, Any] = field(default_factory=dict)


LOOP_OUTPUTS: dict[str, Any] = {
    "i": None,
    "idx": None,
    "fe_item": None,
    "fe_idx": None,
    "wait_ok": None,
    "wait_ms": None,
    "rounds": 0,
}


def _tick(exit_id: str) -> tuple[Nodes, Edges]:
    """A counter bump after the sub-flow, so a While or Wait Until ends after one round."""
    tick = setter_node("tick", "Tick", {"rounds": "rounds + 1"}, expressions=True)
    return [tick], [edge(exit_id, "tick")]


def in_slot(
    slot: str,
    sub_nodes: Nodes,
    sub_edges: Edges,
    entry: str,
    exit_id: str,
    then: bool = True,
) -> Graph:
    """Place the sub-flow in ``slot`` of a container ``outer`` on the main flow.

    Slots: for-body, for-each-body, while-body, wait-until-body, try-path, function-body.
    With ``then`` the container leaves by `then` to an ``after`` Log.
    """
    after = log_node("after", "After", "'AFTER'")
    variables = dict(LOOP_OUTPUTS)
    extra_nodes: Nodes = []
    extra_edges: Edges = []
    handle = "body"
    if slot == "for-body":
        container = for_node("outer", 1)
    elif slot == "for-each-body":
        container = for_each_node("outer", [1])
    elif slot == "while-body":
        container = while_node("outer", "rounds < 1")
        extra_nodes, extra_edges = _tick(exit_id)
    elif slot == "wait-until-body":
        container = retry_wait_node("outer", "rounds >= 1")
        extra_nodes, extra_edges = _tick(exit_id)
        handle = "retry"
    elif slot == "try-path":
        container = try_catch_node("outer")
        handle = "try"
    else:
        definition = local_definition("Body", sub_nodes, [edge("start-node", entry), *sub_edges])
        nodes = [function_node("outer", definition), after]
        edges = [edge("start-node", "outer"), edge("outer", "after")]
        return Graph(nodes, edges, variables)
    nodes = [container, *sub_nodes, *extra_nodes]
    edges = [edge("start-node", "outer"), edge("outer", entry, handle), *sub_edges, *extra_edges]
    if then:
        nodes.append(after)
        edges.append(edge("outer", "after", "then"))
    return Graph(nodes, edges, variables)
