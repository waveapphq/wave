"""Unit tests for the workbench Function-node shim (functions.py).

The shim lives at ``wavecore/api/services/workbench/functions.py`` and is
called from ``node_helpers.py`` whenever the engine reaches a Function
instance node. End-to-end runs are covered by ``test_workbench_function_runs.py``;
this file exercises the shim's private helpers and error paths directly.
"""

from __future__ import annotations

import asyncio
from collections.abc import Generator
from typing import Any

import pytest

from wavecore.api.services.workbench.functions import (
    _load_function_definition,
    handle_function_node,
)
from wavecore.api.services.workbench.node_helpers import _extract_node_fields


@pytest.fixture(autouse=True)
def register_plugins_and_controls() -> Generator[None, None, None]:
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


class TestLoadFunctionDefinition:
    """``_load_function_definition`` dispatches on ``functionLifecycle``."""

    def test_local_lifecycle_returns_localDefinition(self) -> None:
        local_def = {"name": "fn", "inputs": [], "outputs": []}
        result = _load_function_definition(
            {"functionLifecycle": "local", "localDefinition": local_def}
        )
        assert result is local_def

    def test_local_without_localDefinition_raises(self) -> None:
        with pytest.raises(RuntimeError, match=r"^Local Function block missing localDefinition$"):
            _load_function_definition({"functionLifecycle": "local"})

    def test_local_with_non_dict_localDefinition_raises(self) -> None:
        with pytest.raises(RuntimeError, match=r"^Local Function block missing localDefinition$"):
            _load_function_definition(
                {"functionLifecycle": "local", "localDefinition": "not-a-dict"}
            )

    def test_shared_without_functionId_raises(self) -> None:
        with pytest.raises(RuntimeError, match=r"^Shared Function block missing functionId$"):
            _load_function_definition({"functionLifecycle": "shared"})

    def test_shared_with_unknown_functionId_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Per REQ-3.1.2.2: the resolver propagates the storage layer's exact
        message so the execution engine surfaces the canonical wording."""
        from wavecore.api.services.functions import _storage as _fs

        def _fake_load(_function_id: str) -> Any:
            raise LookupError("Function 'fn-xyz' not found")

        monkeypatch.setattr(_fs, "load_function", _fake_load)
        with pytest.raises(RuntimeError, match=r"Function 'fn-xyz' not found"):
            _load_function_definition({"functionLifecycle": "shared", "functionId": "fn-xyz"})

    def _sealed_setter_workflow(self) -> dict[str, Any]:
        from wavecore.core.secrets.sealing import seal_workflow_node_secrets

        return seal_workflow_node_secrets(
            {
                "nodes": [
                    {
                        "id": "s1",
                        "type": "workflowNode",
                        "data": {
                            "elementType": "variable-setter",
                            "nodeType": "control",
                            "config": {
                                "values": {"variables": {"token": "sk-shared-secret"}},
                                "variableSecretKeys": ["token"],
                            },
                        },
                    }
                ],
                "edges": [],
            }
        )

    def test_shared_returns_resolved_definition_with_setter_secret_unsealed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A library def seals its setter node secrets at rest; the resolver unseals
        # so the body runs on the real value (REQ-4.5.1 run-load boundary).
        from wavecore.api.services.functions import _storage as _fs

        loaded_def = {
            "name": "shared_fn",
            "inputs": [],
            "outputs": [],
            "workflow": self._sealed_setter_workflow(),
        }

        monkeypatch.setattr(_fs, "load_function", lambda _fid: (loaded_def, "etag-1"))
        result = _load_function_definition({"functionLifecycle": "shared", "functionId": "fn-xyz"})

        setter = result["workflow"]["nodes"][0]["data"]["config"]["values"]["variables"]
        assert setter["token"] == "sk-shared-secret"
        assert result["name"] == "shared_fn"

    def test_shared_versioned_returns_definition_with_setter_secret_unsealed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.services.functions import _storage as _fs

        loaded_def = {
            "name": "shared_fn",
            "inputs": [],
            "outputs": [],
            "workflow": self._sealed_setter_workflow(),
        }

        monkeypatch.setattr(_fs, "load_version", lambda _fid, _v: loaded_def)
        result = _load_function_definition(
            {"functionLifecycle": "shared", "functionId": "fn-xyz", "functionVersion": "2.0.0"}
        )

        setter = result["workflow"]["nodes"][0]["data"]["config"]["values"]["variables"]
        assert setter["token"] == "sk-shared-secret"


class TestValidateEmbeddedFunctionInstancesDefensiveGuards:
    """``services.tests.service._validate_embedded_function_instances``
    walks every top-level workflow node and skips malformed entries."""

    def test_non_dict_node_is_skipped(self) -> None:
        from wavecore.api.services.tests.service import (
            _validate_embedded_function_instances,
        )

        errors: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []
        # The list contains a non-dict entry (line 2600-2601 guard) AND a
        # well-formed Function instance with a malformed localDefinition
        # (line 2607-2609 guard). Neither contributes errors.
        nodes: list[dict[str, Any]] = [
            "this-is-not-a-dict",  # type: ignore[list-item]
            {
                "id": "fn-1",
                "data": {
                    "nodeType": "function",
                    "functionLifecycle": "local",
                    "localDefinition": "not-a-dict",
                },
            },
        ]
        _validate_embedded_function_instances(nodes, "load", errors, warnings)
        assert errors == []
        assert warnings == []


def _run_session(session_id: str) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "test_name": "Function Block Shim",
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


class TestHandleFunctionNodeDropsUndeclaredFields:
    """A stored field the Function does not declare never runs; the declared ones do."""

    @pytest.mark.asyncio
    async def test_an_undeclared_stored_field_is_dropped(self) -> None:
        from wavecore.api.services.workbench import _common as _wb_common

        local_def = {
            "name": "ok",
            "inputs": [{"name": "kept", "type": "string", "required": False}],
            "outputs": [{"name": "result", "type": "string"}],
            "workflow": {
                "nodes": [
                    {
                        "id": "log_only",
                        "type": "workflowNode",
                        "data": {
                            "label": "log_only",
                            "elementType": "log",
                            "nodeType": "plugin",
                            "version": "1.0.0",
                            "config": {
                                "values": {"message": "kept", "level": "INFO"},
                                "outputBindings": {"line": "result"},
                            },
                            "expressionFields": ["message"],
                        },
                    }
                ],
                "edges": [{"source": "start-node", "target": "log_only"}],
            },
        }
        node = {
            "id": "fn-1",
            "type": "workflowNode",
            "data": {
                "label": "fn-1",
                "elementType": "function",
                "nodeType": "function",
                "version": "1.0.0",
                "functionLifecycle": "local",
                "localDefinition": local_def,
                # An input the Function no longer declares; evaluating it would fail.
                "config": {"values": {"kept": "'k'", "stale": "missing_name + 1"}},
                "expressionFields": ["kept", "stale"],
            },
        }
        session_id = "shim-undeclared-field"
        _wb_common._workbench_sessions[session_id] = _run_session(session_id)

        outputs = await handle_function_node(
            _extract_node_fields(node), variables={}, session_id=session_id, node_id="fn-1"
        )

        assert outputs == {"result": "k"}
