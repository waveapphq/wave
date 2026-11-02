"""Conditional required parameters are gated inside a Local Function body (REQ-3.1.2.4).

A block whose parameter is required only under a condition (``required_when`` /
``required_when_all``) must be refused in exactly the same way whether it sits
at the top level of a Test or inside a Local Function body.
"""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

import pytest

from .test_validation_recursive_path import _local_fn, _test_with_nodes

pytestmark = pytest.mark.usefixtures("temp_storage_path")


@pytest.fixture(autouse=True)
def _register_k8s_plugins() -> Generator[None, None, None]:
    from wavecore.core.plugin_registry import register_plugin
    from wavecore.plugins.k8s_delete import K8sDeletePlugin
    from wavecore.plugins.k8s_events import K8sEventsPlugin
    from wavecore.plugins.k8s_get import K8sGetPlugin
    from wavecore.plugins.k8s_top import K8sTopPlugin

    register_plugin(K8sDeletePlugin())
    register_plugin(K8sGetPlugin())
    register_plugin(K8sEventsPlugin())
    register_plugin(K8sTopPlugin())
    yield


def _plugin_node(
    element_type: str,
    values: dict[str, Any],
    *,
    node_id: str = "Blk_1",
    label: str = "Blk_1",
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": label,
            "elementType": element_type,
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": values,
                "outputBindings": {},
                "profileBindings": [],
            },
        },
    }


def _control_node(
    element_type: str,
    values: dict[str, Any],
    *,
    node_id: str = "Blk_1",
    label: str = "Blk_1",
) -> dict[str, Any]:
    node = _plugin_node(element_type, values, node_id=node_id, label=label)
    node["data"]["nodeType"] = "control"
    return node


def _errors_for(node: dict[str, Any]) -> list[dict[str, Any]]:
    """Validate ``node`` inside a Local Function body and return the save errors."""
    from wavecore.api.services.tests.service import _validate_test_data

    body_node_id = str(node["id"])
    outer = _local_fn(
        node_id="outer-1",
        label="Outer_Fn",
        body_nodes=[node],
        entry_target=body_node_id,
    )
    result = _validate_test_data(_test_with_nodes([outer]), context="save")
    return list(result["errors"])


def _missing_params(errors: list[dict[str, Any]], node_label: str) -> list[str]:
    return [
        str(e.get("message", "")).split("'")[1]
        for e in errors
        if e.get("code") == "REQUIRED_PARAM_MISSING" and e.get("node_label") == node_label
    ]


K8S_SESSION = "{{ session }}"


class TestConditionalRequiredInFunctionBody:
    """A conditional hole in a Function body is refused, naming block and field."""

    def test_k8s_delete_name_delete_is_refused(self) -> None:
        errors = _errors_for(
            _plugin_node(
                "k8s-delete",
                {
                    "session": K8S_SESSION,
                    "resource_type": "default",
                    "kind": "Pod",
                    "delete_by": "name",
                },
                label="K8s_Delete_1",
            )
        )
        assert _missing_params(errors, "K8s_Delete_1") == ["name"]

    def test_k8s_get_refusal_carries_block_field_and_function_path(self) -> None:
        errors = _errors_for(
            _plugin_node(
                "k8s-get",
                {"session": K8S_SESSION, "resource_type": "custom", "search_by": "list"},
                label="K8s_Get_1",
            )
        )
        hits = [
            e
            for e in errors
            if e.get("code") == "REQUIRED_PARAM_MISSING" and e.get("node_label") == "K8s_Get_1"
        ]
        assert len(hits) == 1, errors
        assert hits[0]["message"] == "Required parameter 'kind_custom' is missing"
        assert hits[0].get("function_path") == [
            {"node_id": "outer-1", "label": "Outer_Fn", "element_type": "function"}
        ]

    def test_k8s_get_custom_kind_is_refused(self) -> None:
        errors = _errors_for(
            _plugin_node(
                "k8s-get",
                {"session": K8S_SESSION, "resource_type": "custom", "search_by": "list"},
                label="K8s_Get_1",
            )
        )
        assert _missing_params(errors, "K8s_Get_1") == ["kind_custom"]

    def test_k8s_get_name_search_is_refused(self) -> None:
        errors = _errors_for(
            _plugin_node(
                "k8s-get",
                {
                    "session": K8S_SESSION,
                    "resource_type": "custom",
                    "kind_custom": "widgets",
                    "search_by": "name",
                },
                label="K8s_Get_1",
            )
        )
        assert _missing_params(errors, "K8s_Get_1") == ["name"]

    def test_k8s_events_conjunctive_object_kind_custom_is_refused(self) -> None:
        errors = _errors_for(
            _plugin_node(
                "k8s-events",
                {
                    "session": K8S_SESSION,
                    "scope_to_object": True,
                    "object_type": "custom",
                    "object_name": "web-1",
                },
                label="K8s_Events_1",
            )
        )
        assert _missing_params(errors, "K8s_Events_1") == ["object_kind_custom"]

    def test_k8s_top_name_is_refused(self) -> None:
        errors = _errors_for(
            _plugin_node(
                "k8s-top",
                {"session": K8S_SESSION, "scope": "pod", "select_by": "name"},
                label="K8s_Top_1",
            )
        )
        assert _missing_params(errors, "K8s_Top_1") == ["name"]

    def test_for_count_is_refused(self) -> None:
        errors = _errors_for(_control_node("for", {"mode": "count"}, label="For_1"))
        assert _missing_params(errors, "For_1") == ["count"]

    def test_for_range_bounds_are_refused(self) -> None:
        errors = _errors_for(_control_node("for", {"mode": "range"}, label="For_1"))
        assert _missing_params(errors, "For_1") == ["start", "end"]


class TestConditionNotHoldingStillSaves:
    """The same empty field is accepted when its condition does not hold."""

    def test_k8s_get_custom_mode_does_not_need_kind(self) -> None:
        errors = _errors_for(
            _plugin_node(
                "k8s-get",
                {
                    "session": K8S_SESSION,
                    "resource_type": "custom",
                    "kind_custom": "widgets",
                    "search_by": "list",
                },
                label="K8s_Get_1",
            )
        )
        assert _missing_params(errors, "K8s_Get_1") == []

    def test_k8s_get_default_mode_does_not_need_kind_custom(self) -> None:
        errors = _errors_for(
            _plugin_node(
                "k8s-get",
                {
                    "session": K8S_SESSION,
                    "resource_type": "default",
                    "kind": "Pod",
                    "search_by": "list",
                },
                label="K8s_Get_1",
            )
        )
        assert _missing_params(errors, "K8s_Get_1") == []

    def test_k8s_get_selector_search_does_not_need_name(self) -> None:
        errors = _errors_for(
            _plugin_node(
                "k8s-get",
                {
                    "session": K8S_SESSION,
                    "resource_type": "default",
                    "kind": "Pod",
                    "search_by": "selector",
                },
                label="K8s_Get_1",
            )
        )
        assert _missing_params(errors, "K8s_Get_1") == []

    def test_k8s_events_unscoped_does_not_need_object_kind(self) -> None:
        errors = _errors_for(
            _plugin_node(
                "k8s-events",
                {"session": K8S_SESSION, "scope_to_object": False},
                label="K8s_Events_1",
            )
        )
        assert _missing_params(errors, "K8s_Events_1") == []

    def test_k8s_events_custom_object_type_does_not_need_object_kind(self) -> None:
        errors = _errors_for(
            _plugin_node(
                "k8s-events",
                {
                    "session": K8S_SESSION,
                    "scope_to_object": True,
                    "object_type": "custom",
                    "object_kind_custom": "widgets",
                    "object_name": "web-1",
                },
                label="K8s_Events_1",
            )
        )
        assert _missing_params(errors, "K8s_Events_1") == []

    def test_k8s_top_all_mode_does_not_need_name(self) -> None:
        errors = _errors_for(
            _plugin_node(
                "k8s-top",
                {"session": K8S_SESSION, "scope": "pod", "select_by": "all"},
                label="K8s_Top_1",
            )
        )
        assert _missing_params(errors, "K8s_Top_1") == []

    def test_for_count_mode_does_not_need_range_bounds(self) -> None:
        errors = _errors_for(_control_node("for", {"mode": "count", "count": 3}, label="For_1"))
        assert _missing_params(errors, "For_1") == []


class TestUnconditionalRequiredUnchanged:
    """The plain ``required`` path behaves exactly as it did before."""

    def test_missing_session_is_still_refused(self) -> None:
        errors = _errors_for(
            _plugin_node(
                "k8s-get",
                {"resource_type": "default", "kind": "Pod", "search_by": "list"},
                label="K8s_Get_1",
            )
        )
        assert _missing_params(errors, "K8s_Get_1") == ["session"]

    def test_fully_bound_block_saves(self) -> None:
        errors = _errors_for(
            _plugin_node(
                "k8s-get",
                {
                    "session": K8S_SESSION,
                    "resource_type": "default",
                    "kind": "Pod",
                    "search_by": "name",
                    "name": "web-1",
                },
                label="K8s_Get_1",
            )
        )
        assert _missing_params(errors, "K8s_Get_1") == []
