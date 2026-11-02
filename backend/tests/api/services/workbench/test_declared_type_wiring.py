"""The run hands each block the declared types of its bound variables (SHRUN-6).

The run start records the declared type of every test variable, the walk
publishes them in a scope, and a plugin's context carries the type of each
target its outputs are bound to. A Shell Script then reads its variable exports
as those types, so `COUNT=007` bound to an integer variable arrives as 7.
"""

import asyncio
import uuid
from typing import Any
from unittest.mock import patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    make_node,
    make_session,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.core.plugin_registry import register_plugin
from wavecore.plugins.shell_script import ShellScriptPlugin

pytestmark = pytest.mark.usefixtures("engine_registries")

_DECLARATIONS: dict[str, Any] = {
    "c": {"type": "integer"},
    "s": {"type": "string"},
    "u": {"type": "float"},
}


class _TypeProbePlugin:
    """Minimal plugin capturing the execution context it receives."""

    def __init__(self) -> None:
        self.context: dict[str, Any] | None = None

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": "type-probe",
            "name": "Type Probe",
            "version": "1.0.0",
            "category": "system",
            "description": "probe",
            "parameters": [],
            "return_type": "map",
            "output_schema": [],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        pass

    async def initialize(self, context: dict[str, Any]) -> None:
        pass

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        self.context = context
        return {"ok": True}

    async def cleanup(self) -> None:
        pass


def _test_record(test_id: str) -> dict[str, Any]:
    """A stored test whose only block is a Log, carrying declared variables."""
    node = make_node(
        "log-1",
        label="Log",
        element_type="log",
        node_type="plugin",
        config_values={"message": "'ok'", "level": "INFO"},
    )
    node["data"]["expressionFields"] = ["message"]
    return {
        "id": test_id,
        "name": "Declared Types Test",
        "workflow": {"nodes": [node], "edges": []},
        "variables": dict(_DECLARATIONS),
    }


async def _run_graph_with_types(
    session_id: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    variables: dict[str, Any],
    variable_types: dict[str, str],
) -> dict[str, Any]:
    """Seed a session carrying declared types and run the graph to completion."""
    session = make_session(session_id)
    session["variable_types"] = variable_types
    _wb_common._workbench_sessions[session_id] = session
    await asyncio.wait_for(
        workbench_service._execute_workflow(session_id, nodes, edges, variables),
        timeout=15.0,
    )
    return session


class TestTheRunRecordsTheDeclaredTypes:
    """Run start stores the declared type of every variable the test declares."""

    def test_the_session_carries_a_type_per_declared_variable(self) -> None:
        test_id = str(uuid.uuid4())
        record = _test_record(test_id)
        with (
            patch(
                "wavecore.api.services.workbench.service.test_service.get_test",
                return_value=record,
            ),
            patch(
                "wavecore.api.services.workbench.service.test_service.get_test_variables_raw",
                return_value=dict(_DECLARATIONS),
            ),
            patch(
                "wavecore.api.services.workbench.service.environment_service.get_environment",
                return_value={"id": "env-1", "name": "Dev"},
            ),
            patch("wavecore.api.services.workbench.service.asyncio.create_task"),
        ):
            run_info = workbench_service.start_workbench_run(
                test_id=test_id,
                environment_id="env-1",
            )

        session = _wb_common._workbench_sessions[run_info["session_id"]]
        assert session["variable_types"] == {"c": "integer", "s": "string", "u": "float"}


class TestTheDeclaredTypesReachThePluginContext:
    """A plugin is told the type of each target its outputs bind to."""

    async def test_a_bound_target_carries_its_declared_type(self) -> None:
        probe = _TypeProbePlugin()
        register_plugin(probe)
        node = make_node(
            "probe-1",
            label="Probe",
            element_type="type-probe",
            node_type="plugin",
            config_values={},
            output_bindings={"COUNT": "c", "X": "undeclared"},
        )

        await _run_graph_with_types(
            "declared-types-probe",
            [node],
            [edge("start-node", "probe-1")],
            {"c": 0},
            {"c": "integer"},
        )

        assert probe.context is not None
        assert probe.context["output_types"] == {"COUNT": "integer"}

    async def test_a_run_with_no_declared_types_passes_an_empty_map(self) -> None:
        probe = _TypeProbePlugin()
        register_plugin(probe)
        node = make_node(
            "probe-1",
            label="Probe",
            element_type="type-probe",
            node_type="plugin",
            config_values={},
            output_bindings={"COUNT": "c"},
        )

        await _run_graph_with_types(
            "declared-types-probe-none",
            [node],
            [edge("start-node", "probe-1")],
            {"c": 0},
            {},
        )

        assert probe.context is not None
        assert probe.context["output_types"] == {}


class TestAShellScriptReadsItsExportAsTheDeclaredType:
    """SHRUN-6: the export is read as the bound variable's type, not as text."""

    async def test_an_export_bound_to_an_integer_variable_arrives_as_an_integer(self) -> None:
        register_plugin(ShellScriptPlugin())
        node = make_node(
            "shell-1",
            label="Shell Script",
            element_type="shell-script",
            node_type="plugin",
            config_values={
                "script": "COUNT=007\n",
                "shell": "/bin/bash",
                "timeout": 60,
                "on_error": "fail",
                "script_variables": ["COUNT"],
            },
            output_bindings={"COUNT": "c"},
        )
        variables: dict[str, Any] = {"c": 0}

        session = await _run_graph_with_types(
            "declared-types-shell-script",
            [node],
            [edge("start-node", "shell-1")],
            variables,
            {"c": "integer"},
        )

        assert session["status"] == "passed", session.get("status")
        assert session["variables"]["c"] == 7, session["variables"]
        assert isinstance(session["variables"]["c"], int), type(session["variables"]["c"])
