"""Recursive descent into Local bodies + the issue path trail (REQ-3.1.2.4).

The canonical pipeline descends Local Function bodies to any depth. Every
finding carries an ordered trail of the *enclosing* Functions (root to leaf
parent), each entry ``{node_id, label, element_type}``; the offending leaf
itself stays in ``node_id`` / ``node_label``. A Function that merely contains
failing descendants is NOT itself a finding. A defensive depth bound
(``MAX_VALIDATION_DEPTH``) protects against pathological nesting.

The enclosing-Function trail is carried on a dedicated ``function_path`` field,
NOT on the pre-existing ``path`` key (which is the dotted string locator the
canonical save pipeline already emits, e.g. ``variables.my_var`` /
``nodes[0].data.config.values.message``). ``function_path`` generalizes the
single-level ``function_node_id`` / ``function_node_label`` to the full
N-level ancestry.
"""

from __future__ import annotations

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
# Body-node + Local-Function builders
# ---------------------------------------------------------------------------


def _log_missing_message(node_id: str = "Log_1", label: str = "Log_1") -> dict[str, Any]:
    """A Log node with no ``message`` value -> REQUIRED_PARAM_MISSING leaf."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": label,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"level": "INFO"},
                "outputBindings": {},
                "profileBindings": [],
            },
        },
    }


def _local_fn(
    *,
    node_id: str,
    label: str,
    body_nodes: list[dict[str, Any]],
    entry_target: str,
) -> dict[str, Any]:
    """A Local Function instance node whose body holds ``body_nodes``."""
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
                "inputs": [],
                "outputs": [],
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


def _required_param_errors(result: dict[str, Any], node_label: str) -> list[dict[str, Any]]:
    return [
        e
        for e in result["errors"]
        if e.get("code") == "REQUIRED_PARAM_MISSING" and e.get("node_label") == node_label
    ]


def _nested_chain(depth: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Build a Test with ``depth`` nested Local Functions wrapping one failing
    Log leaf. Returns ``(test, ancestry)`` where ancestry is the expected
    enclosing-Function trail (outermost first)."""
    node: dict[str, Any] = _log_missing_message()
    entry = "Log_1"
    ancestry: list[dict[str, Any]] = []
    for level in range(depth, 0, -1):
        fn_id = f"fn-{level}"
        label = f"Fn_{level}"
        node = _local_fn(node_id=fn_id, label=label, body_nodes=[node], entry_target=entry)
        entry = fn_id
        ancestry.insert(0, {"node_id": fn_id, "label": label, "element_type": "function"})
    return _test_with_nodes([node]), ancestry


# ---------------------------------------------------------------------------
# Single-level body (one enclosing Function)
# ---------------------------------------------------------------------------


class TestSingleLevelPath:
    def test_leaf_carries_single_segment_trail(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        outer = _local_fn(
            node_id="outer-1",
            label="Outer_Fn",
            body_nodes=[_log_missing_message()],
            entry_target="Log_1",
        )
        result = _validate_test_data(_test_with_nodes([outer]), context="save")

        leaf_errors = _required_param_errors(result, "Log_1")
        assert len(leaf_errors) == 1, result["errors"]
        assert leaf_errors[0].get("function_path") == [
            {"node_id": "outer-1", "label": "Outer_Fn", "element_type": "function"}
        ]


# ---------------------------------------------------------------------------
# Two-level body (the wireframe example: Outer_Fn / Inner_Fn / Log_1)
# ---------------------------------------------------------------------------


class TestTwoLevelPath:
    def _result(self) -> dict[str, Any]:
        from wavecore.api.services.tests.service import _validate_test_data

        inner = _local_fn(
            node_id="inner-1",
            label="Inner_Fn",
            body_nodes=[_log_missing_message()],
            entry_target="Log_1",
        )
        outer = _local_fn(
            node_id="outer-1",
            label="Outer_Fn",
            body_nodes=[inner],
            entry_target="inner-1",
        )
        return _validate_test_data(_test_with_nodes([outer]), context="save")

    def test_leaf_carries_root_to_leaf_trail(self) -> None:
        leaf_errors = _required_param_errors(self._result(), "Log_1")
        assert len(leaf_errors) == 1
        assert leaf_errors[0].get("function_path") == [
            {"node_id": "outer-1", "label": "Outer_Fn", "element_type": "function"},
            {"node_id": "inner-1", "label": "Inner_Fn", "element_type": "function"},
        ]

    def test_enclosing_functions_have_no_own_row(self) -> None:
        result = self._result()
        own_rows = [e for e in result["errors"] if e.get("node_label") in ("Outer_Fn", "Inner_Fn")]
        assert own_rows == [], own_rows


# ---------------------------------------------------------------------------
# Top-level leaf (no enclosing Function -> no trail, single rendered segment)
# ---------------------------------------------------------------------------


class TestTopLevelLeafHasNoTrail:
    def test_top_level_node_has_empty_or_absent_trail(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        result = _validate_test_data(_test_with_nodes([_log_missing_message()]), context="save")
        leaf_errors = _required_param_errors(result, "Log_1")
        assert len(leaf_errors) == 1
        assert leaf_errors[0].get("function_path") in (None, [])


# ---------------------------------------------------------------------------
# Depth bound
# ---------------------------------------------------------------------------


class TestDepthGuard:
    def test_descent_is_bounded_by_max_validation_depth(self) -> None:
        from wavecore.api.services.tests.service import (
            MAX_VALIDATION_DEPTH,
            _validate_test_data,
        )

        test, _ancestry = _nested_chain(MAX_VALIDATION_DEPTH + 3)

        # Must terminate (no unbounded recursion) and never report a trail
        # deeper than the bound.
        result = _validate_test_data(test, context="save")
        for entry in result["errors"]:
            trail = entry.get("function_path") or []
            assert len(trail) <= MAX_VALIDATION_DEPTH, len(trail)


# ---------------------------------------------------------------------------
# Function-level finding (the Function itself is the leaf, not a body node)
# ---------------------------------------------------------------------------


def _log_with_message(node_id: str = "Log_1", label: str = "Log_1") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": label,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"message": "'hi'", "level": "INFO"},
                "outputBindings": {},
                "profileBindings": [],
            },
        },
    }


class TestFunctionLevelFinding:
    def test_output_with_no_producer_attributes_to_the_function(self) -> None:
        """A finding tied to the Function itself (no body node) makes the
        Function the leaf with an empty enclosing trail at the top level."""
        from wavecore.api.services.tests.service import _validate_test_data

        reporter = {
            "id": "reporter-1",
            "type": "workflowNode",
            "position": {"x": 0, "y": 0},
            "data": {
                "label": "Reporter",
                "elementType": "function",
                "nodeType": "function",
                "version": "1.0.0",
                "functionLifecycle": "local",
                "localDefinition": {
                    "name": "Reporter",
                    "description": "",
                    "tags": [],
                    "inputs": [],
                    "outputs": [{"name": "report", "type": "string"}],
                    "dependencies": {"functions": [], "plugins": []},
                    "workflow": {
                        "nodes": [_log_with_message()],
                        "edges": [{"source": "start-node", "target": "Log_1"}],
                    },
                },
                "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
            },
        }
        result = _validate_test_data(_test_with_nodes([reporter]), context="save")

        producers = [w for w in result["warnings"] if w.get("code") == "OUTPUT_HAS_NO_PRODUCER"]
        assert len(producers) == 1, result["warnings"]
        assert producers[0].get("node_label") == "Reporter"
        assert producers[0].get("function_path") == []
