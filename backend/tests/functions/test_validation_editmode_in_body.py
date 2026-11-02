"""A Function body containing a nested edit-mode draft is publish-blocked.

REQ-3.1.2.4. A Function cannot be published while any Function nested in
its body is itself an unresolved edit-mode draft - freezing such a body would
capture work-in-progress inside an immutable version. The recursive validation
descent therefore treats a nested edit-mode draft (a Shared instance carrying
``editMode``/``draft`` *inside another Function's body*) as a publish-blocking
error (`EDIT_MODE_DRAFT_IN_BODY`) and points the author at the nested draft.

A TOP-LEVEL instance in edit mode is the normal edit flow and is NOT blocked;
only a nested one is.
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
# Builders
# ---------------------------------------------------------------------------


def _seed_library_function(name: str = "inner_fn", version: str = "1.0.0") -> str:
    """Seed a published Function with no required inputs (so a nested reference
    to it produces no binding/reference noise - only the editMode state matters)."""
    from wavecore.api.services.functions._storage import save_new_version

    fn_id = str(uuid.uuid4())
    save_new_version(
        fn_id,
        version,
        {
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
        },
        {
            "description": "",
            "tags": [],
            "changelog": "initial",
            "details": "",
            "published_at": "2026-01-01T00:00:00Z",
            "published_by": "wave",
        },
        name=name,
    )
    return fn_id


def _draft_body(name: str) -> dict[str, Any]:
    return {
        "name": name,
        "description": "wip",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }


def _shared_instance(
    *,
    node_id: str,
    function_id: str,
    version: str,
    label: str,
    edit_mode: bool = False,
    draft: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "label": label,
        "elementType": "function",
        "nodeType": "function",
        "functionLifecycle": "shared",
        "functionId": function_id,
        "functionVersion": version,
        "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
    }
    if edit_mode:
        data["editMode"] = True
        data["upstreamLink"] = {"functionId": function_id, "sourceVersion": version}
        data["draft"] = draft if draft is not None else _draft_body(label)
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": data,
    }


def _local_fn(*, node_id: str, label: str, body_nodes: list[dict[str, Any]]) -> dict[str, Any]:
    entry_target = body_nodes[0]["id"] if body_nodes else "start-node"
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


def _editmode_in_body_errors(result: dict[str, Any]) -> list[dict[str, Any]]:
    return [e for e in result["errors"] if e.get("code") == "EDIT_MODE_DRAFT_IN_BODY"]


# ---------------------------------------------------------------------------
# Nested edit-mode draft -> blocking error
# ---------------------------------------------------------------------------


class TestNestedEditModeDraftIsBlocked:
    def _result(self) -> tuple[dict[str, Any], str, str]:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = _seed_library_function()
        inner = _shared_instance(
            node_id="inner-1",
            function_id=fn_id,
            version="1.0.0",
            label="Inner",
            edit_mode=True,
        )
        outer = _local_fn(node_id="outer-1", label="Outer_Fn", body_nodes=[inner])
        result = _validate_test_data(_test_with_nodes([outer]), context="save")
        return result, "inner-1", "outer-1"

    def test_emits_edit_mode_draft_in_body_error(self) -> None:
        result, _inner_id, _outer_id = self._result()
        assert len(_editmode_in_body_errors(result)) >= 1, result["errors"]

    def test_error_is_tied_to_the_nested_instance(self) -> None:
        result, inner_id, _outer_id = self._result()
        errors = _editmode_in_body_errors(result)
        assert any(
            e.get("node_id") == inner_id or e.get("node_label") == "Inner" for e in errors
        ), errors

    def test_error_carries_function_path_through_the_outer_function(self) -> None:
        result, _inner_id, outer_id = self._result()
        errors = _editmode_in_body_errors(result)
        trails = [e.get("function_path") or [] for e in errors]
        assert any(trail for trail in trails), errors
        assert any(any(seg.get("node_id") == outer_id for seg in trail) for trail in trails), errors


# ---------------------------------------------------------------------------
# A clean nested instance (no editMode) is NOT flagged
# ---------------------------------------------------------------------------


class TestCleanNestedInstanceNotFlagged:
    def test_published_nested_instance_without_editmode_is_not_blocked(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = _seed_library_function()
        inner = _shared_instance(
            node_id="inner-1",
            function_id=fn_id,
            version="1.0.0",
            label="Inner",
            edit_mode=False,
        )
        outer = _local_fn(node_id="outer-1", label="Outer_Fn", body_nodes=[inner])
        result = _validate_test_data(_test_with_nodes([outer]), context="save")
        assert _editmode_in_body_errors(result) == []


# ---------------------------------------------------------------------------
# A TOP-LEVEL instance in edit mode is the normal flow -> NOT blocked
# ---------------------------------------------------------------------------


class TestTopLevelEditModeNotFlagged:
    def test_top_level_edit_mode_instance_is_not_blocked(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        fn_id = _seed_library_function()
        top = _shared_instance(
            node_id="top-1",
            function_id=fn_id,
            version="1.0.0",
            label="TopLevel",
            edit_mode=True,
        )
        result = _validate_test_data(_test_with_nodes([top]), context="save")
        assert _editmode_in_body_errors(result) == []
