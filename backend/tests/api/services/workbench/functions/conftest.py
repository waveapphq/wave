"""Shared fixtures for publish/detach service tests."""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

import pytest


@pytest.fixture(autouse=True)
def _register_core_plugins_and_controls() -> Generator[None, None, None]:
    """Register the log plugin + core controls so reference validators resolve."""
    try:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin
    except (ImportError, ModuleNotFoundError):
        yield
        return

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    yield
    _registry.clear()
    clear_registry()


def make_local_function_node(
    *,
    node_id: str = "fn-node-1",
    fn_name: str = "Greet User",
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    dependencies: dict[str, list[str]] | None = None,
    profile_bindings: list[dict[str, Any]] | None = None,
    extra_workflow_nodes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a Function node with `functionLifecycle="local"` ready for publishing.

    The returned dict matches the canvas-node shape persisted in the Test's
    `workflow.nodes` array. The body is intentionally minimal but valid
    enough that `validate_function_for_save` passes: a single Log plugin
    wired to the start edge.
    """
    body_nodes: list[dict[str, Any]] = [
        {
            "id": "inner_log",
            "type": "workflowNode",
            "data": {
                "label": "inner_log",
                "elementType": "log",
                "nodeType": "plugin",
                "version": "1.0.0",
                "config": {
                    "values": {"message": "'hi'", "level": "INFO"},
                    "outputBindings": {},
                },
                "expressionFields": ["message"],
            },
        }
    ]
    if extra_workflow_nodes:
        body_nodes.extend(extra_workflow_nodes)
    local_definition: dict[str, Any] = {
        "name": fn_name,
        "description": "A local Function.",
        "tags": [],
        "inputs": inputs or [],
        "outputs": outputs or [],
        "dependencies": dependencies or {"functions": [], "plugins": ["log"]},
        "workflow": {
            "nodes": body_nodes,
            "edges": [{"source": "start-node", "target": "inner_log"}],
        },
    }
    data: dict[str, Any] = {
        "label": fn_name,
        "elementType": "function",
        "nodeType": "function",
        "functionLifecycle": "local",
        "localDefinition": local_definition,
        "config": {"values": {}, "outputBindings": {}, "profileBindings": profile_bindings or []},
    }
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": data,
    }


def make_test_with_function_node(
    fn_node: dict[str, Any],
    *,
    test_name: str = "Container Test",
) -> dict[str, Any]:
    """Build a Test creation payload with a single Function node in its workflow."""
    return {
        "name": test_name,
        "description": "Test that hosts a Function instance for publish/detach tests.",
        "workflow": {
            "nodes": [fn_node],
            "edges": [{"source": "start-node", "target": fn_node["id"]}],
        },
        "variables": {},
    }


def make_published_function_payload(
    *,
    name: str = "Greet User",
    description: str = "",
    tags: list[str] | None = None,
    changelog: str = "",
    details: str = "",
) -> dict[str, Any]:
    """Build the publish-dialog payload accepted by `publish_local_function`."""
    return {
        "name": name,
        "description": description,
        "tags": tags or [],
        "changelog": changelog,
        "details": details,
    }
