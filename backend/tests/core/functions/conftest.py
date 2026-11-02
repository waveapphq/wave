"""Shared fixtures for Function executor tests."""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

import pytest


@pytest.fixture(autouse=True)
def register_test_plugins() -> Generator[None, None, None]:
    """Register the log plugin + core controls so Function flows can run."""
    from wavecore.api.services.workbench import _common as _wb_common
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


def register_engine_session(session_id: str) -> dict[str, Any]:
    """A minimal live run session, so a Function flow runs on the engine."""
    from wavecore.api.services.workbench import _common as _wb_common

    session: dict[str, Any] = {
        "session_id": session_id,
        "status": "running",
        "block_states": {},
        "variables": {},
        "websocket_topic": f"workbench:{session_id}",
        "log_topic": f"log:{session_id}",
        "skipped_node_ids": [],
        "scope_failed": False,
    }
    _wb_common._workbench_sessions[session_id] = session
    return session


@pytest.fixture
def session_id(request: pytest.FixtureRequest) -> Generator[str, None, None]:
    """A live run session of the test's own, its run log cleared afterwards."""
    from wavecore.api.services import log_streaming_service

    sid = f"fn-exec-{request.node.name}"
    register_engine_session(sid)
    yield sid
    log_streaming_service._clear_session_logs(sid)


def make_function_def(
    *,
    name: str = "callee",
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    variables: list[dict[str, Any]] | None = None,
    nodes: list[dict[str, Any]] | None = None,
    edges: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a Function definition dict in the on-disk shape."""
    return {
        "id": "callee-id",
        "name": name,
        "description": "",
        "tags": [],
        "inputs": inputs or [],
        "outputs": outputs or [],
        "variables": variables or [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {
            "nodes": nodes or [],
            "edges": edges or [],
        },
        "metadata": {
            "author": "wave",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        },
    }


def make_log_node(
    node_id: str,
    *,
    message: str,
    output_bindings: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build a log-plugin workflow node with optional output bindings."""
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
                "outputBindings": output_bindings or {},
            },
            "displayName": node_id,
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def make_echo_function(
    name: str, declaration: dict[str, Any], message: str | None = None
) -> dict[str, Any]:
    """A Function whose one Block writes ``message`` (default: the input) to ``result``."""
    return make_function_def(
        name="echo_input",
        inputs=[{"name": name, **declaration}],
        outputs=[{"name": "result", "type": "string"}],
        nodes=[
            make_log_node(
                "echo",
                message=message or f"'null' if {name} is None else str({name})",
                output_bindings={"line": "result"},
            )
        ],
        edges=[{"source": "start-node", "target": "echo"}],
    )


def local_function(definition: dict[str, Any]) -> dict[str, Any]:
    """The Function Block data that runs ``definition`` as a Local Function."""
    return {"functionLifecycle": "local", "localDefinition": definition}


def make_function_block(
    node_id: str,
    function: dict[str, Any],
    *,
    values: dict[str, Any] | None = None,
    expressions: dict[str, str] | None = None,
    output_bindings: dict[str, str] | None = None,
) -> dict[str, Any]:
    """A Function Block in the stored shape: literal ``values`` and ``expressions`` in
    ``config.values``, the expression names flagged; ``function`` names the Function it runs."""
    stored = {**(values or {}), **(expressions or {})}
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "config": {
                "values": stored,
                "profileBindings": [],
                "outputBindings": dict(output_bindings or {}),
            },
            "expressionFields": list(expressions or {}),
            "templateFields": [],
            "displayName": node_id,
            **function,
        },
    }
