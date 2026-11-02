"""Shared graph builders for the Parallel dispatch tests.

Every Parallel test drives a real graph through
``workbench_service._execute_workflow`` and observes the session dict, the
live variables dict and the execution log. The builders live here so the eight
Parallel test modules describe only the behavior they cover.
"""

import asyncio
from typing import Any

import pytest

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service


@pytest.fixture
def engine_registries() -> Any:
    """Register controls/plugins and clear sessions before and after a test."""
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


def make_session(session_id: str, *, breakpoints: set[str] | None = None) -> dict[str, Any]:
    """A minimal workbench session, optionally armed with breakpoints."""
    return {
        "session_id": session_id,
        "status": "running",
        "current_block": None,
        "progress": {"current": 0, "total": 0, "percentage": 0.0},
        "block_states": {},
        "test_name": "Parallel Test",
        "scope_failed": False,
        "variables": {},
        "breakpoints": set(breakpoints or set()),
        "debug_options": None,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
        "skipped_node_ids": [],
        "websocket_topic": f"workbench:{session_id}",
        "log_topic": f"log:{session_id}",
    }


def make_node(
    node_id: str,
    label: str = "Block",
    element_type: str = "delay",
    node_type: str = "control",
    version: str = "1.0.0",
    config_values: dict[str, Any] | None = None,
    output_bindings: dict[str, str] | None = None,
    name: str | None = None,
    disabled: bool = False,
) -> dict[str, Any]:
    """A workflow node record in the shape the engine reads; ``name`` is the block's Name."""
    config: dict[str, Any] = {"values": config_values or {"duration": 10}}
    if output_bindings:
        config["outputBindings"] = output_bindings
    config.setdefault("profileBindings", [])
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": name or label,
            "elementType": element_type,
            "nodeType": node_type,
            "version": version,
            "config": config,
            "disabled": disabled,
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def log_node(node_id: str, name: str, message: str = "'ok'") -> dict[str, Any]:
    """A Log plugin node whose message is an expression."""
    node = make_node(
        node_id,
        label="Log",
        element_type="log",
        node_type="plugin",
        config_values={"message": message, "level": "INFO"},
        name=name,
    )
    node["data"]["expressionFields"] = ["message"]
    return node


def delay_node(node_id: str, duration_ms: int, name: str = "Delay") -> dict[str, Any]:
    """A Delay control node used to make one branch outlast another."""
    return make_node(
        node_id,
        label="Delay",
        element_type="delay",
        node_type="control",
        config_values={"duration": duration_ms},
        name=name,
    )


def setter_node(
    node_id: str,
    name: str,
    values: dict[str, Any],
    expressions: bool = False,
) -> dict[str, Any]:
    """A Variable Setter control node writing ``values``."""
    node = make_node(
        node_id,
        label="Variable Setter",
        element_type="variable-setter",
        node_type="control",
        config_values={"variables": values},
        name=name,
    )
    if expressions:
        node["data"]["variableExpressionKeys"] = list(values)
    return node


def halt_node(
    node_id: str,
    name: str = "Halt",
    scope: str = "test",
    status: str = "failed",
) -> dict[str, Any]:
    """A Halt control node carrying an explicit scope and status."""
    node = make_node(
        node_id,
        label="Halt",
        element_type="halt",
        node_type="control",
        config_values={"scope": scope, "status": status, "message": "'stop'"},
        name=name,
    )
    node["data"]["expressionFields"] = ["message"]
    return node


def assert_node(
    node_id: str,
    expression: str,
    name: str = "Assert",
    fail_current_scope: bool = True,
) -> dict[str, Any]:
    """A single-mode Assert control node over one expression condition."""
    return make_node(
        node_id,
        label="Assert",
        element_type="assert",
        node_type="control",
        config_values={
            "assertions": [{"type": "expression", "expression": expression}],
            "mode": "single",
            "fail_current_scope": fail_current_scope,
        },
        name=name,
    )


def wait_node(
    node_id: str,
    expression: str,
    name: str = "Wait Until",
    timeout: int = 3000,
    check_interval: int = 10,
    output_bindings: dict[str, str] | None = None,
) -> dict[str, Any]:
    """A Watch-mode Wait Until node gated on one expression condition."""
    return make_node(
        node_id,
        label="Wait Until",
        element_type="wait-until",
        node_type="control",
        config_values={
            "conditions": [{"type": "expression", "expression": expression}],
            "timeout": timeout,
            "check_interval": check_interval,
            "mode": "watch",
        },
        output_bindings=output_bindings,
        name=name,
    )


def branch(branch_id: str, name: str = "", time_limit: int | None = None) -> dict[str, Any]:
    """A branch record as the canvas stores it."""
    record: dict[str, Any] = {"id": branch_id, "name": name}
    if time_limit is not None:
        record["time_limit"] = time_limit
    return record


def parallel_node(
    node_id: str,
    branches: list[dict[str, Any]],
    join: str | None = None,
    time_limit: int | None = None,
    name: str = "Parallel",
    disabled: bool = False,
) -> dict[str, Any]:
    """A Parallel control node carrying its branch records, join mode and limit."""
    values: dict[str, Any] = {"branches": branches}
    if join is not None:
        values["join"] = join
    if time_limit is not None:
        values["time_limit"] = time_limit
    node = make_node(
        node_id,
        label="Parallel",
        element_type="parallel",
        node_type="control",
        config_values=values,
        name=name,
        disabled=disabled,
    )
    node["data"]["config"]["outputBindings"] = {}
    return node


def loop_signal_node(
    node_id: str,
    element_type: str,
    target_loop: str,
    name: str | None = None,
) -> dict[str, Any]:
    """A Break or Continue control node aimed at ``target_loop``."""
    return make_node(
        node_id,
        label=element_type.title(),
        element_type=element_type,
        node_type="control",
        config_values={"target_loop": target_loop},
        name=name,
    )


def for_each_node(node_id: str, collection: list[Any]) -> dict[str, Any]:
    """A For-Each control node iterating ``collection``."""
    return make_node(
        node_id,
        label="ForEach",
        element_type="for-each",
        node_type="control",
        config_values={"collection": collection},
        output_bindings={"item": "fe_item", "index": "fe_idx"},
    )


def try_catch_node(
    node_id: str,
    enable_catch: bool = True,
    enable_finally: bool = False,
) -> dict[str, Any]:
    """A Try/Catch/Finally control node."""
    node = make_node(
        node_id,
        label="Try/Catch",
        element_type="try-catch-finally",
        node_type="control",
        config_values={"enable_catch": enable_catch, "enable_finally": enable_finally},
    )
    node["data"]["config"]["outputBindings"] = {}
    return node


def local_definition(
    name: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> dict[str, Any]:
    """A Local Function definition body."""
    return {
        "name": name,
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": nodes, "edges": edges},
    }


def function_node(node_id: str, definition: dict[str, Any]) -> dict[str, Any]:
    """A Local Function instance node."""
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
            "config": {"values": {}, "profileBindings": [], "outputBindings": {}},
        },
    }


def edge(source: str, target: str, handle: str | None = None) -> dict[str, Any]:
    """One workflow edge, optionally leaving through a named source handle."""
    record: dict[str, Any] = {"source": source, "target": target}
    if handle is not None:
        record["sourceHandle"] = handle
    return record


async def run_graph(
    session_id: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    variables: dict[str, Any],
    *,
    breakpoints: set[str] | None = None,
    timeout: float = 15.0,
) -> dict[str, Any]:
    """Seed a session, run the graph to completion, return the session."""
    _wb_common._workbench_sessions[session_id] = make_session(session_id, breakpoints=breakpoints)
    await asyncio.wait_for(
        workbench_service._execute_workflow(session_id, nodes, edges, variables),
        timeout=timeout,
    )
    return _wb_common._workbench_sessions[session_id]


def start_graph(
    session_id: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    variables: dict[str, Any],
    *,
    breakpoints: set[str] | None = None,
) -> tuple[dict[str, Any], "asyncio.Task[None]"]:
    """Seed a session and start the run without awaiting it (debug tests)."""
    session = make_session(session_id, breakpoints=breakpoints)
    _wb_common._workbench_sessions[session_id] = session
    task = asyncio.create_task(
        workbench_service._execute_workflow(session_id, nodes, edges, variables)
    )
    return session, task


async def wait_until_paused(session: dict[str, Any], node_id: str, ticks: int = 500) -> None:
    """Poll until the engine parks on ``node_id`` or the poll budget runs out."""
    for _ in range(ticks):
        await asyncio.sleep(0.01)
        if session.get("paused_node_id") == node_id:
            return


async def wait_for_any_pause(session: dict[str, Any], ticks: int = 500) -> str | None:
    """Poll until the engine parks anywhere; returns the node it parked on."""
    for _ in range(ticks):
        await asyncio.sleep(0.01)
        paused = session.get("paused_node_id")
        if paused is not None:
            return str(paused)
    return None


def log_messages(session_id: str) -> list[str]:
    """Every message the run wrote to the execution log, in order."""
    from wavecore.api.services import log_streaming_service

    return [
        entry.get("message", "")
        for entry in log_streaming_service.get_logs(session_id)
        if isinstance(entry, dict)
    ]
