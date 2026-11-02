"""Top-level Shared version-availability gate (REQ-3.1.2.2 / REQ-3.1.2.4).

A Test whose top-level workflow holds a Shared Function instance pinned to a
version that no longer exists in the library must be blocked by the canonical
validation pipeline (Validate / Save / Run) with a ``MISSING_FUNCTION_VERSION``
finding. A disabled node is exempt (no validation, no block).

These tests drive the canonical funnel ``_validate_test_data`` directly, the
single pass every surface routes through.

Wording: the missing-version message carries no raw Function UUID and reads
``Pinned version {version} is no longer available in the library`` so it matches
the FE wording and the approved mockup (CANVAS-218).
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
# Helpers
# ---------------------------------------------------------------------------


def _make_metadata() -> dict[str, Any]:
    return {
        "description": "say hello",
        "tags": ["demo"],
        "changelog": "initial",
        "details": "",
        "published_at": "2026-01-01T00:00:00Z",
        "published_by": "wave",
    }


def _seed_library_function(name: str = "greet", version: str = "1.0.0") -> str:
    """Persist a one-version Published Function and return its id."""
    from wavecore.api.services.functions._storage import save_new_version

    fn_id = str(uuid.uuid4())
    definition = {
        "inputs": [{"name": "x", "type": "string", "required": True}],
        "outputs": [{"name": "result", "type": "string"}],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }
    save_new_version(fn_id, version, definition, _make_metadata(), name=name)
    return fn_id


def _shared_node(
    *,
    function_id: str,
    function_version: str,
    node_id: str = "shared-1",
    label: str = "Greet",
    disabled: bool = False,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 100, "y": 100},
        "data": {
            "label": label,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "shared",
            "functionId": function_id,
            "functionVersion": function_version,
            "disabled": disabled,
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


def _codes(entries: list[dict[str, Any]]) -> list[str]:
    return [e.get("code") for e in entries]


def _find(entries: list[dict[str, Any]], code: str) -> list[dict[str, Any]]:
    return [e for e in entries if e.get("code") == code]


# ---------------------------------------------------------------------------
# The gate blocks every non-load surface
# ---------------------------------------------------------------------------


class TestTopLevelMissingVersionBlocks:
    def test_save_context_emits_missing_version_error(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = _seed_library_function()  # only 1.0.0 exists
        test = _test_with_nodes([_shared_node(function_id=fn_id, function_version="2.0.0")])

        result = _validate_test_data(test, context="save")

        version_errors = _find(result["errors"], "MISSING_FUNCTION_VERSION")
        assert len(version_errors) == 1, _codes(result["errors"])
        assert version_errors[0].get("node_label") == "Greet"

    def test_run_context_emits_missing_version_error(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = _seed_library_function()
        test = _test_with_nodes([_shared_node(function_id=fn_id, function_version="2.0.0")])

        result = _validate_test_data(test, context="run")

        assert "MISSING_FUNCTION_VERSION" in _codes(result["errors"])

    def test_message_uses_reworded_wording_without_uuid(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = _seed_library_function()
        test = _test_with_nodes([_shared_node(function_id=fn_id, function_version="2.0.0")])

        result = _validate_test_data(test, context="save")
        message = _find(result["errors"], "MISSING_FUNCTION_VERSION")[0]["message"]

        assert re.match(
            r"^Pinned version 2\.0\.0 is no longer available in the library$",
            message,
        ), message
        # The raw Function UUID must NOT leak into the no-code author's view.
        assert fn_id not in message

    def test_missing_version_is_error_not_warning(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = _seed_library_function()
        test = _test_with_nodes([_shared_node(function_id=fn_id, function_version="2.0.0")])

        result = _validate_test_data(test, context="save")

        assert "MISSING_FUNCTION_VERSION" in _codes(result["errors"])
        assert "MISSING_FUNCTION_VERSION" not in _codes(result["warnings"])


# ---------------------------------------------------------------------------
# Exemptions and clean paths
# ---------------------------------------------------------------------------


class TestTopLevelVersionGateExemptions:
    def test_disabled_node_is_exempt(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = _seed_library_function()
        test = _test_with_nodes(
            [_shared_node(function_id=fn_id, function_version="2.0.0", disabled=True)]
        )

        result = _validate_test_data(test, context="save")

        assert "MISSING_FUNCTION_VERSION" not in _codes(result["errors"])
        assert "MISSING_FUNCTION_VERSION" not in _codes(result["warnings"])

    def test_pinned_to_available_version_is_clean(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = _seed_library_function()  # 1.0.0
        test = _test_with_nodes([_shared_node(function_id=fn_id, function_version="1.0.0")])

        result = _validate_test_data(test, context="save")

        assert "MISSING_FUNCTION_VERSION" not in _codes(result["errors"])

    def test_unknown_function_id_is_missing_id_not_missing_version(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        unknown_id = str(uuid.uuid4())
        test = _test_with_nodes([_shared_node(function_id=unknown_id, function_version="1.0.0")])

        result = _validate_test_data(test, context="save")
        codes = _codes(result["errors"])

        assert "MISSING_FUNCTION_ID" in codes
        assert "MISSING_FUNCTION_VERSION" not in codes
