"""Switch/Case container dispatch through the real workbench engine.

Covers REQ-3.5.1.20 (SWITCH-1 to SWITCH-4, SWITCH-11, SWITCH-12): Switch is a
container, break off resumes at the next case and evaluates that case's own
condition, the default is optional, ``then`` is always taken, there are no
outputs, a disabled Switch cascade-skips every case and default, branch ids are
stable, the dispatcher owns condition evaluation, a Break/Continue inside a
case body targets the enclosing loop, and the run log names each case as it
is taken.

Every graph is driven through ``workbench_service._execute_workflow``;
observation is via the session dict, the live variables dict and the
execution log.
"""

import asyncio
from typing import Any

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service

# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _engine_registries() -> Any:
    """Register controls/plugins and clear sessions before/after each test."""
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
    """Create a minimal workbench session for testing."""
    return {
        "session_id": session_id,
        "status": "running",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "test_name": "Switch/Case Test",
        "scope_failed": False,
        "variables": {},
        "breakpoints": set(),
        "debug_options": None,
        "paused_node_id": None,
        "skipped_node_ids": [],
        "websocket_topic": f"workbench:{session_id}",
        "log_topic": f"log:{session_id}",
    }


def _make_node(
    node_id: str,
    label: str = "Block",
    element_type: str = "delay",
    node_type: str = "control",
    version: str = "1.0.0",
    config_values: dict[str, Any] | None = None,
    output_bindings: dict[str, str] | None = None,
    description: str | None = None,
    disabled: bool = False,
) -> dict[str, Any]:
    """Create a workflow node for testing."""
    config: dict[str, Any] = {"values": config_values or {"duration": 10}}
    if output_bindings:
        config["outputBindings"] = output_bindings
    config.setdefault("profileBindings", [])
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": label,
            "elementType": element_type,
            "nodeType": node_type,
            "version": version,
            "config": config,
            "disabled": disabled,
            "description": description or label,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _make_log_node(
    node_id: str,
    description: str,
    message: str = "'ok'",
) -> dict[str, Any]:
    """Create a Log plugin node for testing."""
    node = _make_node(
        node_id,
        label="Log",
        element_type="log",
        node_type="plugin",
        version="1.0.0",
        config_values={"message": message, "level": "INFO"},
        description=description,
    )
    # Log plugin requires "message" in expressionFields to evaluate expressions
    node["data"]["expressionFields"] = ["message"]
    return node


def _make_switch_node(
    node_id: str,
    branches: list[dict[str, Any]],
    description: str = "Switch",
) -> dict[str, Any]:
    """Create a Switch/Case control node carrying its branch records."""
    return _make_node(
        node_id,
        label="Switch/Case",
        element_type="switch-case",
        node_type="control",
        version="1.0.0",
        config_values={"branches": branches},
        description=description,
    )


def _make_setter_node(
    node_id: str,
    description: str,
    values: dict[str, Any],
    expressions: bool = False,
) -> dict[str, Any]:
    """Create a Variable Setter control node writing ``values``."""
    node = _make_node(
        node_id,
        label="Variable Setter",
        element_type="variable-setter",
        node_type="control",
        version="1.0.0",
        config_values={"variables": values},
        description=description,
    )
    if expressions:
        node["data"]["variableExpressionKeys"] = list(values)
    return node


def _make_halt_node(node_id: str, description: str) -> dict[str, Any]:
    """Create a Halt control node that fails the run."""
    node = _make_node(
        node_id,
        label="Halt",
        element_type="halt",
        node_type="control",
        version="1.0.0",
        config_values={"status": "failed", "message": "'stop'"},
        description=description,
    )
    node["data"]["expressionFields"] = ["message"]
    return node


def _make_loop_signal_node(
    node_id: str,
    element_type: str,
    description: str,
    target_loop: str,
) -> dict[str, Any]:
    """Create a Break or Continue control node aimed at ``target_loop``."""
    return _make_node(
        node_id,
        label=element_type.title(),
        element_type=element_type,
        node_type="control",
        version="1.0.0",
        config_values={"target_loop": target_loop},
        description=description,
    )


def _make_for_each_node(node_id: str, collection: list[Any]) -> dict[str, Any]:
    """Create a For-Each control node iterating ``collection``."""
    return _make_node(
        node_id,
        label="ForEach",
        element_type="for-each",
        node_type="control",
        version="1.0.0",
        config_values={"collection": collection},
        output_bindings={"item": "fe_item", "index": "fe_idx"},
        description="ForEach",
    )


def _local_def(
    name: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> dict[str, Any]:
    """Create a Local Function definition body."""
    return {
        "name": name,
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": nodes, "edges": edges},
    }


def _local_function_node(node_id: str, local_definition: dict[str, Any]) -> dict[str, Any]:
    """Create a Local Function instance node."""
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
            "description": node_id,
        },
    }


async def _run(
    session_id: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    variables: dict[str, Any],
) -> dict[str, Any]:
    """Seed a session, run the graph through the engine, return the session."""
    _wb_common._workbench_sessions[session_id] = _make_session(session_id)
    await asyncio.wait_for(
        workbench_service._execute_workflow(session_id, nodes, edges, variables),
        timeout=10.0,
    )
    return _wb_common._workbench_sessions[session_id]


def _log_messages(session_id: str) -> list[str]:
    from wavecore.api.services import log_streaming_service

    return [
        e.get("message", "")
        for e in log_streaming_service.get_logs(session_id)
        if isinstance(e, dict)
    ]


def _log_sources(session_id: str, message: str) -> list[str]:
    from wavecore.api.services import log_streaming_service

    return [
        e.get("source", "")
        for e in log_streaming_service.get_logs(session_id)
        if isinstance(e, dict) and e.get("message") == message
    ]


# ---------------------------------------------------------------------------
# Branch + condition builders
# ---------------------------------------------------------------------------

_ALWAYS_TRUE: list[dict[str, Any]] = [{"type": "expression", "expression": "True"}]

_ALWAYS_FALSE: list[dict[str, Any]] = [{"type": "expression", "expression": "False"}]


def _equals(variable: str, value: str) -> list[dict[str, Any]]:
    """Literal assertion: ``variable`` equals the string ``value``."""
    return [
        {
            "type": "literal",
            "variable": variable,
            "value_type": "string",
            "operator": "equals",
            "reference_value": value,
            "reference_is_expression": False,
        }
    ]


def _string_check(variable: str, operator: str, value: str | None = None) -> list[dict[str, Any]]:
    """Literal assertion on a string ``variable``; unary operators take no ``value``."""
    return [
        {
            "type": "literal",
            "variable": variable,
            "value_type": "string",
            "operator": operator,
            "reference_value": value,
            "reference_is_expression": False,
        }
    ]


def _case(
    branch_id: str,
    conditions: list[dict[str, Any]],
    label: str = "",
    break_on: bool = True,
) -> dict[str, Any]:
    """Build a case branch record."""
    return {
        "id": branch_id,
        "type": "case",
        "label": label,
        "conditions": conditions,
        "break": break_on,
    }


def _default(branch_id: str, label: str = "") -> dict[str, Any]:
    """Build a default branch record: no conditions, no break."""
    return {"id": branch_id, "type": "default", "label": label}


# ---------------------------------------------------------------------------
# Dispatch: match, break, fall-through, default
# ---------------------------------------------------------------------------


class TestSwitchDispatch:
    """Case selection, break semantics and the guaranteed ``then`` egress."""

    async def test_first_matching_case_with_break_runs_alone(self) -> None:
        """Break on ends the Switch after the first matching case; the
        Switch paints passed, ``then`` runs and later case chains paint skipped."""
        session_id = "sw-first-break"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _equals("flag", "a")),
                    _case("branch_1", _ALWAYS_TRUE),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"flag": "a"})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["sw-1"] == "passed", session["block_states"]
        assert session["block_states"]["case-a"] == "passed", session["block_states"]
        assert session["block_states"]["case-b"] == "skipped", session["block_states"]
        assert session["block_states"]["after-log"] == "passed", session["block_states"]

    async def test_break_off_falls_through_to_the_next_matching_case(self) -> None:
        """Break off resumes at the next case; both chains run in author
        order and the ``then`` successor follows."""
        session_id = "sw-fallthrough-hit"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _equals("flag", "a"), break_on=False),
                    _case("branch_1", _ALWAYS_TRUE),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"flag": "a"})

        messages = _log_messages(session_id)
        marks = [m for m in messages if m in ("CASE-A", "CASE-B", "AFTER")]
        assert session["status"] == "passed", session.get("status")
        assert marks == ["CASE-A", "CASE-B", "AFTER"], messages
        assert session["block_states"]["after-log"] == "passed", session["block_states"]

    async def test_break_off_skips_a_non_matching_next_case(self) -> None:
        """Fall-through evaluates the next case's OWN condition - a false
        one does not run just because the previous case fell through."""
        session_id = "sw-fallthrough-miss"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _equals("flag", "a"), break_on=False),
                    _case("branch_1", _equals("flag", "zzz")),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"flag": "a"})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["case-a"] == "passed", session["block_states"]
        assert session["block_states"]["case-b"] == "skipped", session["block_states"]
        assert session["block_states"]["after-log"] == "passed", session["block_states"]

    async def test_fall_through_spans_a_non_matching_case(self) -> None:
        """Break off on case 1, case 2 false, case 3 true - cases 1 and 3
        run and case 2 does not."""
        session_id = "sw-fallthrough-span"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _equals("flag", "a"), break_on=False),
                    _case("branch_1", _equals("flag", "zzz")),
                    _case("branch_2", _ALWAYS_TRUE),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("case-c", "Case C", "'CASE-C'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "case-c", "sourceHandle": "branch_2"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"flag": "a"})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["case-a"] == "passed", session["block_states"]
        assert session["block_states"]["case-b"] == "skipped", session["block_states"]
        assert session["block_states"]["case-c"] == "passed", session["block_states"]
        assert session["block_states"]["after-log"] == "passed", session["block_states"]

    async def test_default_runs_when_no_case_matched(self) -> None:
        """With no matching case the default chain runs alone, then
        ``then``."""
        session_id = "sw-default-hit"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _ALWAYS_FALSE),
                    _case("branch_1", _equals("flag", "zzz")),
                    _default("branch_2"),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("def-a", "Default A", "'DEFAULT'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "def-a", "sourceHandle": "branch_2"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"flag": "a"})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["case-a"] == "skipped", session["block_states"]
        assert session["block_states"]["case-b"] == "skipped", session["block_states"]
        assert session["block_states"]["def-a"] == "passed", session["block_states"]
        assert session["block_states"]["after-log"] == "passed", session["block_states"]

    async def test_break_off_falls_through_into_the_default(self) -> None:
        """The default is the last stop of the fall-through chain - a
        matching case with break off reaches it, because the default carries no
        condition of its own to refuse with."""
        session_id = "sw-fallthrough-default"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _equals("flag", "a"), break_on=False),
                    _case("branch_1", _equals("flag", "zzz")),
                    _default("branch_2"),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("def-a", "Default A", "'DEFAULT'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "def-a", "sourceHandle": "branch_2"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"flag": "a"})

        messages = _log_messages(session_id)
        marks = [m for m in messages if m in ("CASE-A", "CASE-B", "DEFAULT", "AFTER")]
        assert session["status"] == "passed", session.get("status")
        assert marks == ["CASE-A", "DEFAULT", "AFTER"], messages
        assert session["block_states"]["case-b"] == "skipped", session["block_states"]

    async def test_break_on_a_later_case_stops_before_the_default(self) -> None:
        """Fall-through ends at the first matching case that breaks, so
        the default stays out of that pass."""
        session_id = "sw-fallthrough-break-stops"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _equals("flag", "a"), break_on=False),
                    _case("branch_1", _ALWAYS_TRUE),
                    _default("branch_2"),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("def-a", "Default A", "'DEFAULT'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "def-a", "sourceHandle": "branch_2"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"flag": "a"})

        messages = _log_messages(session_id)
        marks = [m for m in messages if m in ("CASE-A", "CASE-B", "DEFAULT", "AFTER")]
        assert session["status"] == "passed", session.get("status")
        assert marks == ["CASE-A", "CASE-B", "AFTER"], messages
        assert session["block_states"]["def-a"] == "skipped", session["block_states"]

    async def test_then_still_runs_when_nothing_matched(self) -> None:
        """No case matched and no default present - the Switch never halts,
        the ``then`` successor still runs and the session passes."""
        session_id = "sw-no-match-no-default"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _ALWAYS_FALSE),
                    _case("branch_1", _equals("flag", "zzz")),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"flag": "a"})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["case-a"] == "skipped", session["block_states"]
        assert session["block_states"]["case-b"] == "skipped", session["block_states"]
        assert session["block_states"]["after-log"] == "passed", session["block_states"]

    async def test_a_case_chain_runs_every_node_in_order(self) -> None:
        """A matched case runs its whole sub-flow, in author order, before
        the ``then`` successor."""
        session_id = "sw-chain"
        nodes = [
            _make_switch_node("sw-1", [_case("branch_0", _ALWAYS_TRUE)]),
            _make_log_node("case-a1", "Case A1", "'A1'"),
            _make_log_node("case-a2", "Case A2", "'A2'"),
            _make_log_node("case-a3", "Case A3", "'A3'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a1", "sourceHandle": "branch_0"},
            {"source": "case-a1", "target": "case-a2"},
            {"source": "case-a2", "target": "case-a3"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {})

        messages = _log_messages(session_id)
        marks = [m for m in messages if m in ("A1", "A2", "A3", "AFTER")]
        assert session["status"] == "passed", session.get("status")
        assert marks == ["A1", "A2", "A3", "AFTER"], messages
        for nid in ("case-a1", "case-a2", "case-a3", "after-log"):
            assert session["block_states"][nid] == "passed", session["block_states"]

    async def test_an_is_null_case_catches_a_null_value(self) -> None:
        """REQ-3.5.1.20: a case checking is null takes a null value."""
        session_id = "sw-null-is-null"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _string_check("flag", "equals", "a")),
                    _case("branch_1", _string_check("flag", "is_null")),
                    _default("branch_2"),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("def-a", "Default A", "'DEFAULT'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "def-a", "sourceHandle": "branch_2"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"flag": None})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["case-a"] == "skipped", session["block_states"]
        assert session["block_states"]["case-b"] == "passed", session["block_states"]
        assert session["block_states"]["def-a"] == "skipped", session["block_states"]
        assert session["block_states"]["after-log"] == "passed", session["block_states"]

    async def test_a_null_value_falls_to_the_default(self) -> None:
        """REQ-3.5.1.20: a null value matches no equals / contains case and reaches Default."""
        session_id = "sw-null-default"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _string_check("flag", "equals", "a")),
                    _case("branch_1", _string_check("flag", "contains", "a")),
                    _default("branch_2"),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("def-a", "Default A", "'DEFAULT'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "def-a", "sourceHandle": "branch_2"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"flag": None})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["case-a"] == "skipped", session["block_states"]
        assert session["block_states"]["case-b"] == "skipped", session["block_states"]
        assert session["block_states"]["def-a"] == "passed", session["block_states"]
        assert session["block_states"]["after-log"] == "passed", session["block_states"]

    async def test_a_not_equals_case_catches_a_null_value_before_the_default(self) -> None:
        """REQ-3.5.1.20: a null value is not equal to 'a', so that case runs, not Default."""
        session_id = "sw-null-not-equals"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _string_check("flag", "not_equals", "a")),
                    _default("branch_1"),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("def-a", "Default A", "'DEFAULT'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "def-a", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"flag": None})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["case-a"] == "passed", session["block_states"]
        assert session["block_states"]["def-a"] == "skipped", session["block_states"]
        assert session["block_states"]["after-log"] == "passed", session["block_states"]


# ---------------------------------------------------------------------------
# Un-taken case and default chains paint skipped (SWITCH-13)
# ---------------------------------------------------------------------------


class TestSwitchSkipsUnTakenChains:
    """Every case chain and the default chain that did not run paints skipped."""

    async def test_an_earlier_non_matching_case_chain_is_skipped(self) -> None:
        """Only case 2 matches - case 1's WHOLE chain paints skipped, not
        just its head."""
        # Guard: a case chain that did not run must paint skipped, not stay unpainted.
        session_id = "sw-skip-earlier-case"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _ALWAYS_FALSE),
                    _case("branch_1", _ALWAYS_TRUE),
                ],
            ),
            _make_log_node("case-a1", "Case A1", "'CASE-A1'"),
            _make_log_node("case-a2", "Case A2", "'CASE-A2'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a1", "sourceHandle": "branch_0"},
            {"source": "case-a1", "target": "case-a2"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {})

        messages = _log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["case-a1"] == "skipped", session["block_states"]
        assert session["block_states"]["case-a2"] == "skipped", session["block_states"]
        assert "CASE-A1" not in messages, messages
        assert "CASE-A2" not in messages, messages
        assert session["block_states"]["case-b"] == "passed", session["block_states"]
        assert session["block_states"]["after-log"] == "passed", session["block_states"]

    async def test_the_default_chain_is_skipped_when_a_case_matched(self) -> None:
        """A matched case leaves the default chain painted skipped."""
        # Guard: an un-taken default chain must paint skipped so the canvas can dim it.
        session_id = "sw-skip-default"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _ALWAYS_TRUE),
                    _default("branch_1"),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("def-a", "Default A", "'DEFAULT'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "def-a", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {})

        messages = _log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["case-a"] == "passed", session["block_states"]
        assert session["block_states"]["def-a"] == "skipped", session["block_states"]
        assert "DEFAULT" not in messages, messages
        assert session["block_states"]["after-log"] == "passed", session["block_states"]

    async def test_a_rejoin_node_that_ran_is_not_repainted_skipped(self) -> None:
        """Two case chains converge on a shared node; case 1 matches and
        breaks, so the shared node runs as part of it. Skip-marking the
        un-taken case 2 chain must leave that shared node alone."""
        session_id = "sw-skip-rejoin"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _ALWAYS_TRUE),
                    _case("branch_1", _ALWAYS_FALSE),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("rejoin", "Rejoin", "'REJOIN'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "case-a", "target": "rejoin"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "case-b", "target": "rejoin"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {})

        messages = _log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["case-a"] == "passed", session["block_states"]
        assert "REJOIN" in messages, messages
        assert session["block_states"]["rejoin"] == "passed", session["block_states"]
        assert session["block_states"]["case-b"] == "skipped", session["block_states"]
        assert "CASE-B" not in messages, messages
        assert session["block_states"]["after-log"] == "passed", session["block_states"]


# ---------------------------------------------------------------------------
# Conditions are evaluated when the case is reached (SWITCH-2)
# ---------------------------------------------------------------------------


class TestSwitchEvaluatesConditionsWhenReached:
    """A case's conditions read the live variables at the moment it is reached."""

    async def test_a_case_body_can_open_a_later_case(self) -> None:
        """Case 1's sub-flow flips case 2's condition from false to true;
        with break off case 2 then runs. Fails if conditions are evaluated up
        front."""
        session_id = "sw-b11-open"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _equals("flag", "a"), break_on=False),
                    _case("branch_1", _equals("gate", "open")),
                ],
            ),
            _make_setter_node("open-gate", "Open Gate", {"gate": "open"}),
            _make_log_node("case-b", "Case B", "'CASE-B-RAN'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "open-gate", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"flag": "a", "gate": "closed"}
        session = await _run(session_id, nodes, edges, variables)

        messages = _log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert variables["gate"] == "open", variables
        assert "CASE-B-RAN" in messages, messages
        assert session["block_states"]["case-b"] == "passed", session["block_states"]

    async def test_a_case_body_can_close_a_later_case(self) -> None:
        """Case 1's sub-flow flips case 2's condition from true to false;
        case 2 does not run."""
        session_id = "sw-b11-close"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _equals("flag", "a"), break_on=False),
                    _case("branch_1", _equals("gate", "open")),
                ],
            ),
            _make_setter_node("close-gate", "Close Gate", {"gate": "closed"}),
            _make_log_node("case-b", "Case B", "'CASE-B-RAN'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "close-gate", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"flag": "a", "gate": "open"}
        session = await _run(session_id, nodes, edges, variables)

        messages = _log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert variables["gate"] == "closed", variables
        assert "CASE-B-RAN" not in messages, messages
        assert session["block_states"]["case-b"] == "skipped", session["block_states"]
        assert session["block_states"]["after-log"] == "passed", session["block_states"]


# ---------------------------------------------------------------------------
# The run log names each case (SWITCH-12)
# ---------------------------------------------------------------------------


class TestSwitchLogging:
    """The dispatcher names every taken branch in the execution log."""

    async def test_a_taken_case_logs_its_label(self) -> None:
        """A labeled case logs 'Branch taken: <label>'."""
        session_id = "sw-log-label"
        nodes = [
            _make_switch_node("sw-1", [_case("branch_0", _ALWAYS_TRUE, label="Fast")]),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await _run(session_id, nodes, edges, {})

        messages = _log_messages(session_id)
        assert "Branch taken: Fast" in messages, messages

    async def test_the_branch_line_carries_the_switch_type_as_its_source(self) -> None:
        """EXEC-25: a Switch that keeps its catalog name writes the line under 'Switch'."""
        session_id = "sw-log-source-type"
        nodes = [
            _make_switch_node("sw-1", [_case("branch_0", _ALWAYS_TRUE, label="Fast")]),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
        ]

        await _run(session_id, nodes, edges, {})

        assert _log_sources(session_id, "Branch taken: Fast") == ["Switch"]

    async def test_the_branch_line_carries_the_switch_name_in_its_source(self) -> None:
        """EXEC-25: a named Switch writes the line under 'Switch : <Name>'."""
        session_id = "sw-log-source-name"
        switch = _make_switch_node("sw-1", [_case("branch_0", _ALWAYS_TRUE, label="Fast")])
        switch["data"]["label"] = "Route order"
        nodes = [switch, _make_log_node("case-a", "Case A", "'CASE-A'")]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
        ]

        await _run(session_id, nodes, edges, {})

        assert _log_sources(session_id, "Branch taken: Fast") == ["Switch : Route order"]

    async def test_an_unlabeled_case_logs_its_position(self) -> None:
        """An empty label falls back to 'case (branch N)'."""
        session_id = "sw-log-position"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _ALWAYS_FALSE),
                    _case("branch_1", _ALWAYS_TRUE),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await _run(session_id, nodes, edges, {})

        messages = _log_messages(session_id)
        assert "Branch taken: case (branch 2)" in messages, messages
        assert "Branch taken: case (branch 1)" not in messages, messages

    async def test_the_default_logs_its_position(self) -> None:
        """The default logs 'Branch taken: default (branch N)'."""
        session_id = "sw-log-default"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _ALWAYS_FALSE),
                    _case("branch_1", _ALWAYS_FALSE),
                    _default("branch_2"),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("def-a", "Default A", "'DEFAULT'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "def-a", "sourceHandle": "branch_2"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await _run(session_id, nodes, edges, {})

        messages = _log_messages(session_id)
        assert "Branch taken: default (branch 3)" in messages, messages

    async def test_no_match_without_a_default_logs_no_case_matched(self) -> None:
        """Nothing matched and no default - the log says so."""
        session_id = "sw-log-no-match"
        nodes = [
            _make_switch_node("sw-1", [_case("branch_0", _ALWAYS_FALSE)]),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        await _run(session_id, nodes, edges, {})

        messages = _log_messages(session_id)
        assert "No case matched" in messages, messages


# ---------------------------------------------------------------------------
# Failure and halt inside a case body
# ---------------------------------------------------------------------------


class TestSwitchErrorPropagation:
    """A failing or halting case body stops the Switch and the ``then`` path."""

    async def test_failing_case_node_skips_the_rest_and_the_then_path(self) -> None:
        """A failure inside a case chain skips the remainder of that chain,
        repaints the SWITCH node failed, skips ``then`` and fails the session.
        The later case that break-off would have reached, and the default,
        are still painted skipped - there is no unpainted tail state."""
        # Guard: a Switch whose case chain failed must not paint passed.
        session_id = "sw-case-fails"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _ALWAYS_TRUE, break_on=False),
                    _case("branch_1", _ALWAYS_TRUE),
                    _default("branch_2"),
                ],
            ),
            _make_log_node("case-a1", "Case A1", "'A1'"),
            _make_log_node("case-a2", "Case A2", "1/0"),
            _make_log_node("case-a3", "Case A3", "'A3'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("def-a", "Default A", "'DEFAULT'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a1", "sourceHandle": "branch_0"},
            {"source": "case-a1", "target": "case-a2"},
            {"source": "case-a2", "target": "case-a3"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "def-a", "sourceHandle": "branch_2"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {})

        messages = _log_messages(session_id)
        assert session["status"] == "failed", session.get("status")
        assert session["block_states"]["sw-1"] == "failed", session["block_states"]
        assert session["block_states"]["case-a1"] == "passed", session["block_states"]
        assert session["block_states"]["case-a2"] == "failed", session["block_states"]
        assert session["block_states"]["case-a3"] == "skipped", session["block_states"]
        assert session["block_states"]["case-b"] == "skipped", session["block_states"]
        assert session["block_states"]["def-a"] == "skipped", session["block_states"]
        assert "CASE-B" not in messages, messages
        assert "DEFAULT" not in messages, messages
        assert session["block_states"]["after-log"] == "skipped", session["block_states"]

    async def test_a_failing_case_fails_the_run_without_a_then_path(self) -> None:
        """A Switch that is the last block on the canvas still fails the run."""
        # Guard: the ``then`` path is where the run stops, not what makes it fail.
        session_id = "sw-case-fails-no-then"
        nodes = [
            _make_switch_node("sw-1", [_case("branch_0", _ALWAYS_TRUE)]),
            _make_log_node("case-a", "Case A", "1/0"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
        ]

        session = await _run(session_id, nodes, edges, {})

        messages = _log_messages(session_id)
        assert session["status"] == "failed", session.get("status")
        assert session["block_states"]["sw-1"] == "failed", session["block_states"]
        assert "completed successfully" not in " ".join(messages), messages

    async def test_a_passing_case_without_a_then_path_still_passes(self) -> None:
        """Guard: the verdict follows the case chain, not the missing ``then``."""
        session_id = "sw-case-passes-no-then"
        nodes = [
            _make_switch_node("sw-1", [_case("branch_0", _ALWAYS_TRUE)]),
            _make_log_node("case-a", "Case A", "'A'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
        ]

        session = await _run(session_id, nodes, edges, {})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["sw-1"] == "passed", session["block_states"]

    async def test_halt_in_a_case_body_stops_the_switch(self) -> None:
        """A Halt inside a case body ends the Switch even with break off: no
        later case is evaluated, the ``then`` successor is skipped and the
        session fails. The never-reached case chain and the default are
        still painted skipped."""
        session_id = "sw-case-halt"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _ALWAYS_TRUE, break_on=False),
                    _case("branch_1", _ALWAYS_TRUE),
                    _default("branch_2"),
                ],
            ),
            _make_halt_node("halt-1", "Halt In Case"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("def-a", "Default A", "'DEFAULT'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "halt-1", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "def-a", "sourceHandle": "branch_2"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {})

        messages = _log_messages(session_id)
        assert session["status"] == "failed", session.get("status")
        assert session["block_states"]["halt-1"] == "failed", session["block_states"]
        assert session["block_states"]["case-b"] == "skipped", session["block_states"]
        assert session["block_states"]["def-a"] == "skipped", session["block_states"]
        assert session["block_states"]["after-log"] == "skipped", session["block_states"]
        assert "CASE-B" not in messages, messages
        assert "DEFAULT" not in messages, messages
        assert "AFTER" not in messages, messages


# ---------------------------------------------------------------------------
# The Switch declares no outputs (SWITCH-12)
# ---------------------------------------------------------------------------


class TestSwitchDeclaresNoOutputs:
    """The engine signal never surfaces as a bindable output."""

    async def test_engine_keys_never_reach_the_variables(self) -> None:
        """A Switch with no output bindings runs clean and leaks neither
        __switch nor __switch_branches into the variables."""
        # Guard: nothing stands in for the deleted matchedCase output.
        session_id = "sw-no-outputs"
        branches = [_case("branch_0", _ALWAYS_TRUE)]
        switch_node = _make_switch_node("sw-1", branches)
        switch_node["data"]["config"]["outputBindings"] = {}
        nodes = [
            switch_node,
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {}
        session = await _run(session_id, nodes, edges, variables)

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["sw-1"] == "passed", session["block_states"]
        assert "__switch" not in variables, sorted(variables)
        assert "__switch_branches" not in variables, sorted(variables)
        assert all(value != branches for value in variables.values()), sorted(variables)


# ---------------------------------------------------------------------------
# Nesting
# ---------------------------------------------------------------------------


class TestSwitchNestedInTryCatch:
    """A Switch inside a try path dispatches and the chain resumes past it."""

    async def test_enclosing_try_chain_continues_through_the_then_handle(self) -> None:
        """The traced try chain follows the Switch's ``then`` handle instead of
        walking into its first case."""
        # Guard: the chain tracer must treat 'then' as a container handle.
        session_id = "sw-nested-try"
        tc_node = _make_node(
            "tc-1",
            label="Try/Catch",
            element_type="try-catch-finally",
            node_type="control",
            version="1.0.0",
            config_values={"enable_catch": True, "enable_finally": False},
            description="Try/Catch",
        )
        tc_node["data"]["config"]["outputBindings"] = {}
        nodes = [
            tc_node,
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _equals("flag", "a")),
                    _case("branch_1", _ALWAYS_TRUE),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("after-sw", "After Switch", "'AFTER-SWITCH'"),
            _make_log_node("catch-log", "Catch", "'CAUGHT'"),
            _make_log_node("then-tc", "Then TC", "'AFTER-TC'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "sw-1", "sourceHandle": "try"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "after-sw", "sourceHandle": "then"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "then-tc", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"flag": "a"})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["case-a"] == "passed", session["block_states"]
        assert session["block_states"]["case-b"] == "skipped", session["block_states"]
        assert session["block_states"]["after-sw"] == "passed", session["block_states"]
        assert session["block_states"]["catch-log"] == "skipped", session["block_states"]
        assert session["block_states"]["then-tc"] == "passed", session["block_states"]

    async def test_a_mid_chain_switch_hands_control_to_its_then_successor(self) -> None:
        """A Switch sitting between two nodes of a try path passes control on
        through ``then``; its first case is never the sequential successor."""
        # Guard: a nested container must not be walked into its first branch.
        session_id = "sw-nested-try-mid"
        tc_node = _make_node(
            "tc-1",
            label="Try/Catch",
            element_type="try-catch-finally",
            node_type="control",
            version="1.0.0",
            config_values={"enable_catch": True, "enable_finally": False},
            description="Try/Catch",
        )
        tc_node["data"]["config"]["outputBindings"] = {}
        nodes = [
            tc_node,
            _make_log_node("before-sw", "Before Switch", "'BEFORE-SWITCH'"),
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _ALWAYS_FALSE),
                    _case("branch_1", _ALWAYS_TRUE),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("after-sw", "After Switch", "'AFTER-SWITCH'"),
            _make_log_node("catch-log", "Catch", "'CAUGHT'"),
            _make_log_node("then-tc", "Then TC", "'AFTER-TC'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "before-sw", "sourceHandle": "try"},
            {"source": "before-sw", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "after-sw", "sourceHandle": "then"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "then-tc", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {})

        messages = _log_messages(session_id)
        marks = [m for m in messages if m in ("BEFORE-SWITCH", "CASE-A", "CASE-B", "AFTER-SWITCH")]
        assert session["status"] == "passed", session.get("status")
        assert marks == ["BEFORE-SWITCH", "CASE-B", "AFTER-SWITCH"], messages
        assert session["block_states"]["case-a"] == "skipped", session["block_states"]
        assert session["block_states"]["after-sw"] == "passed", session["block_states"]
        assert session["block_states"]["then-tc"] == "passed", session["block_states"]

    async def test_halt_in_a_nested_case_body_skips_catch_and_finally(self) -> None:
        """A Halt inside a case body nested in a try path behaves exactly like a
        Halt in a plain try node: catch and finally are skipped."""
        session_id = "sw-nested-try-halt"
        tc_node = _make_node(
            "tc-1",
            label="Try/Catch",
            element_type="try-catch-finally",
            node_type="control",
            version="1.0.0",
            config_values={"enable_catch": True, "enable_finally": True},
            description="Try/Catch",
        )
        tc_node["data"]["config"]["outputBindings"] = {}
        nodes = [
            tc_node,
            _make_switch_node("sw-1", [_case("branch_0", _ALWAYS_TRUE)]),
            _make_halt_node("halt-1", "Halt In Case"),
            _make_log_node("after-sw", "After Switch", "'AFTER-SWITCH'"),
            _make_log_node("catch-log", "Catch", "'CAUGHT'"),
            _make_log_node("fin-log", "Finally", "'FINALLY'"),
        ]
        edges = [
            {"source": "start-node", "target": "tc-1"},
            {"source": "tc-1", "target": "sw-1", "sourceHandle": "try"},
            {"source": "sw-1", "target": "halt-1", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "after-sw", "sourceHandle": "then"},
            {"source": "tc-1", "target": "catch-log", "sourceHandle": "catch"},
            {"source": "tc-1", "target": "fin-log", "sourceHandle": "finally"},
        ]

        session = await _run(session_id, nodes, edges, {})

        assert session["status"] == "failed", session.get("status")
        assert session["block_states"]["catch-log"] == "skipped", session["block_states"]
        assert session["block_states"]["fin-log"] == "skipped", session["block_states"]
        assert session["block_states"]["after-sw"] == "skipped", session["block_states"]


class TestSwitchNestedInLoop:
    """A Switch inside a loop body dispatches on every iteration."""

    async def test_switch_dispatches_once_per_iteration(self) -> None:
        """Each of the 3 iterations re-evaluates the Switch, names the taken
        case AND re-runs the matching case body."""
        # Guard: a Switch in a loop must re-run its case body on every iteration.
        session_id = "sw-nested-loop"
        nodes = [
            _make_for_each_node("fe-1", ["a", "b", "c"]),
            _make_switch_node("sw-1", [_case("branch_0", _ALWAYS_TRUE)]),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("after-sw", "After Switch", "'AFTER-SWITCH'"),
            _make_log_node("after-loop", "After Loop", "'AFTER-LOOP'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "sw-1", "sourceHandle": "body"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "after-sw", "sourceHandle": "then"},
            {"source": "fe-1", "target": "after-loop", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"fe_item": None, "fe_idx": None})

        messages = _log_messages(session_id)
        taken = [m for m in messages if m == "Branch taken: case (branch 1)"]
        assert session["status"] == "passed", session.get("status")
        assert len(taken) == 3, messages
        assert messages.count("CASE-A") == 3, messages
        assert session["block_states"]["case-a"] == "passed", session["block_states"]
        assert session["block_states"]["after-loop"] == "passed", session["block_states"]

    async def test_the_whole_case_chain_re_runs_every_iteration(self) -> None:
        """A node nested behind the case head re-runs on every iteration
        too - the loop clears the whole case chain, not just its head."""
        # Guard: the loop must clear the whole case chain, not just the body chain.
        session_id = "sw-nested-loop-chain"
        nodes = [
            _make_for_each_node("fe-1", ["a", "b", "c"]),
            _make_switch_node("sw-1", [_case("branch_0", _ALWAYS_TRUE)]),
            _make_log_node("case-a1", "Case A1", "'A1'"),
            _make_setter_node(
                "case-a2",
                "Bump Counter",
                {"counter": "counter + 1"},
                expressions=True,
            ),
            _make_log_node("after-sw", "After Switch", "'AFTER-SWITCH'"),
            _make_log_node("after-loop", "After Loop", "'AFTER-LOOP'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "sw-1", "sourceHandle": "body"},
            {"source": "sw-1", "target": "case-a1", "sourceHandle": "branch_0"},
            {"source": "case-a1", "target": "case-a2"},
            {"source": "sw-1", "target": "after-sw", "sourceHandle": "then"},
            {"source": "fe-1", "target": "after-loop", "sourceHandle": "then"},
        ]

        variables: dict[str, Any] = {"fe_item": None, "fe_idx": None, "counter": 0}
        session = await _run(session_id, nodes, edges, variables)

        messages = _log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert messages.count("A1") == 3, messages
        assert variables["counter"] == 3, variables
        assert session["block_states"]["case-a2"] == "passed", session["block_states"]
        assert session["block_states"]["after-loop"] == "passed", session["block_states"]


class TestSwitchNestedInFunction:
    """A Switch inside a Function body dispatches through the body walker."""

    async def test_case_body_and_then_path_run_inside_a_function(self) -> None:
        """The Function body walker dispatches the Switch, resumes at its
        ``then`` successor and skips the non-matching case chain."""
        # Guard: the body walker must not run a non-matching case head as a plain step.
        session_id = "sw-nested-function"
        body_nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case("branch_0", _ALWAYS_TRUE),
                    _case("branch_1", _ALWAYS_FALSE),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-IN-FUNCTION'"),
            _make_log_node("case-b", "Case B", "'OTHER-CASE-IN-FUNCTION'"),
            _make_log_node("after-sw", "After Switch", "'AFTER-SWITCH-IN-FUNCTION'"),
        ]
        body_edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "after-sw", "sourceHandle": "then"},
        ]
        definition = _local_def("SwitchHolder", body_nodes, body_edges)
        nodes = [_local_function_node("fn-1", definition)]
        edges = [{"source": "start-node", "target": "fn-1"}]

        session = await _run(session_id, nodes, edges, {})

        messages = _log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert session["block_states"].get("fn-1") == "passed", session["block_states"]
        assert "CASE-IN-FUNCTION" in messages, messages
        assert "AFTER-SWITCH-IN-FUNCTION" in messages, messages
        assert "OTHER-CASE-IN-FUNCTION" not in messages, messages
        assert session["block_states"]["case-b"] == "skipped", session["block_states"]


class TestLoopSignalInsideACaseBody:
    """Break/Continue inside a case body target the ENCLOSING loop."""

    async def test_break_exits_the_enclosing_loop_and_skips_the_switch_then(
        self,
    ) -> None:
        """A Break inside a case body breaks the for-each and the Switch's
        ``then`` successor is not executed for that iteration."""
        session_id = "sw-case-break"
        nodes = [
            _make_for_each_node("fe-1", ["a", "b"]),
            _make_switch_node("sw-1", [_case("branch_0", _ALWAYS_TRUE)]),
            _make_loop_signal_node("brk-1", "break", "Break In Case", "fe-1"),
            _make_log_node("after-sw", "After Switch", "'AFTER-SWITCH'"),
            _make_log_node("after-loop", "After Loop", "'AFTER-LOOP'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "sw-1", "sourceHandle": "body"},
            {"source": "sw-1", "target": "brk-1", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "after-sw", "sourceHandle": "then"},
            {"source": "fe-1", "target": "after-loop", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"fe_item": None, "fe_idx": None})

        messages = _log_messages(session_id)
        taken = [m for m in messages if m == "Branch taken: case (branch 1)"]
        assert session["status"] == "passed", session.get("status")
        assert len(taken) == 1, messages
        assert session["block_states"]["after-sw"] == "skipped", session["block_states"]
        assert "AFTER-SWITCH" not in messages, messages
        assert session["block_states"]["after-loop"] == "passed", session["block_states"]

    async def test_continue_advances_the_enclosing_loop_and_skips_the_switch_then(
        self,
    ) -> None:
        """A Continue inside a case body advances the for-each and the Switch's
        ``then`` successor is not executed for that iteration."""
        session_id = "sw-case-continue"
        nodes = [
            _make_for_each_node("fe-1", ["a"]),
            _make_switch_node("sw-1", [_case("branch_0", _ALWAYS_TRUE)]),
            _make_loop_signal_node("cont-1", "continue", "Continue In Case", "fe-1"),
            _make_log_node("after-sw", "After Switch", "'AFTER-SWITCH'"),
            _make_log_node("after-loop", "After Loop", "'AFTER-LOOP'"),
        ]
        edges = [
            {"source": "start-node", "target": "fe-1"},
            {"source": "fe-1", "target": "sw-1", "sourceHandle": "body"},
            {"source": "sw-1", "target": "cont-1", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "after-sw", "sourceHandle": "then"},
            {"source": "fe-1", "target": "after-loop", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"fe_item": None, "fe_idx": None})

        messages = _log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["after-sw"] == "skipped", session["block_states"]
        assert "AFTER-SWITCH" not in messages, messages
        assert session["block_states"]["after-loop"] == "passed", session["block_states"]


# ---------------------------------------------------------------------------
# Disabled Switch cascade (SWITCH-11)
# ---------------------------------------------------------------------------


class TestDisabledSwitchCascade:
    """A disabled Switch cascade-skips every case and the default."""

    async def test_every_branch_skips_and_the_then_path_continues(self) -> None:
        """A disabled Switch renders each case chain and the default as skipped
        while the ``then`` successor still executes."""
        session_id = "sw-disabled"
        switch_node = _make_switch_node(
            "sw-1",
            [
                _case("branch_0", _ALWAYS_TRUE),
                _case("branch_1", _ALWAYS_TRUE),
                _default("branch_2"),
            ],
        )
        switch_node["data"]["disabled"] = True
        nodes = [
            switch_node,
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("case-b", "Case B", "'CASE-B'"),
            _make_log_node("def-a", "Default A", "'DEFAULT'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "case-b", "sourceHandle": "branch_1"},
            {"source": "sw-1", "target": "def-a", "sourceHandle": "branch_2"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["sw-1"] == "skipped", session["block_states"]
        for nid in ("case-a", "case-b", "def-a"):
            assert session["block_states"][nid] == "skipped", session["block_states"]
        assert session["block_states"]["after-log"] == "passed", session["block_states"]


class TestSwitchConditionsAreReadOnly:
    """A case condition is a read: it may not change what it tests."""

    async def test_a_case_condition_that_changes_a_list_fails_the_run(self) -> None:
        session_id = "sw-read-only"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case(
                        "branch_0",
                        [{"type": "expression", "expression": "rows.append(9) or True"}],
                    ),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]
        variables = {"rows": [1]}

        session = await _run(session_id, nodes, edges, variables)

        assert session["status"] == "failed", session.get("status")
        assert variables["rows"] == [1]
        assert any("add a Variable Setter Block" in m for m in _log_messages(session_id))

    async def test_a_case_condition_that_only_reads_still_matches(self) -> None:
        session_id = "sw-read-only-ok"
        nodes = [
            _make_switch_node(
                "sw-1",
                [
                    _case(
                        "branch_0",
                        [{"type": "expression", "expression": "len(rows) == 1"}],
                    ),
                ],
            ),
            _make_log_node("case-a", "Case A", "'CASE-A'"),
            _make_log_node("after-log", "After", "'AFTER'"),
        ]
        edges = [
            {"source": "start-node", "target": "sw-1"},
            {"source": "sw-1", "target": "case-a", "sourceHandle": "branch_0"},
            {"source": "sw-1", "target": "after-log", "sourceHandle": "then"},
        ]

        session = await _run(session_id, nodes, edges, {"rows": [1]})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["case-a"] == "passed", session["block_states"]
