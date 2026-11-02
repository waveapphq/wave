"""Save/Run parity + scope-aware Function-body reference wording (REQ-3.1.2.4).

A Test that saves cleanly cannot fail validation only at Run: the reference and
expression-resolution checks are identical across the two surfaces; only the
moment of evaluation differs. Inside a Function body the only names in scope are
the Function's declared inputs, outputs, and its own local variables; a
reference that does not resolve within that scope is an error whose message
names the isolation boundary so a no-code author knows the name must be declared
as an input, output, or local (not inherited from the Test).
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Generator
from typing import Any

import pytest

pytestmark = pytest.mark.usefixtures("temp_storage_path")


@pytest.fixture(autouse=True)
def _register_core_plugins_and_controls() -> Generator[None, None, None]:
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


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def _log_expr(
    *, node_id: str = "Log_1", label: str = "Log_1", message_expr: str = "subtotal"
) -> dict[str, Any]:
    """A Log node whose ``message`` is an expression field referencing a name."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": label,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "expressionFields": ["message"],
            "config": {
                "values": {"message": message_expr, "level": "INFO"},
                "outputBindings": {},
                "profileBindings": [],
            },
        },
    }


def _local_fn(
    *,
    node_id: str = "calc-1",
    label: str = "Calc",
    inputs: list[dict[str, Any]] | None = None,
    body_nodes: list[dict[str, Any]],
    entry_target: str,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": label,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": {
                "name": label,
                "description": "",
                "tags": [],
                "inputs": inputs or [],
                "outputs": [],
                "variables": {},
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {
                    "nodes": body_nodes,
                    "edges": [{"source": "start-node", "target": entry_target}],
                },
            },
            "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
        },
    }


def _test_with_nodes(nodes: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "name": "T",
        "version": "1.0.0",
        "workflow": {"nodes": nodes, "edges": []},
        "variables": {},
    }


def _finding_keys(result: dict[str, Any]) -> set[tuple[Any, Any, Any]]:
    return {(e.get("code"), e.get("message"), e.get("node_label")) for e in result["errors"]}


def _find(result: dict[str, Any], code: str) -> list[dict[str, Any]]:
    return [e for e in result["errors"] if e.get("code") == code]


# ---------------------------------------------------------------------------
# Scope-aware Function-body reference wording
# ---------------------------------------------------------------------------


class TestFunctionScopeAwareWording:
    def _build(self) -> dict[str, Any]:
        calc = _local_fn(
            inputs=[{"name": "price", "type": "string", "required": True}],
            body_nodes=[_log_expr(message_expr="subtotal")],
            entry_target="Log_1",
        )
        return _test_with_nodes([calc])

    def test_unresolved_body_reference_uses_scope_aware_message(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        result = _validate_test_data(self._build(), context="save")
        issues = _find(result, "UNRESOLVED_VARIABLE_REFERENCE")
        assert len(issues) == 1, result["errors"]
        assert re.match(
            r"^Variable 'subtotal' is not defined in this Function's scope "
            r"\(inputs, outputs, and local variables\)$",
            issues[0]["message"],
        ), issues[0]["message"]

    def test_unresolved_body_reference_attributed_to_leaf(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        result = _validate_test_data(self._build(), context="save")
        issues = _find(result, "UNRESOLVED_VARIABLE_REFERENCE")
        assert issues[0].get("node_label") == "Log_1"

    def test_reference_to_declared_input_is_clean(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        calc = _local_fn(
            inputs=[{"name": "price", "type": "string", "required": True}],
            body_nodes=[_log_expr(message_expr="price")],
            entry_target="Log_1",
        )
        result = _validate_test_data(_test_with_nodes([calc]), context="save")
        assert _find(result, "UNRESOLVED_VARIABLE_REFERENCE") == []

    def test_reference_to_declared_local_variable_is_clean(self) -> None:
        """A Function body may reference its own declared local variables. The
        canvas persists `localDefinition.variables` as an ARRAY of `{name,...}`,
        so the scope check must read names from that array."""
        from wavecore.api.services.tests.service import _validate_test_data

        calc = _local_fn(
            inputs=[],
            body_nodes=[_log_expr(message_expr="subtotal")],
            entry_target="Log_1",
        )
        calc["data"]["localDefinition"]["variables"] = [
            {"name": "subtotal", "type": "integer", "value": 0}
        ]
        result = _validate_test_data(_test_with_nodes([calc]), context="save")
        assert _find(result, "UNRESOLVED_VARIABLE_REFERENCE") == [], result["errors"]

    def test_profile_alias_bound_in_body_is_in_scope(self) -> None:
        """A profile alias bound on a body node is part of the Function's scope,
        so referencing it does not raise UNRESOLVED_VARIABLE_REFERENCE."""
        from wavecore.api.services.tests.service import _validate_test_data

        log = _log_expr(message_expr="db.host")
        log["data"]["config"]["profileBindings"] = [
            {"profileId": "p-1", "alias": "db", "fields": [{"name": "host"}]}
        ]
        calc = _local_fn(inputs=[], body_nodes=[log], entry_target="Log_1")
        result = _validate_test_data(_test_with_nodes([calc]), context="save")
        assert _find(result, "UNRESOLVED_VARIABLE_REFERENCE") == [], result["errors"]


# ---------------------------------------------------------------------------
# Save == Run parity
# ---------------------------------------------------------------------------


class TestSaveRunParity:
    def _build(self) -> dict[str, Any]:
        calc = _local_fn(
            inputs=[{"name": "price", "type": "string", "required": True}],
            body_nodes=[_log_expr(message_expr="subtotal")],
            entry_target="Log_1",
        )
        # Only a save refuses a Function Block that leaves a Required input empty.
        calc["data"]["config"]["values"] = {"price": "9.99"}
        return _test_with_nodes([calc])

    def test_identical_findings_for_save_and_run(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        test = self._build()
        save_keys = _finding_keys(_validate_test_data(test, context="save"))
        run_keys = _finding_keys(_validate_test_data(test, context="run"))
        assert save_keys == run_keys

    def test_unresolved_reference_present_in_both_contexts(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        test = self._build()
        save_codes = {e.get("code") for e in _validate_test_data(test, "save")["errors"]}
        run_codes = {e.get("code") for e in _validate_test_data(test, "run")["errors"]}
        assert "UNRESOLVED_VARIABLE_REFERENCE" in save_codes
        assert "UNRESOLVED_VARIABLE_REFERENCE" in run_codes
